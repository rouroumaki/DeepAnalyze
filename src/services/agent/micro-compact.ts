// =============================================================================
// DeepAnalyze - Micro Compactor
// =============================================================================
// Lightweight cleanup of old tool result messages. Replaces verbose tool
// results with compact placeholders that preserve tool name and arg summary.
// =============================================================================

import type { ChatMessage } from "../../models/provider.js";

// ---------------------------------------------------------------------------
// MicroCompactor
// ---------------------------------------------------------------------------

export interface MicroCompactResult {
  messages: ChatMessage[];
  prunedCount: number;
}

export class MicroCompactor {
  /**
   * Prune old tool result messages by replacing their content with a
   * descriptive placeholder that preserves tool name and arguments.
   *
   * Strategy: Count assistant messages from the end. Any tool result message
   * that appears before the last `keepTurns` assistant messages gets
   * its content replaced.
   *
   * @param messages  The current conversation messages
   * @param keepTurns Number of recent assistant turns to preserve
   * @returns Pruned messages and count of pruned items
   */
  prune(messages: ChatMessage[], keepTurns: number = 10): MicroCompactResult {
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
      return { messages, prunedCount: 0 };
    }

    // Build a map of toolCallId → { toolName, argsSnippet } from assistant messages
    const toolCallInfo = new Map<string, { toolName: string; argsSnippet: string }>();
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          let argsSnippet = "";
          try {
            const parsed = JSON.parse(tc.function.arguments);
            // Take the first argument's value, truncated
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

    // Replace tool result content before the cutoff with informative placeholders
    let prunedCount = 0;
    const result: ChatMessage[] = messages.map((msg, idx) => {
      if (idx < cutoffIndex && msg.role === "tool") {
        const content = msg.content ?? "";
        // Only prune if the content is actually long (>200 chars)
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

    return { messages: result, prunedCount };
  }
}
