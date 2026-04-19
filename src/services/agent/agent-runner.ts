// =============================================================================
// DeepAnalyze - Agent Runner
// =============================================================================
// Core agent execution engine. Implements a continuous TAOR loop with:
//   - while(true) loop (model decides when to stop, configurable turn limits)
//   - Auto-compaction (SM-compact + Legacy compact)
//   - Session memory extraction and injection
//   - Microcompaction of old tool results
//   - Emergency compaction for prompt_too_long errors
//   - All key parameters configurable via AgentSettings
// =============================================================================

import { randomUUID } from "node:crypto";
import { ModelRouter } from "../../models/router.js";
import { ToolRegistry } from "./tool-registry.js";
import { ContextManager } from "./context-manager.js";
import { CompactionEngine } from "./compaction.js";
import { MicroCompactor } from "./micro-compact.js";
import { SessionMemoryManager, replaceSessionMemoryInjection } from "./session-memory.js";
import { getRepos } from "../../store/repos/index.js";
import { DisplayResolver } from "../display-resolver.js";
import type {
  AgentDefinition,
  AgentRunOptions,
  AgentResult,
  AgentEvent,
  AgentProgressEntry,
} from "./types.js";
import { DEFAULT_AGENT_SETTINGS } from "./types.js";
import type {
  ChatMessage,
  ChatResponse,
  ToolCall,
  ToolDefinition,
  ModelRole,
} from "../../models/provider.js";

// ---------------------------------------------------------------------------
// Default agent definition (used when no agent type is specified)
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_DEFINITION: AgentDefinition = {
  agentType: "general",
  description: "General-purpose agent for any task",
  systemPrompt:
    "You are a helpful AI assistant. Analyze the user's request carefully " +
    "and use available tools as needed to accomplish the task. " +
    "When you have completed the task, call the 'finish' tool with your final answer.",
  tools: ["*"],
  modelRole: "main",
  maxTurns: -1,
  readOnly: false,
};

// Finish reasons that indicate the model stopped naturally (provider-agnostic)
const STOP_FINISH_REASONS = new Set([
  "stop",
  "end_turn",
  "STOP",
  "EndTurn",
  "ended",
]);

// ---------------------------------------------------------------------------
// AgentRunner
// ---------------------------------------------------------------------------

export class AgentRunner {
  private modelRouter: ModelRouter;
  private toolRegistry: ToolRegistry;
  private agentDefinitions = new Map<string, AgentDefinition>();
  private displayResolver: DisplayResolver | null = null;

  constructor(modelRouter: ModelRouter, toolRegistry: ToolRegistry) {
    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;
    this.registerAgent(DEFAULT_AGENT_DEFINITION);
  }

  // -----------------------------------------------------------------------
  // Agent definition management
  // -----------------------------------------------------------------------

  registerAgent(definition: AgentDefinition): void {
    this.agentDefinitions.set(definition.agentType, definition);
  }

  registerAgents(definitions: AgentDefinition[]): void {
    for (const definition of definitions) {
      this.agentDefinitions.set(definition.agentType, definition);
    }
  }

  getAgentDefinition(agentType: string): AgentDefinition | undefined {
    return this.agentDefinitions.get(agentType);
  }

  getAgentTypes(): string[] {
    return Array.from(this.agentDefinitions.keys());
  }

  // -----------------------------------------------------------------------
  // Main execution loop
  // -----------------------------------------------------------------------

