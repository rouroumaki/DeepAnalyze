// =============================================================================
// DeepAnalyze - Compaction Engine
// =============================================================================
// Two-level context compression: SM-compact (no API call, uses session memory)
// and Legacy compact (LLM-generated summary). Groups messages by API round-trip
// (assistant + tool results) and finds cutoff at group boundaries only.
// Includes PTL retry loop for legacy compact and circuit breaker protection.
// =============================================================================

import { ModelRouter } from "../../models/router.js";
import type { ChatMessage } from "../../models/provider.js";
import { ContextManager } from "./context-manager.js";
import { SessionMemoryManager } from "./session-memory.js";
import { repairMessageSequence } from "./message-utils.js";
import type { SessionMemoryNote, AgentSettings } from "./types.js";
import { DEFAULT_AGENT_SETTINGS } from "./types.js";
import { getCompactPrompt, formatCompactSummary, getCompactUserSummaryMessage } from "./compact-prompt.js";
import { COMPRESSION_LEVELS } from "./hierarchical-compressor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionResult {
  messages: ChatMessage[];
  method: "sm-compact" | "legacy-compact" | "hierarchical-compact" | "none";
  tokensSaved: number;
  /** Token count before compaction. Used for compact boundary metadata. */
  preCompactTokens: number;
}

/**
 * A group of messages representing one API round-trip:
 * an assistant message followed by zero or more tool result messages.
 */
interface MessageGroup {
  /** Index of the assistant message in the original array */
  assistantIndex: number;
  /** Indices of the tool result messages that follow */
  toolResultIndices: number[];
  /** Estimated token count for the entire group */
  tokenCount: number;
}

// ---------------------------------------------------------------------------
// Compaction Circuit Breaker
// ---------------------------------------------------------------------------

class CompactionCircuitBreaker {
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private circuitOpen = false;

  constructor(
    private maxFailures: number = 3,
    private resetTimeoutMs: number = 60_000,
  ) {}

