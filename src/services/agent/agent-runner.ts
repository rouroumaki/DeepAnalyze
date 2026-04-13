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
import { SettingsStore } from "../../store/settings.js";
import type {
  AgentDefinition,
  AgentRunOptions,
  AgentResult,
  AgentEvent,
  AgentProgressEntry,
} from "./types.js";
import type {
  ChatMessage,
  ChatResponse,
  ToolCall,
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
  maxTurns: 50,
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
    const settingsStore = new SettingsStore();
    const agentSettings = settingsStore.getAgentSettings();

    // Resolve effective turn limit (API override > settings > definition > default)
    const advisoryLimit = options.maxTurns ?? definition.maxTurns ?? agentSettings.maxTurns;
    const isUnlimited = advisoryLimit === -1;
    const hardLimit = isUnlimited ? Infinity : advisoryLimit * 3;

    const modelRole = options.modelRole ?? definition.modelRole ?? "main";
    const modelId = this.modelRouter.getDefaultModel(modelRole);
    const effectiveSystemPrompt = options.systemPromptOverride ?? definition.systemPrompt;

    // Build initial messages
    const messages = this.buildMessages(
      effectiveSystemPrompt,
      options.input,
      options.contextMessages,
    );

    const effectiveTools = options.toolsOverride ?? definition.tools;
    const toolDefs = this.toolRegistry.buildToolDefinitions(effectiveTools);

    // Track execution state
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastAssistantContent = "";
    const compactionEvents: Array<{ turn: number; method: string; tokensSaved: number }> = [];

    // Track accessed wiki pages for source tracing
    const accessedPages = new Map<string, { pageId: string; title: string }>();

    // Initialize context management components (reused across turns, L1/L2 fix)
    const contextManager = new ContextManager(this.modelRouter, modelId, toolDefs, agentSettings);
    const microCompactor = new MicroCompactor();
    const compactionEngine = new CompactionEngine(this.modelRouter, contextManager);

    // Initialize SessionMemory (if sessionId is provided)
    let sessionMemory: SessionMemoryManager | null = null;
    if (options.sessionId) {
      sessionMemory = new SessionMemoryManager(this.modelRouter, options.sessionId, agentSettings);
      const memory = sessionMemory.load();
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
    let emergencyCompacted = false;

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

      // 4. Call the LLM
      let response: ChatResponse;
      try {
        response = await this.modelRouter.chat(messages, {
          model: modelId,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          signal: options.signal,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Emergency compaction: detect prompt_too_long errors
        if (this.isPromptTooLongError(errorMsg) && !emergencyCompacted) {
          console.log("[AgentRunner] prompt_too_long detected, triggering emergency compaction");
          emergencyCompacted = true;
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

        this.recordProgress(options.onEvent, taskId, turn, "error", `Model call failed: ${errorMsg}`);
        this.emitEvent(options.onEvent, { type: "error", taskId, error: errorMsg });
        return this.buildResult(taskId, lastAssistantContent, messages, totalToolCalls, turn, totalInputTokens, totalOutputTokens, compactionEvents, `Agent failed: ${errorMsg}`, options.onEvent);
      }

      // 5. Track token usage
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
          const memory = sessionMemory.load();
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
        const { eventBus } = require("../event-bus.js");
        eventBus.emit({
          type: "agent_task_complete",
          sessionId: options.sessionId ?? "",
          taskId,
          agentType,
          output: finalOutput,
        });

        // Trigger compound with source tracing
        const { KnowledgeCompounder } = require("../../wiki/knowledge-compound.js");
        const { DEEPANALYZE_CONFIG } = require("../../core/config.js");
        const compounder = new KnowledgeCompounder(DEEPANALYZE_CONFIG.dataDir);
        compounder.compoundWithTracing(
          kbId,
          agentType,
          options.input,
          finalOutput,
          Array.from(accessedPages.values()),
        );
      } catch (err) {
        // Compound failure should not break the agent flow
        console.warn("[AgentRunner] Auto-compound failed:", err instanceof Error ? err.message : String(err));
      }
    }

    return result;
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

    // Collect accessed page IDs for source tracing
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
    accessedPages: Map<string, { pageId: string; title: string }>,
  ): void {
    try {
      const obj = result as Record<string, unknown>;
      if (!obj || typeof obj !== "object") return;

      if (toolName === "kb_search" && Array.isArray(obj.results)) {
        for (const r of obj.results as Array<Record<string, unknown>>) {
          if (typeof r.pageId === "string" && typeof r.title === "string") {
            accessedPages.set(r.pageId, { pageId: r.pageId, title: r.title });
          }
        }
      } else if (toolName === "wiki_browse") {
        // wiki_browse returns { page: { id, title } } when viewing a specific page
        const page = obj.page as Record<string, unknown> | undefined;
        if (page && typeof page.id === "string" && typeof page.title === "string") {
          accessedPages.set(page.id, { pageId: page.id, title: page.title });
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
          accessedPages.set(expandResult.pageId, { pageId: expandResult.pageId, title: expandResult.title });
        }
      }
    } catch {
      // Non-critical: source tracing should never break tool execution
    }
  }

  // -----------------------------------------------------------------------
  // Completion detection
  // -----------------------------------------------------------------------

  private isDone(
    content: string,
    toolCalls: ToolCall[] | undefined,
    finishReason?: string,
    agentCalledFinish?: boolean,
  ): boolean {
    if (agentCalledFinish) return true;
    if (finishReason && STOP_FINISH_REASONS.has(finishReason)) return true;
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