  async run(options: AgentRunOptions): Promise<AgentResult> {
    const taskId = randomUUID();
    const agentType = options.agentType ?? "general";

    let definition = this.agentDefinitions.get(agentType);
    if (!definition) {
      definition = DEFAULT_AGENT_DEFINITION;
    }

    // Load agent settings from DB
    let agentSettings;
    try {
      const repos = await getRepos();
      const raw = await repos.settings.get("agent_settings");
      agentSettings = raw ? JSON.parse(raw) : {};
      // Merge with defaults
      agentSettings = { ...DEFAULT_AGENT_SETTINGS, ...agentSettings };
    } catch (err) {
      console.error("[AgentRunner] Failed to load agent settings:", err instanceof Error ? err.message : String(err));
      throw err;
    }

    // Resolve effective turn limit (API override > settings > definition > default)
    const advisoryLimit = options.maxTurns ?? definition.maxTurns ?? agentSettings.maxTurns;
    const isUnlimited = advisoryLimit === -1;
    const hardLimit = isUnlimited ? Infinity : advisoryLimit * 3;

    // --- Main/Sub model split ---
    // Primary agents (general, report) use 'main' model
    // Sub agents (explore, compile, verify, coordinator) use 'summarizer' model
    const effectiveAgentType = options.agentType ?? definition.agentType ?? "general";
    const SUB_AGENT_TYPES = new Set(["explore", "compile", "verify", "coordinator"]);
    const isSubAgent = SUB_AGENT_TYPES.has(effectiveAgentType);
    const modelRole = options.modelRole ?? definition.modelRole ?? (isSubAgent ? "summarizer" : "main");
    const fallbackRole: ModelRole = modelRole === "main" ? "summarizer" : "main";
    let usingFallback = false;

    let modelId: string;
    try {
      // Ensure the router has the latest provider config before resolving
      // the default model — otherwise we may use a stale model ID.
      await this.modelRouter.ensureCurrent();
      modelId = this.modelRouter.getDefaultModel(modelRole);
    } catch (err) {
      console.error(`[AgentRunner] Failed to resolve default model for role "${modelRole}":`, err instanceof Error ? err.message : String(err));
      console.error(`[AgentRouter] Available providers: ${this.modelRouter.listProviderNames().join(", ")}`);
      throw err;
    }
    const effectiveSystemPrompt = options.systemPromptOverride ?? definition.systemPrompt;

    console.log(`[AgentRunner] Starting agent run: taskId=${taskId}, agentType=${agentType}, modelRole=${modelRole}, modelId=${modelId}, providers=${this.modelRouter.listProviderNames().join(",")}`);

    // Build initial messages
    const messages = this.buildMessages(
      effectiveSystemPrompt,
      options.input,
      options.contextMessages,
    );

    const effectiveTools = options.toolsOverride ?? definition.tools;
    let toolDefs;
    try {
      toolDefs = this.toolRegistry.buildToolDefinitions(effectiveTools);
    } catch (err) {
      console.error("[AgentRunner] Failed to build tool definitions:", err instanceof Error ? err.message : String(err));
      throw err;
    }
    console.log(`[AgentRunner] Built ${toolDefs.length} tool definitions, starting LLM loop...`);

    // Track execution state
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastAssistantContent = "";
    const compactionEvents: Array<{ turn: number; method: string; tokensSaved: number }> = [];

    // Track accessed wiki pages for source tracing
    const accessedPages = new Map<string, {
      pageId: string;
      title: string;
      docId?: string;
      originalName?: string;
      kbName?: string;
      sectionTitle?: string;
      pageNumber?: number | null;
      anchorId?: string;
    }>();

    // Initialize context management components (reused across turns, L1/L2 fix)
    const contextManager = new ContextManager(this.modelRouter, modelId, toolDefs, agentSettings);
    const microCompactor = new MicroCompactor();
    const compactionEngine = new CompactionEngine(this.modelRouter, contextManager);

    // Initialize SessionMemory (if sessionId is provided)
    let sessionMemory: SessionMemoryManager | null = null;
    if (options.sessionId) {
      sessionMemory = new SessionMemoryManager(this.modelRouter, options.sessionId, agentSettings);
      const memory = await sessionMemory.load();
      if (memory) {
        messages[0].content += "\n\n" + sessionMemory.buildPromptInjection(memory);
      }
    }

    // Emit start event
    this.emitEvent(options.onEvent, {
      type: "start",
      taskId,
      agentType,
    });

    // -------------------------------------------------------------------
    // Continuous TAOR Loop
    // -------------------------------------------------------------------
    let turn = 0;
    let emergencyCompactionCount = 0;
    const MAX_EMERGENCY_COMPACTIONS = 5;
    let consecutiveLLMErrors = 0;
    const MAX_CONSECUTIVE_LLM_ERRORS = 5;

    while (true) {
      turn++;

      // 1. Cancellation check
      if (options.signal?.aborted) {
        this.emitEvent(options.onEvent, { type: "cancelled", taskId });
        return this.buildResult(taskId, lastAssistantContent, messages, totalToolCalls, turn, totalInputTokens, totalOutputTokens, compactionEvents, undefined, options.onEvent);
      }

      // 2. Hard limit check (absolute safety valve, only for non-unlimited)
      if (!isUnlimited && turn > hardLimit) {
        break;
      }

      // 3. Advisory limit check — emit warning but don't stop
      if (!isUnlimited && turn === advisoryLimit + 1) {
        this.emitEvent(options.onEvent, {
          type: "advisory_limit_reached",
          taskId,
          turn,
        });
      }

      // 4. Call the LLM (with automatic model fallback)
      let response: ChatResponse;
      try {
        response = await this.chatWithFallback(
          messages, toolDefs, options,
          modelId, modelRole, fallbackRole,
          usingFallback,
          (newModelId: string) => { modelId = newModelId; usingFallback = true; },
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Emergency compaction: detect prompt_too_long errors
        if (this.isPromptTooLongError(errorMsg) && emergencyCompactionCount < MAX_EMERGENCY_COMPACTIONS) {
          console.log(`[AgentRunner] prompt_too_long detected, triggering emergency compaction (attempt ${emergencyCompactionCount + 1}/${MAX_EMERGENCY_COMPACTIONS})`);
          emergencyCompactionCount++;
          try {
            const result = await compactionEngine.compact(messages, sessionMemory, options.signal);
            if (result.method !== "none") {
              messages.length = 0;
              messages.push(...result.messages);
              compactionEvents.push({ turn, method: result.method, tokensSaved: result.tokensSaved });
              this.emitEvent(options.onEvent, {
                type: "compaction",
                taskId,
                turn,
                method: `emergency-${result.method}`,
                tokensSaved: result.tokensSaved,
              });
              // Retry the LLM call after compaction
              continue;
            }
          } catch {
            // Emergency compaction failed — fall through to error
          }
        }

        // Transient error retry (rate limit, network, server errors)
        if (this.isTransientError(errorMsg) && consecutiveLLMErrors < MAX_CONSECUTIVE_LLM_ERRORS) {
          consecutiveLLMErrors++;
          const backoff = Math.min(5000, 1000 * Math.pow(2, consecutiveLLMErrors - 1));
          console.warn(`[AgentRunner] Transient error (attempt ${consecutiveLLMErrors}/${MAX_CONSECUTIVE_LLM_ERRORS}), retrying in ${backoff}ms: ${errorMsg}`);
          this.recordProgress(options.onEvent, taskId, turn, "error", `Transient error, retrying (${consecutiveLLMErrors}/${MAX_CONSECUTIVE_LLM_ERRORS}): ${errorMsg}`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          turn--; // Don't count this as a turn
          continue;
        }

        consecutiveLLMErrors = 0; // Reset on non-transient or exhausted retries
        this.recordProgress(options.onEvent, taskId, turn, "error", `Model call failed: ${errorMsg}`);
        this.emitEvent(options.onEvent, { type: "error", taskId, error: errorMsg });
        return this.buildResult(taskId, lastAssistantContent, messages, totalToolCalls, turn, totalInputTokens, totalOutputTokens, compactionEvents, `Agent failed: ${errorMsg}`, options.onEvent);
      }

      // 5. Track token usage
      consecutiveLLMErrors = 0; // Reset on successful response
      if (response.usage) {
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      const assistantContent = response.content ?? "";
      if (assistantContent) {
        lastAssistantContent = assistantContent;
      }

      if (assistantContent) {
        this.recordProgress(options.onEvent, taskId, turn, "text", assistantContent);
      }

      this.emitEvent(options.onEvent, { type: "turn", taskId, turn, content: assistantContent });

      // Build the assistant message
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantContent,
      };

      // Process tool calls
      const toolCalls = response.toolCalls;
      let agentCalledFinish = false;

      if (toolCalls && toolCalls.length > 0) {
        assistantMessage.toolCalls = toolCalls;
        messages.push(assistantMessage);

        for (const toolCall of toolCalls) {
          totalToolCalls++;
          if (toolCall.function.name === "finish") {
            agentCalledFinish = true;
          }
          const toolResultMessage = await this.executeToolCall(
            toolCall,
            taskId,
            turn,
            options.onEvent,
            accessedPages,
          );
          messages.push(toolResultMessage);
        }
      } else {
        messages.push(assistantMessage);
      }

      // 6. Context management
      // 6a. Microcompact
      if (contextManager.shouldMicrocompact(messages)) {
        const result = microCompactor.prune(messages, agentSettings.microcompactKeepTurns);
        if (result.prunedCount > 0) {
          messages.length = 0;
          messages.push(...result.messages);
        }
      }

      // 6b. Auto-compaction
      if (contextManager.shouldCompact(messages)) {
        try {
          const result = await compactionEngine.compact(messages, sessionMemory, options.signal);
          if (result.method !== "none") {
            messages.length = 0;
            messages.push(...result.messages);
            compactionEvents.push({ turn, method: result.method, tokensSaved: result.tokensSaved });
            this.emitEvent(options.onEvent, {
              type: "compaction",
              taskId,
              turn,
              method: result.method,
              tokensSaved: result.tokensSaved,
            });
          }
        } catch (err) {
          console.warn("[AgentRunner] Compaction failed:", err instanceof Error ? err.message : String(err));
        }
      }

      // 6c. Session Memory update
      if (sessionMemory && messages.length > 0) {
        const totalTokens = totalInputTokens + totalOutputTokens;
        try {
          const memory = await sessionMemory.load();
          if (!memory && sessionMemory.shouldInitialize(totalTokens)) {
            const newMemory = await sessionMemory.initialize(messages, options.signal);
            // Set lastTokenPosition to actual session tokens
            newMemory.lastTokenPosition = totalTokens;
            sessionMemory.save(newMemory);
            messages[0].content += "\n\n" + sessionMemory.buildPromptInjection(newMemory);
          } else if (memory && sessionMemory.shouldUpdate(totalTokens, memory)) {
            const updated = await sessionMemory.update(memory, messages, totalTokens, options.signal);
            messages[0].content = replaceSessionMemoryInjection(
              messages[0].content,
              sessionMemory.buildPromptInjection(updated),
            );
          }
        } catch (err) {
          console.warn("[AgentRunner] Session memory update failed:", err instanceof Error ? err.message : String(err));
        }
      }

      // 7. Completion check
      if (this.isDone(assistantContent, toolCalls, response.finishReason, agentCalledFinish)) {
        break;
      }
    }

    // Build final result
    const result = this.buildResult(taskId, lastAssistantContent, messages, totalToolCalls, turn, totalInputTokens, totalOutputTokens, compactionEvents, undefined, options.onEvent);

    // Auto-compound on task completion
    const finalOutput = result.output;
    const kbId = options.kbId;
    if (finalOutput && finalOutput.trim().length >= 100 && kbId) {
      try {
        const { eventBus } = await import("../event-bus.js");
        eventBus.emit({
          type: "agent_task_complete",
          sessionId: options.sessionId ?? "",
          taskId,
          agentType,
          output: finalOutput,
        });

        // Trigger compound with source tracing
        const { KnowledgeCompounder, compoundWithAnchors } = await import("../../wiki/knowledge-compound.js");
        const { DEEPANALYZE_CONFIG } = await import("../../core/config.js");
        const compounder = new KnowledgeCompounder(DEEPANALYZE_CONFIG.dataDir);

        // Check if we have anchor-level data for enhanced tracing
        const anchorData = Array.from(accessedPages.values())
          .filter(p => p.anchorId && p.docId)
          .map(p => ({
            anchorId: p.anchorId!,
            docId: p.docId!,
            originalName: p.originalName ?? p.docId ?? p.pageId,
            sectionTitle: p.sectionTitle ?? null,
            pageNumber: p.pageNumber ?? null,
            role: "supporting" as const,
          }));

        if (anchorData.length > 0) {
          // Anchor-level tracing
          const anchorContent = compoundWithAnchors(
            kbId,
            agentType,
            options.input,
            finalOutput,
            anchorData,
          );
          if (anchorContent) {
            await compounder.compoundAgentResult(
              kbId,
              agentType,
              options.input,
              finalOutput + "\n\n" + anchorContent,
            );
          }
        } else {
          // Fallback to page-level tracing
          await compounder.compoundWithTracing(
            kbId,
            agentType,
            options.input,
            finalOutput,
            Array.from(accessedPages.values()).map(p => ({ pageId: p.pageId, title: p.title })),
          );
        }
      } catch (err) {
        // Compound failure should not break the agent flow
        console.warn("[AgentRunner] Auto-compound failed:", err instanceof Error ? err.message : String(err));
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Chat with automatic model fallback
  // -----------------------------------------------------------------------

  /**
   * Call the LLM with automatic fallback to the alternate model role
   * if the primary model fails. On fallback success, updates the caller's
   * modelId and usingFallback via the onFallback callback so subsequent
   * turns use the fallback model directly.
   */
  private async chatWithFallback(
    messages: ChatMessage[],
    toolDefs: ToolDefinition[],
    options: AgentRunOptions,
    modelId: string,
    modelRole: string,
    fallbackRole: ModelRole,
    usingFallback: boolean,
    onFallback: (newModelId: string) => void,
  ): Promise<ChatResponse> {
    try {
      return await this.modelRouter.chat(messages, {
        model: modelId,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        signal: options.signal,
      });
    } catch (primaryError) {
      // Try fallback model if not already using it
      if (!usingFallback) {
        try {
          const fallbackModelId = this.modelRouter.getDefaultModel(fallbackRole);
          console.warn(`[AgentRunner] Primary model (${modelRole}: ${modelId}) failed, switching to fallback (${fallbackRole}: ${fallbackModelId})`);
          onFallback(fallbackModelId);
          return await this.modelRouter.chat(messages, {
            model: fallbackModelId,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            signal: options.signal,
          });
        } catch {
          throw primaryError;
        }
      }
      throw primaryError;
    }
  }

  // -----------------------------------------------------------------------
  // Message building
  // -----------------------------------------------------------------------

  private buildMessages(
    systemPrompt: string,
    input: string,
    contextMessages?: Array<{ role: "user" | "assistant"; content: string }>,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    if (contextMessages && contextMessages.length > 0) {
      for (const msg of contextMessages) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: input });
    return messages;
  }

  // -----------------------------------------------------------------------
  // Tool execution
  // -----------------------------------------------------------------------

  private async executeToolCall(
    toolCall: ToolCall,
    taskId: string,
    turn: number,
    onEvent?: (event: AgentEvent) => void,
    accessedPages?: Map<string, { pageId: string; title: string }>,
  ): Promise<ChatMessage> {
    const toolName = toolCall.function.name;
    let toolInput: Record<string, unknown>;

    try {
      toolInput = JSON.parse(toolCall.function.arguments);
    } catch {
      const errorMsg = `Failed to parse tool arguments for "${toolName}"`;
      this.recordProgress(onEvent, taskId, turn, "error", errorMsg);
      return { role: "tool", content: JSON.stringify({ error: errorMsg }), toolCallId: toolCall.id };
    }

    this.emitEvent(onEvent, { type: "tool_call", taskId, turn, toolName, input: toolInput });
    this.recordProgress(onEvent, taskId, turn, "tool_call", `Calling tool: ${toolName}`, toolName, toolInput);

    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      const errorMsg = `Tool "${toolName}" not found in registry.`;
      const errorResult = { error: errorMsg };
      this.emitEvent(onEvent, { type: "tool_result", taskId, turn, toolName, result: errorResult });
      this.recordProgress(onEvent, taskId, turn, "error", errorMsg, toolName);
      return { role: "tool", content: JSON.stringify(errorResult), toolCallId: toolCall.id };
    }

    let result: unknown;
    try {
      result = await tool.execute(toolInput);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result = { error: `Tool "${toolName}" execution failed: ${errorMsg}` };
      this.recordProgress(onEvent, taskId, turn, "error", String(result), toolName);
    }

    this.emitEvent(onEvent, { type: "tool_result", taskId, turn, toolName, result });
    this.recordProgress(onEvent, taskId, turn, "tool_result", `Tool ${toolName} completed`, toolName, undefined, result);

    // Inject display names (originalName, kbName) into tool results FIRST
    // so that collectAccessedPages can pick up the injected names
    if (["kb_search", "wiki_browse", "expand"].includes(toolName)) {
      result = await this.injectDisplayNames(toolName, result);
    }

    // Collect accessed page IDs for source tracing (after display name injection)
    if (accessedPages) {
      this.collectAccessedPages(toolName, result, accessedPages);
    }

    let resultContent: string;
    try {
      resultContent = JSON.stringify(result);
      if (resultContent.length > 100_000) {
        resultContent = resultContent.substring(0, 100_000) + "\n...[truncated]";
      }
    } catch {
      resultContent = String(result);
    }

    return { role: "tool", content: resultContent, toolCallId: toolCall.id };
  }

  // -----------------------------------------------------------------------
  // Source tracing: collect accessed page IDs from tool results
  // -----------------------------------------------------------------------

  /**
   * Extract page IDs and titles from tool results (kb_search, wiki_browse,
   * expand) and add them to the accessedPages map for source tracing.
   */
  private collectAccessedPages(
    toolName: string,
    result: unknown,
    accessedPages: Map<string, {
      pageId: string;
      title: string;
      docId?: string;
      originalName?: string;
      kbName?: string;
      sectionTitle?: string;
      pageNumber?: number | null;
      anchorId?: string;
    }>,
  ): void {
    try {
      const obj = result as Record<string, unknown>;
      if (!obj || typeof obj !== "object") return;

      if (toolName === "kb_search" && Array.isArray(obj.results)) {
        for (const r of obj.results as Array<Record<string, unknown>>) {
          if (typeof r.pageId === "string" && typeof r.title === "string") {
            accessedPages.set(r.pageId, {
              pageId: r.pageId,
              title: r.title,
              docId: typeof r.docId === "string" ? r.docId : undefined,
              originalName: typeof r.originalName === "string" ? r.originalName : undefined,
              kbName: typeof r.kbName === "string" ? r.kbName : undefined,
              sectionTitle: typeof r.sectionTitle === "string" ? r.sectionTitle : undefined,
              anchorId: typeof r.anchorId === "string" ? r.anchorId : undefined,
            });
          }
        }
      } else if (toolName === "wiki_browse") {
        // wiki_browse returns { page: { id, title } } when viewing a specific page
        const page = obj.page as Record<string, unknown> | undefined;
        if (page && typeof page.id === "string" && typeof page.title === "string") {
          accessedPages.set(page.id, {
            pageId: page.id,
            title: page.title,
            docId: typeof page.docId === "string" ? page.docId : undefined,
            originalName: typeof page.originalName === "string" ? page.originalName : undefined,
            kbName: typeof page.kbName === "string" ? page.kbName : undefined,
            sectionTitle: typeof page.sectionTitle === "string" ? page.sectionTitle : undefined,
            pageNumber: typeof page.pageNumber === "number" ? page.pageNumber : undefined,
            anchorId: typeof page.anchorId === "string" ? page.anchorId : undefined,
          });
        }
        // Also collect pages from listed results
        if (Array.isArray(obj.pages)) {
          for (const p of obj.pages as Array<Record<string, unknown>>) {
            if (typeof p.id === "string" && typeof p.title === "string") {
              accessedPages.set(p.id, { pageId: p.id, title: p.title });
            }
          }
        }
      } else if (toolName === "expand" && obj.result) {
        const expandResult = obj.result as Record<string, unknown>;
        if (typeof expandResult.pageId === "string" && typeof expandResult.title === "string") {
          accessedPages.set(expandResult.pageId, {
            pageId: expandResult.pageId,
            title: expandResult.title,
            docId: typeof expandResult.docId === "string" ? expandResult.docId : undefined,
            originalName: typeof expandResult.originalName === "string" ? expandResult.originalName : undefined,
            kbName: typeof expandResult.kbName === "string" ? expandResult.kbName : undefined,
            sectionTitle: typeof expandResult.sectionTitle === "string" ? expandResult.sectionTitle : undefined,
            pageNumber: typeof expandResult.pageNumber === "number" ? expandResult.pageNumber : undefined,
            anchorId: typeof expandResult.anchorId === "string" ? expandResult.anchorId : undefined,
          });
        }
      }
    } catch {
      // Non-critical: source tracing should never break tool execution
    }
  }

  // -----------------------------------------------------------------------
  // Display name injection
  // -----------------------------------------------------------------------

  /**
   * Inject originalName and kbName into tool results so the LLM sees
   * user-visible file names instead of internal UUIDs.
   */
  private async injectDisplayNames(toolName: string, result: unknown): Promise<unknown> {
    try {
      if (!this.displayResolver) {
        this.displayResolver = new DisplayResolver();
      }

      const obj = result as Record<string, unknown>;
      if (!obj || typeof obj !== "object") return result;

      // Extract docIds from the result structure
      const docIds: string[] = [];

      if (toolName === "kb_search" && Array.isArray(obj.results)) {
        for (const r of obj.results as Array<Record<string, unknown>>) {
          if (typeof r.docId === "string") docIds.push(r.docId);
        }
      } else if (toolName === "wiki_browse") {
        const page = obj.page as Record<string, unknown> | undefined;
        if (page && typeof page.docId === "string") docIds.push(page.docId);
      } else if (toolName === "expand" && obj.result) {
        const expandResult = obj.result as Record<string, unknown>;
        if (typeof expandResult.docId === "string") docIds.push(expandResult.docId);
      }

      if (docIds.length === 0) return result;

      const displayMap = await this.displayResolver.resolveBatch(docIds);

      // Inject display names into result objects
      if (toolName === "kb_search" && Array.isArray(obj.results)) {
        for (const r of obj.results as Array<Record<string, unknown>>) {
          const display = displayMap[r.docId as string];
          if (display) {
            (r as Record<string, unknown>).originalName = display.originalName;
            (r as Record<string, unknown>).kbName = display.kbName;
          }
        }
      } else if (toolName === "wiki_browse") {
        const page = obj.page as Record<string, unknown> | undefined;
        if (page) {
          const display = displayMap[page.docId as string];
          if (display) {
            (page as Record<string, unknown>).originalName = display.originalName;
            (page as Record<string, unknown>).kbName = display.kbName;
          }
        }
      } else if (toolName === "expand" && obj.result) {
        const expandResult = obj.result as Record<string, unknown>;
        const display = displayMap[expandResult.docId as string];
        if (display) {
          (expandResult as Record<string, unknown>).originalName = display.originalName;
          (expandResult as Record<string, unknown>).kbName = display.kbName;
        }
      }
    } catch {
      // Non-critical: display name injection should never break tool execution
    }

    return result;
  }
  // -----------------------------------------------------------------------

  private isDone(
    content: string,
    toolCalls: ToolCall[] | undefined,
    finishReason?: string,
    agentCalledFinish?: boolean,
  ): boolean {
    if (agentCalledFinish) return true;
    // Only consider finishReason when there are no pending tool calls.
    // Some LLM providers return finishReason="stop" even with tool calls,
    // which would prematurely end the agent loop.
    if ((!toolCalls || toolCalls.length === 0) && finishReason && STOP_FINISH_REASONS.has(finishReason)) return true;
    if (!toolCalls || toolCalls.length === 0) {
      if (content && content.trim().length > 0) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Emergency compaction detection
  // -----------------------------------------------------------------------

  private isPromptTooLongError(errorMsg: string): boolean {
    const lower = errorMsg.toLowerCase();
    return (
      lower.includes("prompt_too_long") ||
      lower.includes("context_length_exceeded") ||
      lower.includes("maximum context length") ||
      lower.includes("too many tokens") ||
      lower.includes("token limit exceeded")
    );
  }

  private isTransientError(errorMsg: string): boolean {
    const lower = errorMsg.toLowerCase();
    return (
      lower.includes("rate_limit") ||
      lower.includes("rate limit") ||
      lower.includes("429") ||
      lower.includes("503") ||
      lower.includes("529") ||
      lower.includes("server error") ||
      lower.includes("internal server error") ||
      lower.includes("service unavailable") ||
      lower.includes("overloaded") ||
      lower.includes("capacity") ||
      lower.includes("timeout") ||
      lower.includes("econnrefused") ||
      lower.includes("econnreset") ||
      lower.includes("socket hang up") ||
      lower.includes("fetch failed") ||
      lower.includes("network error")
    );
  }

  // -----------------------------------------------------------------------
  // Result builder
  // -----------------------------------------------------------------------

  private buildResult(
    taskId: string,
    lastAssistantContent: string,
    messages: ChatMessage[],
    totalToolCalls: number,
    turn: number,
    totalInputTokens: number,
    totalOutputTokens: number,
    compactionEvents: Array<{ turn: number; method: string; tokensSaved: number }>,
    overrideOutput?: string,
    onEvent?: (event: AgentEvent) => void,
  ): AgentResult {
    let finalOutput = overrideOutput ?? lastAssistantContent;

    if (!finalOutput) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant" && messages[i].content) {
          finalOutput = messages[i].content;
          break;
        }
      }
    }

    const output = finalOutput || "Task completed with no output.";
    this.emitEvent(onEvent, { type: "complete", taskId, output });

    return {
      taskId,
      output,
      toolCallsCount: totalToolCalls,
      turnsUsed: turn,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      compactionEvents: compactionEvents.length > 0 ? compactionEvents : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Event helpers
  // -----------------------------------------------------------------------

  private emitEvent(
    onEvent: ((event: AgentEvent) => void) | undefined,
    event: AgentEvent,
  ): void {
    if (onEvent) {
      try { onEvent(event); } catch { /* swallow */ }
    }
  }

  private recordProgress(
    onEvent: ((event: AgentEvent) => void) | undefined,
    taskId: string,
    turn: number,
    type: AgentProgressEntry["type"],
    content: string,
    toolName?: string,
    toolInput?: Record<string, unknown>,
    toolOutput?: unknown,
  ): void {
    const entry: AgentProgressEntry = {
      turn,
      timestamp: new Date().toISOString(),
      type,
      content,
      toolName,
      toolInput,
      toolOutput,
    };
    this.emitEvent(onEvent, { type: "progress", taskId, progress: entry });
  }
}