  /** Check if a compaction attempt is allowed. */
  canAttempt(): boolean {
    if (!this.circuitOpen) return true;
    // Half-open: try again after resetTimeout
    if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
      this.circuitOpen = false;
      console.log("[CompactionCircuitBreaker] Entering half-open state");
      return true;
    }
    return false;
  }

  /** Record a successful compaction — reset and close. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
  }

  /** Record a failed compaction — open circuit after maxFailures. */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.maxFailures) {
      this.circuitOpen = true;
      console.warn(
        `[CompactionCircuitBreaker] Circuit opened after ${this.consecutiveFailures} consecutive failures`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// CompactionEngine
// ---------------------------------------------------------------------------

export class CompactionEngine {
  private modelRouter: ModelRouter;
  private contextManager: ContextManager;
  private circuitBreaker = new CompactionCircuitBreaker();
  private settings: AgentSettings;

  constructor(
    modelRouter: ModelRouter,
    contextManager: ContextManager,
    settings?: Partial<AgentSettings>,
  ) {
    this.modelRouter = modelRouter;
    this.contextManager = contextManager;
    this.settings = { ...DEFAULT_AGENT_SETTINGS, ...settings };
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  /**
   * Compact messages using the best available strategy.
   * Priority: Hierarchical compact (no session memory) > SM-compact (session memory) > Legacy compact.
   * Circuit breaker protects against repeated compaction failures.
   */
  async compact(
    messages: ChatMessage[],
    sessionMemory: SessionMemoryManager | null,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    if (!this.circuitBreaker.canAttempt()) {
      console.warn("[CompactionEngine] Circuit breaker open, skipping compaction");
      return { messages, method: "none", tokensSaved: 0, preCompactTokens: 0 };
    }

    const memory = await sessionMemory?.load() ?? null;

    try {
      // Try hierarchical compact first
      if (!memory) {
        const result = await this.hierarchicalCompact(messages, signal);
        if (result.method !== "none") {
          this.circuitBreaker.recordSuccess();
          return result;
        }
      }

      // Try SM-compact (no API call needed)
      if (memory) {
        const result = this.smCompact(messages, memory);
        if (result.method !== "none") {
          this.circuitBreaker.recordSuccess();
        }
        return result;
      }

      // Fall back to legacy compact (one LLM call with PTL retry)
      const result = await this.legacyCompact(messages, signal);
      if (result.method !== "none") {
        this.circuitBreaker.recordSuccess();
      }
      return result;
    } catch (err) {
      this.circuitBreaker.recordFailure();
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // SM-Compact: Replace old messages with session memory summary
  // -----------------------------------------------------------------------

  /**
   * SM-compact replaces old conversation messages with a compact summary
   * derived from session memory. No API call is needed.
   * Uses settings-based min/max token budget for cutoff calculation.
   */
  smCompact(
    messages: ChatMessage[],
    memory: SessionMemoryNote,
  ): CompactionResult {
    const tokensBefore = this.contextManager.estimateMessagesTokens(messages);
    const keepRecentTokens = this.calculateKeepRecentTokens();

    // Find the cutoff at a group boundary
    const cutoff = this.findCompactionCutoff(messages, keepRecentTokens);

    if (cutoff <= 1) {
      return { messages, method: "none", tokensSaved: 0, preCompactTokens: tokensBefore };
    }

    // Truncate oversized memory content to fit within budget
    const truncatedMemory = this.truncateSessionMemory(memory, keepRecentTokens);

    // Keep: system message (0) + memory summary + recent messages (cutoff..end)
    const memorySummary = this.buildMemorySummaryMessage(truncatedMemory);
    const recentMessages = messages.slice(cutoff);

    let compacted: ChatMessage[] = [
      messages[0], // system prompt
      memorySummary,
      ...recentMessages,
    ];

    // Repair any message sequence violations
    compacted = repairMessageSequence(compacted);

    const tokensAfter = this.contextManager.estimateMessagesTokens(compacted);
    const tokensSaved = tokensBefore - tokensAfter;

    return {
      messages: compacted,
      method: "sm-compact",
      tokensSaved: Math.max(0, tokensSaved),
      preCompactTokens: tokensBefore,
    };
  }

  // -----------------------------------------------------------------------
  // Legacy Compact: LLM-generated summary with PTL retry
  // -----------------------------------------------------------------------

  /**
   * Legacy compact uses a summarizer LLM to generate a summary of old
   * messages, then replaces them with the summary.
   * Includes PTL (prompt-too-long) retry loop: if the summarizer call
   * itself is too long, truncates the oldest message groups and retries
   * up to 3 times before falling back to a truncation summary.
   */
  async legacyCompact(
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    const tokensBefore = this.contextManager.estimateMessagesTokens(messages);
    const keepRecentTokens = this.calculateKeepRecentTokens();

    const cutoff = this.findCompactionCutoff(messages, keepRecentTokens);

    if (cutoff <= 1) {
      return { messages, method: "none", tokensSaved: 0, preCompactTokens: tokensBefore };
    }

    // PTL retry loop: up to 3 attempts, truncating oldest groups on PTL errors
    const MAX_PTL_RETRIES = 3;
    let summary = "";
    let summaryStart = 1; // Start index for messages to summarize

    for (let attempt = 0; attempt < MAX_PTL_RETRIES; attempt++) {
      try {
        const oldMessages = messages.slice(summaryStart, cutoff);
        if (oldMessages.length === 0) {
          summary = this.truncationSummary(messages.slice(1, cutoff));
          break;
        }
        summary = await this.generateSummary(oldMessages, signal);
        break; // Success
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (this.isPromptTooLongError(errorMsg) && attempt < MAX_PTL_RETRIES - 1) {
          // Drop the oldest group from the summary range and retry
          console.warn(
            `[CompactionEngine] Summary PTL error (attempt ${attempt + 1}/${MAX_PTL_RETRIES}), truncating old messages`,
          );
          const groups = this.groupMessages(messages.slice(summaryStart, cutoff));
          if (groups.length > 1) {
            // Skip the first group: move summaryStart to the second group's position
            summaryStart += groups[1]!.assistantIndex;
          } else {
            // Only one group or fewer — can't truncate further
            summary = this.truncationSummary(messages.slice(summaryStart, cutoff));
            break;
          }
        } else {
          // Non-PTL error or retries exhausted — fall back to truncation summary
          console.warn(`[CompactionEngine] Summary generation failed: ${errorMsg}`);
          summary = this.truncationSummary(messages.slice(summaryStart, cutoff));
          break;
        }
      }
    }

    const summaryMessage: ChatMessage = {
      role: "user",
      content: getCompactUserSummaryMessage(summary, { isAutoCompact: true }),
    };

    const recentMessages = messages.slice(cutoff);
    let compacted: ChatMessage[] = [
      messages[0], // system prompt
      summaryMessage,
      ...recentMessages,
    ];

    // Repair any message sequence violations
    compacted = repairMessageSequence(compacted);

    const tokensAfter = this.contextManager.estimateMessagesTokens(compacted);
    const tokensSaved = tokensBefore - tokensAfter;

    return {
      messages: compacted,
      method: "legacy-compact",
      tokensSaved: Math.max(0, tokensSaved),
      preCompactTokens: tokensBefore,
    };
  }

  // -----------------------------------------------------------------------
  // Hierarchical Compact: D2/D1/Leaf layers with different granularity
  // -----------------------------------------------------------------------

  /**
   * Hierarchical compression: split messages into D2/D1/Leaf layers
   * with different compression granularity per layer.
   */
  async hierarchicalCompact(
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    const tokensBefore = this.contextManager.estimateMessagesTokens(messages);

    // Group messages (skip system prompt at index 0)
    // Note: groupMessages returns indices relative to the sliced array,
    // so we add +1 when indexing into the original messages array.
    const sliced = messages.slice(1);
    const groups = this.groupMessages(sliced);
    if (groups.length < 3) {
      return { messages, method: "none", tokensSaved: 0, preCompactTokens: tokensBefore };
    }

    // Split into thirds
    const d2End = Math.floor(groups.length / 3);
    const d1End = Math.floor(groups.length * 2 / 3);

    // Generate summaries for D2 and D1 layers
    const d2Groups = groups.slice(0, d2End);
    const d1Groups = groups.slice(d2End, d1End);

    let d2Summary = "";
    let d1Summary = "";

    try {
      if (d2Groups.length > 0) {
        const d2Msgs = this.flattenGroups(sliced, d2Groups);
        d2Summary = await this.generateSummaryWithPrompt(d2Msgs, COMPRESSION_LEVELS[0].prompt, signal);
      }
    } catch {
      d2Summary = this.truncationSummary(this.flattenGroups(sliced, d2Groups));
    }

    try {
      if (d1Groups.length > 0) {
        const d1Msgs = this.flattenGroups(sliced, d1Groups);
        d1Summary = await this.generateSummaryWithPrompt(d1Msgs, COMPRESSION_LEVELS[1].prompt, signal);
      }
    } catch {
      d1Summary = this.truncationSummary(this.flattenGroups(sliced, d1Groups));
    }

    // Assemble compacted messages — leaf starts at d1End boundary
    // +1 to convert from sliced-index back to original messages index
    const leafStart = (groups[d1End]?.assistantIndex ?? messages.length - 2) + 1;
    const leafMessages = messages.slice(leafStart);

    const summaryParts: string[] = [];
    if (d2Summary) summaryParts.push(`## 早期对话摘要\n${d2Summary}`);
    if (d1Summary) summaryParts.push(`## 近期对话摘要\n${d1Summary}`);

    const compacted: ChatMessage[] = [
      messages[0], // system prompt
      {
        role: "user",
        content: `[分层压缩上下文]\n${summaryParts.join("\n\n")}\n\n以下是最新的对话内容：`,
      },
      ...leafMessages,
    ];

    const repaired = repairMessageSequence(compacted);
    const tokensAfter = this.contextManager.estimateMessagesTokens(repaired);

    return {
      messages: repaired,
      method: "hierarchical-compact",
      tokensSaved: Math.max(0, tokensBefore - tokensAfter),
      preCompactTokens: tokensBefore,
    };
  }

  /**
   * Flatten groups back to messages by looking up original indices.
   */
  private flattenGroups(messages: ChatMessage[], groups: MessageGroup[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    for (const group of groups) {
      result.push(messages[group.assistantIndex]);
      for (const idx of group.toolResultIndices) {
        result.push(messages[idx]);
      }
    }
    return result;
  }

  /**
   * Generate a summary using a specific compression-level prompt.
   */
  private async generateSummaryWithPrompt(
    messages: ChatMessage[],
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const summarizerModel = this.modelRouter.getDefaultModel("summarizer");
    const serialized = messages
      .map(m => `[${m.role}]: ${(m.content ?? "").slice(0, 2000)}`)
      .join("\n\n");

    const response = await this.modelRouter.chat(
      [
        { role: "system", content: prompt },
        { role: "user", content: serialized },
      ],
      { model: summarizerModel, maxTokens: 2000, signal },
    );
    return response.content || "";
  }

  // -----------------------------------------------------------------------
  // Message grouping
  // -----------------------------------------------------------------------

  /**
   * Group messages by API round-trip (assistant + following tool results).
   * System messages and user messages are standalone (not grouped).
   */
  groupMessages(messages: ChatMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === "assistant") {
        // Start a new group for this assistant message
        currentGroup = {
          assistantIndex: i,
          toolResultIndices: [],
          tokenCount: this.contextManager.estimateMessagesTokens([msg]),
        };
        groups.push(currentGroup);
      } else if (msg.role === "tool" && currentGroup) {
        // Add to the current group
        currentGroup.toolResultIndices.push(i);
        currentGroup.tokenCount += this.contextManager.estimateMessagesTokens([msg]);
      } else {
        // User or system message — finalize current group
        currentGroup = null;
      }
    }

    return groups;
  }

  // -----------------------------------------------------------------------
  // Cutoff finding (group-boundary-aware)
  // -----------------------------------------------------------------------

  /**
   * Find the index at which to cut the message array for compaction.
   * Uses group boundaries to ensure assistant-tool pairings are preserved.
   * Always returns the index of an assistant message (group start).
   * Returns 1 if no group boundary is suitable (meaning nothing to compact).
   */
  findCompactionCutoff(
    messages: ChatMessage[],
    keepRecentTokens: number,
  ): number {
    const groups = this.groupMessages(messages);

    if (groups.length === 0) {
      // No assistant groups — can't compact at group boundaries
      return 1;
    }

    let accumulated = 0;
    // Walk backwards from the last group
    for (let g = groups.length - 1; g >= 0; g--) {
      accumulated += groups[g].tokenCount;
      if (accumulated > keepRecentTokens) {
        // Return this group's assistant index — this is the cutoff point
        // Everything from this group onward stays
        return groups[g].assistantIndex;
      }
    }

    // All groups fit within budget — nothing to compact
    return 1;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Calculate the number of recent tokens to keep during compaction.
   * Uses 60% of effective window as target, clamped to settings-based
   * min/max bounds (smCompactMinTokens / smCompactMaxTokens).
   */
  private calculateKeepRecentTokens(): number {
    const { effectiveWindow } = this.contextManager.getContextWindow();
    let target = Math.floor(effectiveWindow * 0.6);
    target = Math.max(
      this.settings.smCompactMinTokens,
      Math.min(this.settings.smCompactMaxTokens, target),
    );
    return target;
  }

  /**
   * Truncate session memory content if it exceeds the budget allocation.
   * Memory gets at most 30% of the recent token budget.
   */
  private truncateSessionMemory(
    memory: SessionMemoryNote,
    budgetTokens: number,
  ): SessionMemoryNote {
    const memoryTokens = this.contextManager.estimateTextTokens(memory.content);
    const maxMemoryTokens = Math.floor(budgetTokens * 0.3);

    if (memoryTokens <= maxMemoryTokens) {
      return memory;
    }

    // Approximate character limit from token limit (~3 chars per token)
    const maxChars = Math.floor(maxMemoryTokens * 3);
    return {
      ...memory,
      content:
        memory.content.slice(0, maxChars) +
        "\n\n[... memory truncated to fit context budget]",
    };
  }

  private buildMemorySummaryMessage(memory: SessionMemoryNote): ChatMessage {
    return {
      role: "user",
      content: `[Context from earlier in this session]\n${memory.content}`,
    };
  }

  /**
   * Generate a summary of old messages using the summarizer LLM.
   * Errors are NOT caught here — callers handle PTL retry and fallback.
   */
  private async generateSummary(
    oldMessages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    const summarizerModel = this.modelRouter.getDefaultModel("summarizer");
    const summaryPrompt = getCompactPrompt();

    const serialized = oldMessages
      .map((m) => {
        const content = m.content ?? "";
        // Tool results get more space (3000 chars), others 1000
        const limit = m.role === "tool" ? 3000 : 1000;
        return `[${m.role}]: ${content.slice(0, limit)}`;
      })
      .join("\n\n");

    const response = await this.modelRouter.chat(
      [
        { role: "system", content: summaryPrompt },
        { role: "user", content: serialized },
      ],
      {
        model: summarizerModel,
        maxTokens: 2000,
        signal,
      },
    );
    return formatCompactSummary(response.content || "Previous conversation was compacted.");
  }

  private truncationSummary(messages: ChatMessage[]): string {
    const userMsgs = messages.filter((m) => m.role === "user");
    const topics = userMsgs
      .map((m) => (m.content ?? "").slice(0, 100))
      .filter((c) => c.length > 0);

    if (topics.length === 0) {
      return "Previous conversation was compacted to save space.";
    }

    return `Previous conversation covered these topics:\n${topics.map((t) => `- ${t}`).join("\n")}`;
  }

  /**
   * Check if an error message indicates a prompt-too-long / context-length
   * exceeded error from the LLM provider.
   */
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
}
