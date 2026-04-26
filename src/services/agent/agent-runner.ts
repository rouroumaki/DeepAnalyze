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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  AgentSettings,
  CompactBoundaryMeta,
} from "./types.js";
import { DEFAULT_AGENT_SETTINGS } from "./types.js";
import { SUB_AGENT_BLOCKED_TOOLS } from "./tool-setup.js";
import type { HookManager } from "./hooks.js";
import type {
  ChatMessage,
  ChatResponse,
  ChatOptions,
  ToolCall,
  ToolDefinition,
  ModelRole,
  StreamChunk,
} from "../../models/provider.js";

// ---------------------------------------------------------------------------
// Default agent definition (used when no agent type is specified)
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_DEFINITION: AgentDefinition = {
  agentType: "general",
  description: "General-purpose agent for any task",
  // [ORIGINAL ENGLISH] "You are a helpful AI assistant. Analyze the user's request carefully and use available tools as needed to accomplish the task. When you have completed the task, call the 'finish' tool with your final answer."
  systemPrompt:
    "你是一个有帮助的 AI 助手。请仔细分析用户的请求，根据需要使用可用工具来完成任务。" +
    "当你完成任务时，调用 'finish' 工具返回最终答案。\n\n" +
    "## 语言规则\n" +
    "始终使用与用户提问相同的语言进行思考和回复。如果用户用中文提问，你必须用中文思考和回复（包括 think 工具中的推理过程）；如果用户用英文提问，用英文思考和回复。工具调用参数中的技术术语和标识符保持原样。\n\n" +
    "## 完成规则\n" +
    "当你认为已经充分回答了用户的问题或完成了任务时，必须调用 'finish' 工具提交最终结果。" +
    "不要在没有调用 finish 的情况下结束。如果还有未完成的工作，继续使用工具。",
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
  private hookManager: HookManager | null = null;

  constructor(modelRouter: ModelRouter, toolRegistry: ToolRegistry, hookManager?: HookManager) {
    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;
    if (hookManager) this.hookManager = hookManager;
    this.registerAgent(DEFAULT_AGENT_DEFINITION);
  }

  /** Set or replace the hook manager. */
  setHookManager(hookManager: HookManager): void {
    this.hookManager = hookManager;
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

    // Inject scope constraints into system prompt if scope is provided
    let scopeInjection = "";
    let userInputPrefix = ""; // Scale signal goes to user message for higher visibility
    if (options.scope) {
      // Frontend sends: { knowledgeBases: [{ kbId, mode, documentIds? }], webSearch }
      const knowledgeBases = options.scope.knowledgeBases as Array<{ kbId: string; mode: string; documentIds?: string[] }> | undefined;
      if (knowledgeBases && knowledgeBases.length > 0) {
        const scopeKbIds = knowledgeBases.map(kb => kb.kbId);
        try {
          const repos = await getRepos();
          const allKbs = await repos.knowledgeBase.list();
          const kbDetails: string[] = [];
          const docDetails: string[] = [];

          for (const kbScope of knowledgeBases) {
            const kb = allKbs.find(k => k.id === kbScope.kbId);
            const kbLabel = kb ? `"${kb.name}"` : kbScope.kbId;
            kbDetails.push(`${kbLabel} (${kbScope.kbId})`);

            // If specific documents are selected, resolve their names
            if (kbScope.mode === "selected" && kbScope.documentIds && kbScope.documentIds.length > 0) {
              try {
                const docs = await repos.document.getByKbId(kbScope.kbId);
                const selectedDocs = docs.filter(d => kbScope.documentIds!.includes(d.id));
                for (const doc of selectedDocs) {
                  docDetails.push(`- ${doc.filename || doc.id} (${doc.id}) in ${kbLabel}`);
                }
              } catch {
                // Non-critical
              }
            }
          }

          const kbNames = kbDetails.join(", ");
          let injection = `\n\n## 搜索范围限制\n当前对话限定了搜索范围。你只能在以下知识库中搜索：${kbNames}。\n使用 kb_search 工具时，务必将 kbIds 参数设为 [${scopeKbIds.map(id => `"${id}"`).join(", ")}]。\n不要搜索此范围之外的知识库。`;

          if (docDetails.length > 0) {
            injection += `\n\n用户特别关注以下文档，请优先分析：\n${docDetails.join("\n")}`;
          }

          // Count total documents for scale-aware guidance
          let totalDocs = 0;
          const docCountDetails: string[] = [];
          for (const kbScope of knowledgeBases) {
            try {
              const docs = await repos.document.getByKbId(kbScope.kbId);
              const kb = allKbs.find(k => k.id === kbScope.kbId);
              const kbName = kb ? kb.name : kbScope.kbId;
              totalDocs += docs.length;
              if (docs.length > 0) {
                docCountDetails.push(`${kbName}: ${docs.length}个文档`);
              }
            } catch { /* non-critical */ }
          }

          // Inject scale signal as USER MESSAGE PREFIX (more prominent than system prompt)
          if (totalDocs > 30) {
            userInputPrefix = `[系统提示：当前知识库共包含 ${totalDocs} 个文档（${docCountDetails.join("、")}）。文档数量较多，请使用 skill_invoke 调用「全面分块分析」技能进行分块并行处理，或使用 workflow_run 创建并行工作流。]\n\n`;
            console.log(`[AgentRunner] KB scale signal injected: ${totalDocs} docs, prefix length=${userInputPrefix.length}`);
          }

          scopeInjection = injection;
        } catch {
          scopeInjection = `\n\n## 搜索范围限制\n当前对话限定了搜索范围。使用 kb_search 工具时，务必将 kbIds 参数设为 [${scopeKbIds.map(id => `"${id}"`).join(", ")}]。\n不要搜索此范围之外的知识库。`;
        }
      }
    }
    let systemPromptWithScope = effectiveSystemPrompt + scopeInjection;

    // Load .deepanalyze.md project config and inject into system prompt
    try {
      const { DEEPANALYZE_CONFIG } = await import("../../core/config.js");
      const mdPath = join(DEEPANALYZE_CONFIG.dataDir, ".deepanalyze.md");
      const md = await readFile(mdPath, "utf-8");
      if (md.trim()) {
        systemPromptWithScope += "\n\n## 项目配置\n" + md.trim();
      }
    } catch {
      // File does not exist — normal, skip
    }

    console.log(`[AgentRunner] Starting agent run: taskId=${taskId}, agentType=${agentType}, modelRole=${modelRole}, modelId=${modelId}, providers=${this.modelRouter.listProviderNames().join(",")}`);

    // Build initial messages
    const messages = this.buildMessages(
      systemPromptWithScope,
      userInputPrefix + options.input,
      options.contextMessages,
    );

    const effectiveTools = options.toolsOverride ?? definition.tools;
    // Apply recursive guard: block management tools for sub-agents (skill/workflow spawned)
    // Skill invocations are exempt — they need workflow_run to dispatch parallel analysis.
    const needsRecursiveGuard = !options.isSkillInvocation && !!(options.systemPromptOverride || options.toolsOverride);
    const filteredTools = needsRecursiveGuard
      ? effectiveTools.filter(t => !SUB_AGENT_BLOCKED_TOOLS.has(t))
      : effectiveTools;
    let toolDefs;
    try {
      toolDefs = this.toolRegistry.buildToolDefinitions(filteredTools);
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
    const compactionEngine = new CompactionEngine(this.modelRouter, contextManager, agentSettings);

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

      // 4. Call the LLM via streaming (with automatic model fallback)
      let assistantContent: string;
      let toolCalls: ToolCall[] | undefined;
      let finishReason: string | undefined;
      let turnUsage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined;
      try {
        const streamResult = await this.chatStreamWithFallback(
          messages, toolDefs, options,
          modelId, modelRole, fallbackRole,
          usingFallback,
          (newModelId: string) => { modelId = newModelId; usingFallback = true; },
          taskId, turn,
        );
        assistantContent = streamResult.content;
        toolCalls = streamResult.toolCalls.length > 0 ? streamResult.toolCalls : undefined;
        finishReason = streamResult.finishReason;
        turnUsage = streamResult.usage;
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
              // Persist compact boundary (emergency)
              this.persistCompactBoundary(
                options.sessionId,
                `emergency-${result.method}` as CompactBoundaryMeta["method"],
                result.preCompactTokens, turn,
              );
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

        // Build a user-friendly error with suggestions
        const availableProviders = this.modelRouter.listProviderNames();
        const suggestion = availableProviders.length > 0
          ? `可用的模型: ${availableProviders.join(", ")}。请在设置中检查模型配置。`
          : "请在设置中配置至少一个可用的模型。";

        return this.buildResult(taskId, lastAssistantContent, messages, totalToolCalls, turn, totalInputTokens, totalOutputTokens, compactionEvents, `模型调用失败: ${errorMsg}\n\n${suggestion}`, options.onEvent);
      }

      // 5. Track token usage
      consecutiveLLMErrors = 0; // Reset on successful response
      if (turnUsage) {
        totalInputTokens += turnUsage.inputTokens;
        totalOutputTokens += turnUsage.outputTokens;
        // Emit turn_usage event for real-time status display
        this.emitEvent(options.onEvent, { type: "turn_usage", taskId, turn, usage: turnUsage });
      }

      if (assistantContent) {
        lastAssistantContent = assistantContent;
      }

      if (assistantContent) {
        this.recordProgress(options.onEvent, taskId, turn, "text", assistantContent);
      }

      // Emit turn as boundary signal — content was already streamed via text_delta
      this.emitEvent(options.onEvent, { type: "turn", taskId, turn, content: assistantContent });

      // Build the assistant message
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantContent,
      };

      // Process tool calls
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
            agentSettings,
          );
          messages.push(toolResultMessage);

          // Handle tool_discover: dynamically inject deferred tools into available definitions
          if (toolCall.function.name === "tool_discover") {
            try {
              const rawContent = typeof toolResultMessage.content === "string"
                ? toolResultMessage.content
                : JSON.stringify(toolResultMessage.content);
              const parsed = JSON.parse(rawContent);
              if (parsed?.__activate_tools__ && Array.isArray(parsed.__activate_tools__)) {
                const newDefs = this.toolRegistry.buildToolDefinitions(parsed.__activate_tools__, true);
                if (newDefs.length > 0) {
                  // Merge new tool definitions into the active set (avoid duplicates)
                  const existingNames = new Set(toolDefs.map(d => d.name));
                  for (const def of newDefs) {
                    if (!existingNames.has(def.name)) {
                      toolDefs.push(def);
                      existingNames.add(def.name);
                    }
                  }
                  console.log(`[AgentRunner] Dynamically activated ${newDefs.length} tool(s): ${newDefs.map(d => d.name).join(", ")}`);
                }
              }
            } catch {
              // Ignore parse errors - just skip dynamic activation
            }
          }
        }
      } else {
        messages.push(assistantMessage);
      }

      // 6. Context management
      // 6a. Microcompact — use token-aware pruning when possible
      if (contextManager.shouldMicrocompact(messages)) {
        const result = microCompactor.prune(messages, {
          keepRecent: agentSettings.toolResultKeepRecent,
          maxTokens: agentSettings.toolResultMaxTokens,
          modelRouter: this.modelRouter,
        });
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
            // Persist compact boundary to DB so next request knows where to load from
            this.persistCompactBoundary(options.sessionId, result.method, result.preCompactTokens, turn);
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
      if (this.isDone(assistantContent, toolCalls, finishReason, agentCalledFinish)) {
        break;
      }
    }

    // Build final result
    const result = this.buildResult(taskId, lastAssistantContent, messages, totalToolCalls, turn, totalInputTokens, totalOutputTokens, compactionEvents, undefined, options.onEvent);

    // Auto-compound on task completion — emit event and write back to wiki
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

        const { KnowledgeCompounder, compoundWithAnchors } = await import("../../wiki/knowledge-compound.js");
        const { DEEPANALYZE_CONFIG } = await import("../../core/config.js");
        const compounder = new KnowledgeCompounder(DEEPANALYZE_CONFIG.dataDir);
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
          const anchorContent = compoundWithAnchors(kbId, agentType, options.input, finalOutput, anchorData);
          if (anchorContent) {
            await compounder.compoundAgentResult(kbId, agentType, options.input, finalOutput + "\n\n" + anchorContent);
          }
        } else {
          await compounder.compoundWithTracing(
            kbId, agentType, options.input, finalOutput,
            Array.from(accessedPages.values()).map(p => ({ pageId: p.pageId, title: p.title })),
          );
        }
      } catch (err) {
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
      const primaryMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
      // Try fallback model if not already using it
      if (!usingFallback) {
        try {
          const fallbackModelId = this.modelRouter.getDefaultModel(fallbackRole);
          // Skip fallback if it resolves to the same provider — no point retrying
          if (fallbackModelId === modelId) {
            console.warn(`[AgentRunner] Primary model (${modelRole}: ${modelId}) failed, fallback (${fallbackRole}) is the same provider — skipping. Error: ${primaryMsg}`);
            throw primaryError;
          }
          console.warn(`[AgentRunner] Primary model (${modelRole}: ${modelId}) failed (${primaryMsg.substring(0, 200)}), switching to fallback (${fallbackRole}: ${fallbackModelId})`);
          onFallback(fallbackModelId);
          return await this.modelRouter.chat(messages, {
            model: fallbackModelId,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            signal: options.signal,
          });
        } catch (fallbackError) {
          const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          if (fallbackMsg !== primaryMsg) {
            console.warn(`[AgentRunner] Fallback model (${fallbackRole}) also failed: ${fallbackMsg.substring(0, 200)}`);
          }
          throw primaryError;
        }
      }
      throw primaryError;
    }
  }

  // -----------------------------------------------------------------------
  // Streaming: consume stream + stream with fallback
  // -----------------------------------------------------------------------

  /**
   * Consume an AsyncGenerator<StreamChunk>, emitting text_delta events for
   * each content chunk and accumulating the full result.
   */
  private async consumeStream(
    stream: AsyncGenerator<StreamChunk>,
    onEvent: ((event: AgentEvent) => void) | undefined,
    taskId: string,
    turn: number,
  ): Promise<{ content: string; toolCalls: ToolCall[]; finishReason?: string; usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number } }> {
    let fullContent = "";
    const toolCallMap = new Map<number, ToolCall>();
    let finishReason: string | undefined;
    let usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined;

    for await (const chunk of stream) {
      switch (chunk.type) {
        case "text":
          if (chunk.content) {
            fullContent += chunk.content;
            this.emitEvent(onEvent, { type: "text_delta", taskId, turn, delta: chunk.content });
          }
          break;
        case "tool_call":
          if (chunk.toolCall?.id) {
            const idx = toolCallMap.size;
            toolCallMap.set(idx, chunk.toolCall as ToolCall);
          }
          break;
        case "tool_call_delta":
          if (chunk.toolCall?.function?.arguments && toolCallMap.size > 0) {
            const last = Array.from(toolCallMap.values()).pop()!;
            last.function.arguments += chunk.toolCall.function.arguments;
          }
          break;
        case "done":
          finishReason = chunk.finishReason;
          if (chunk.usage) {
            usage = chunk.usage;
          }
          break;
        case "error":
          throw new Error(chunk.error ?? "Stream error");
      }
    }
    return { content: fullContent, toolCalls: Array.from(toolCallMap.values()), finishReason, usage };
  }

  /**
   * Streaming version of chatWithFallback: calls chatStream() with automatic
   * model fallback, emitting text_delta events for each content chunk.
   */
  private async chatStreamWithFallback(
    messages: ChatMessage[],
    toolDefs: ToolDefinition[],
    options: AgentRunOptions,
    modelId: string,
    modelRole: string,
    fallbackRole: ModelRole,
    usingFallback: boolean,
    onFallback: (newModelId: string) => void,
    taskId: string,
    turn: number,
  ): Promise<{ content: string; toolCalls: ToolCall[]; finishReason?: string; usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number } }> {
    const tools = toolDefs.length > 0 ? toolDefs : undefined;
    const opts: ChatOptions = { model: modelId, tools, signal: options.signal };

    try {
      return await this.consumeStream(
        this.modelRouter.chatStream(messages, opts),
        options.onEvent, taskId, turn,
      );
    } catch (primaryError) {
      if (!usingFallback) {
        const fallbackModelId = this.modelRouter.getDefaultModel(fallbackRole);
        if (fallbackModelId === modelId) throw primaryError;
        const primaryMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
        console.warn(`[AgentRunner] Stream primary (${modelRole}: ${modelId}) failed (${primaryMsg.substring(0, 200)}), switching to fallback (${fallbackRole}: ${fallbackModelId})`);
        onFallback(fallbackModelId);
        try {
          return await this.consumeStream(
            this.modelRouter.chatStream(messages, { ...opts, model: fallbackModelId }),
            options.onEvent, taskId, turn,
          );
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

      // Context boundary: tell the model the above messages are completed
      // interactions and it should focus only on the new request below.
      // This prevents the model from re-doing completed work in multi-turn
      // conversations where history is loaded from the DB.
      const framedInput =
        "上面的消息是本次会话中已完成的交互记录。\n" +
        "请仅针对以下新请求进行响应，不要重新执行已完成的工作。\n\n" +
        input;

      messages.push({ role: "user", content: framedInput });
    } else {
      messages.push({ role: "user", content: input });
    }

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
    agentSettings?: AgentSettings,
  ): Promise<ChatMessage> {
    const toolName = toolCall.function.name;
    let toolInput: Record<string, unknown>;

    // Log tool calls for observability
    console.log(`[AgentRunner] Tool call: turn=${turn}, tool=${toolName}, task=${taskId}`);

    try {
      toolInput = JSON.parse(toolCall.function.arguments);
    } catch {
      const errorMsg = `Failed to parse tool arguments for "${toolName}"`;
      this.recordProgress(onEvent, taskId, turn, "error", errorMsg);
      return { role: "tool", content: JSON.stringify({ error: errorMsg }), toolCallId: toolCall.id };
    }

    this.emitEvent(onEvent, { type: "tool_call", taskId, turn, toolName, input: toolInput });
    this.recordProgress(onEvent, taskId, turn, "tool_call", `Calling tool: ${toolName}`, toolName, toolInput);

    // PreToolUse hook — may block execution
    if (this.hookManager) {
      const preResult = await this.hookManager.fire("PreToolUse", { toolName, toolInput, taskId });
      if (!preResult.allowed) {
        const blockMsg = preResult.error ?? `Blocked by PreToolUse hook`;
        const errorResult = { error: blockMsg };
        this.emitEvent(onEvent, { type: "tool_result", taskId, turn, toolName, result: errorResult });
        return { role: "tool", content: JSON.stringify(errorResult), toolCallId: toolCall.id };
      }
    }

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

    // PostToolUse hook — fire-and-forget (does not affect result)
    if (this.hookManager) {
      await this.hookManager.fire("PostToolUse", { toolName, toolInput, taskId }).catch(() => {});
    }

    this.emitEvent(onEvent, { type: "tool_result", taskId, turn, toolName, result });
    this.recordProgress(onEvent, taskId, turn, "tool_result", `Tool ${toolName} completed`, toolName, undefined, result);

    // Handle skill_invoke: spawn a sub-agent with the skill's prompt
    if (toolName === "skill_invoke" && result && typeof result === "object" && (result as Record<string, unknown>).__skill_invoke__) {
      const skillData = result as {
        skill: { name: string; prompt: string; tools: string[]; modelRole: string };
        input: string;
      };
      try {
        const skillResult = await this.run({
          input: skillData.input,
          systemPromptOverride: skillData.skill.prompt,
          toolsOverride: skillData.skill.tools,
          modelRole: skillData.skill.modelRole as "main" | "summarizer" | "embedding" | "vlm",
          isSkillInvocation: true,
          signal: undefined,
          onEvent,
          maxTurns: 20,
        });
        result = {
          skillName: skillData.skill.name,
          output: skillResult.output,
          turnsUsed: skillResult.turnsUsed,
          toolCallsCount: skillResult.toolCallsCount,
        };
      } catch (err) {
        result = {
          skillName: skillData.skill.name,
          error: `Skill execution failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

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
      // Apply token-based tool result budget instead of fixed 100K char limit
      const estimatedTokens = this.modelRouter.estimateTokens(resultContent);
      // Allow more tokens for expand results since they contain document content
      const baseMaxTokens = agentSettings?.toolResultMaxTokens ?? 4_000;
      const maxTokens = ["expand"].includes(toolName) ? baseMaxTokens * 3 : baseMaxTokens;
      if (estimatedTokens > maxTokens) {
        const previewChars = Math.floor(maxTokens * 3); // ~3 chars per token
        // Provide informative truncation message so the LLM can decide whether to read more
        const truncationHint = toolName === "expand"
          ? `[... 内容被截断: 共约 ${estimatedTokens} tokens, 已展示前 ~${maxTokens} tokens. 如需完整信息, 可用 heading 参数指定章节逐段阅读]`
          : `[... result truncated: ${estimatedTokens} tokens total, showing first ~${maxTokens} tokens]`;
        resultContent = resultContent.substring(0, previewChars)
          + `\n\n${truncationHint}`;
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
    // NOTE: We no longer stop on text-only responses (no tool calls + non-empty content).
    // The agent should explicitly call 'finish' or the model should return a stop finish_reason.
    // This prevents premature termination after compaction or intermediate text responses.
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
  // Compact boundary persistence
  // -----------------------------------------------------------------------

  /**
   * Persist a compact boundary marker to the session's message history.
   * This allows the route handler's context loader to skip pre-boundary
   * messages on subsequent requests, avoiding loading already-compacted
   * history that would waste the context budget.
   *
   * Fire-and-forget: boundary persistence failure is non-critical.
   */
  private persistCompactBoundary(
    sessionId: string | undefined,
    method: CompactBoundaryMeta["method"],
    preCompactTokens: number,
    turnNumber: number,
  ): void {
    if (!sessionId) return;

    const meta: CompactBoundaryMeta = {
      type: "compact_boundary",
      method,
      preCompactTokens,
      turnNumber,
      timestamp: new Date().toISOString(),
    };

    const content = `[COMPACT_BOUNDARY:${JSON.stringify(meta)}]`;

    // Fire-and-forget: don't block the TAOR loop
    getRepos()
      .then((repos) => repos.message.create(sessionId, "user", content))
      .catch((err) => {
        console.warn(
          "[AgentRunner] Failed to persist compact boundary:",
          err instanceof Error ? err.message : String(err),
        );
      });
  }

  // -----------------------------------------------------------------------
  // Emergency compaction detection
  // -----------------------------------------------------------------------

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
