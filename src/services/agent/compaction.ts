// =============================================================================
// DeepAnalyze - Compaction Engine
// =============================================================================
// Two-level context compression: SM-compact (no API call, uses session memory)
// and Legacy compact (LLM-generated summary). Groups messages by API round-trip
// (assistant + tool results) and finds cutoff at group boundaries only.
// =============================================================================

import { ModelRouter } from "../../models/router.js";
import type { ChatMessage } from "../../models/provider.js";
import { ContextManager } from "./context-manager.js";
import { SessionMemoryManager } from "./session-memory.js";
import { repairMessageSequence } from "./message-utils.js";
import type { SessionMemoryNote } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionResult {
  messages: ChatMessage[];
  method: "sm-compact" | "legacy-compact" | "none";
  tokensSaved: number;
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
// CompactionEngine
// ---------------------------------------------------------------------------

export class CompactionEngine {
  private modelRouter: ModelRouter;
  private contextManager: ContextManager;

  constructor(modelRouter: ModelRouter, contextManager: ContextManager) {
    this.modelRouter = modelRouter;
    this.contextManager = contextManager;
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  /**
   * Compact messages using the best available strategy.
   * Priority: SM-compact (if session memory exists) > Legacy compact.
   */
  async compact(
    messages: ChatMessage[],
    sessionMemory: SessionMemoryManager | null,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    const memory = await sessionMemory?.load() ?? null;

    // Try SM-compact first (no API call needed)
    if (memory) {
      return this.smCompact(messages, memory);
    }

    // Fall back to legacy compact (one LLM call)
    return this.legacyCompact(messages, signal);
  }

  // -----------------------------------------------------------------------
  // SM-Compact: Replace old messages with session memory summary
  // -----------------------------------------------------------------------

  /**
   * SM-compact replaces old conversation messages with a compact summary
   * derived from session memory. No API call is needed.
   */
  smCompact(
    messages: ChatMessage[],
    memory: SessionMemoryNote,
  ): CompactionResult {
    const tokensBefore = this.contextManager.estimateMessagesTokens(messages);
    const { effectiveWindow } = this.contextManager.getContextWindow();
    const keepRecentTokens = Math.floor(effectiveWindow * 0.6);

    // Find the cutoff at a group boundary
    const cutoff = this.findCompactionCutoff(messages, keepRecentTokens);

    if (cutoff <= 1) {
      return { messages, method: "none", tokensSaved: 0 };
    }

    // Keep: system message (0) + memory summary + recent messages (cutoff..end)
    const memorySummary = this.buildMemorySummaryMessage(memory);
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
    };
  }

  // -----------------------------------------------------------------------
  // Legacy Compact: LLM-generated summary
  // -----------------------------------------------------------------------

  /**
   * Legacy compact uses a summarizer LLM to generate a summary of old
   * messages, then replaces them with the summary.
   */
  async legacyCompact(
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    const tokensBefore = this.contextManager.estimateMessagesTokens(messages);
    const { effectiveWindow } = this.contextManager.getContextWindow();
    const keepRecentTokens = Math.floor(effectiveWindow * 0.6);

    const cutoff = this.findCompactionCutoff(messages, keepRecentTokens);

    if (cutoff <= 1) {
      return { messages, method: "none", tokensSaved: 0 };
    }

    // Generate summary of messages 1..cutoff-1
    const oldMessages = messages.slice(1, cutoff);
    const summary = await this.generateSummary(oldMessages, signal);

    const summaryMessage: ChatMessage = {
      role: "user",
      content: `[Previous conversation summary]\n${summary}`,
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
    };
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

  private buildMemorySummaryMessage(memory: SessionMemoryNote): ChatMessage {
    return {
      role: "user",
      content: `[Context from earlier in this session]\n${memory.content}`,
    };
  }

  private async generateSummary(
    oldMessages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    const summarizerModel = this.modelRouter.getDefaultModel("summarizer");

    const summaryPrompt = `You are a conversation summarizer. Summarize the following conversation excerpt concisely, preserving key facts, decisions, and any important data. Keep the summary under 1000 words.`;

    const serialized = oldMessages
      .map((m) => {
        const content = m.content ?? "";
        // Tool results get more space (3000 chars), others 1000
        const limit = m.role === "tool" ? 3000 : 1000;
        return `[${m.role}]: ${content.slice(0, limit)}`;
      })
      .join("\n\n");

    try {
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
      return response.content || "Previous conversation was compacted.";
    } catch {
      return this.truncationSummary(oldMessages);
    }
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
}
