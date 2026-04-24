// =============================================================================
// DeepAnalyze - Micro Compactor
// =============================================================================
// Token-aware cleanup of tool result messages. Replaces verbose tool
// results with compact placeholders that preserve tool name and arg summary.
// =============================================================================

import type { ChatMessage } from "../../models/provider.js";
import type { ModelRouter } from "../../models/router.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MicroCompactResult {
  messages: ChatMessage[];
  prunedCount: number;
  tokensSaved: number;
}

export interface MicroCompactOptions {
  /** Number of recent tool results to protect from pruning. Default: 10 */
  keepRecent: number;
  /** Max tokens per tool result before truncation. Default: 8000 */
  maxTokens: number;
  /** ModelRouter for token estimation */
  modelRouter: ModelRouter;
}

// ---------------------------------------------------------------------------
// MicroCompactor
// ---------------------------------------------------------------------------

export class MicroCompactor {
  /**
   * Prune old or oversized tool result messages by replacing their content
   * with descriptive placeholders.
   *
   * Strategy (token-aware):
   * 1. Find all tool result messages and estimate their tokens
   * 2. Protect the most recent `keepRecent` tool results from pruning
   * 3. For unprotected results exceeding `maxTokens`, truncate to placeholder
   *
   * @param messages The current conversation messages
   * @param options  Token-aware pruning options
   */
  prune(messages: ChatMessage[], options: MicroCompactOptions): MicroCompactResult;
  /**
   * Legacy overload: turn-count-based pruning (backwards compatible).
   */
  prune(messages: ChatMessage[], keepTurns: number): MicroCompactResult;
  prune(messages: ChatMessage[], optionsOrKeepTurns: MicroCompactOptions | number): MicroCompactResult {
    // Handle legacy overload
    if (typeof optionsOrKeepTurns === "number") {
      return this.pruneByTurnCount(messages, optionsOrKeepTurns);
    }
    return this.pruneByTokenBudget(messages, optionsOrKeepTurns);
  }

  // -----------------------------------------------------------------------
  // Token-aware pruning (new)
  // -----------------------------------------------------------------------

  private pruneByTokenBudget(
    messages: ChatMessage[],
    options: MicroCompactOptions,
  ): MicroCompactResult {
    const { keepRecent, maxTokens, modelRouter } = options;

    // Build tool call info map for descriptive placeholders
    const toolCallInfo = this.buildToolCallInfoMap(messages);

    // Collect all tool result message indices
    const toolResultIndices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "tool") {
        toolResultIndices.push(i);
      }
    }

    // The last `keepRecent` tool results are protected
    // Note: slice(-0) === slice(0) returns ALL elements, so handle keepRecent=0 explicitly
    const protectedSet = keepRecent > 0
      ? new Set(toolResultIndices.slice(-keepRecent))
      : new Set<number>();

    let prunedCount = 0;
    let tokensSaved = 0;
    const result: ChatMessage[] = messages.map((msg, idx) => {
      if (msg.role !== "tool" || protectedSet.has(idx)) {
        return msg;
      }

      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
      const estimatedTokens = modelRouter.estimateTokens(content);

      if (estimatedTokens > maxTokens) {
        prunedCount++;
        tokensSaved += estimatedTokens - 50; // ~50 tokens for placeholder

        const info = toolCallInfo.get(msg.toolCallId ?? "");
        if (info) {
          return {
            ...msg,
            content: `[Pruned: ${info.toolName}("${info.argsSnippet}") — result trimmed (${estimatedTokens} tokens → placeholder)]`,
          };
        }
        return {
          ...msg,
          content: `[Tool result pruned to save context (${estimatedTokens} tokens)]`,
        };
      }

      return msg;
    });

    return { messages: result, prunedCount, tokensSaved };
  }

  // -----------------------------------------------------------------------
  // Turn-count-based pruning (legacy, backwards compatible)
  // -----------------------------------------------------------------------

  private pruneByTurnCount(messages: ChatMessage[], keepTurns: number): MicroCompactResult {
    // Find the cutoff: the index of the Nth-from-last assistant message
    let assistantCount = 0;
    let cutoffIndex = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        assistantCount++;
        if (assistantCount >= keepTurns) {
          cutoffIndex = i;
          break;
        }
      }
    }

    if (assistantCount < keepTurns) {
      return { messages, prunedCount: 0, tokensSaved: 0 };
    }

    const toolCallInfo = this.buildToolCallInfoMap(messages);

    let prunedCount = 0;
    const result: ChatMessage[] = messages.map((msg, idx) => {
      if (idx < cutoffIndex && msg.role === "tool") {
        const content = msg.content ?? "";
        if (content.length > 200) {
          prunedCount++;
          const info = toolCallInfo.get(msg.toolCallId ?? "");
          if (info) {
            return {
              ...msg,
              content: `[Pruned: ${info.toolName}("${info.argsSnippet}") — result trimmed to save context]`,
            };
          }
          return {
            ...msg,
            content: "[Tool result pruned to save context space]",
          };
        }
      }
      return msg;
    });

    return { messages: result, prunedCount, tokensSaved: 0 };
  }

  // -----------------------------------------------------------------------
  // Shared helper
  // -----------------------------------------------------------------------

  private buildToolCallInfoMap(messages: ChatMessage[]): Map<string, { toolName: string; argsSnippet: string }> {
    const toolCallInfo = new Map<string, { toolName: string; argsSnippet: string }>();
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          let argsSnippet = "";
          try {
            const parsed = JSON.parse(tc.function.arguments);
            const firstVal = Object.values(parsed)[0];
            if (typeof firstVal === "string") {
              argsSnippet = firstVal.slice(0, 80);
            } else {
              argsSnippet = JSON.stringify(firstVal).slice(0, 80);
            }
          } catch {
            argsSnippet = tc.function.arguments.slice(0, 80);
          }
          toolCallInfo.set(tc.id, { toolName: tc.function.name, argsSnippet });
        }
      }
    }
    return toolCallInfo;
  }
}
