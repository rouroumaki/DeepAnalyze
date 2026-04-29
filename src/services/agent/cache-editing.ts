// =============================================================================
// DeepAnalyze - Cache Editing
// =============================================================================
// Truncates old tool results when sending to the API, without modifying the
// local message array. This preserves the cache prefix (system prompt + tool
// definitions) so prompt caching remains effective across turns.
//
// Reference: claude-code microCompact
// =============================================================================

import type { ChatMessage } from "../../models/provider.js";

/**
 * Options for cache editing behaviour.
 */
export interface CacheEditOptions {
  /** Keep recent N assistant turns' tool results untouched. Default: 10 */
  keepRecentTurns: number;
  /** Max chars per tool result before truncation. Default: 8000 */
  maxResultChars: number;
}

const DEFAULT_CACHE_EDIT_OPTIONS: CacheEditOptions = {
  keepRecentTurns: 10,
  maxResultChars: 8000,
};

/**
 * Apply cache editing to messages for API submission.
 * Returns a **new** array — original messages are never modified.
 * Truncates old tool results that exceed `maxResultChars`.
 */
export function applyCacheEditing(
  messages: ChatMessage[],
  options: CacheEditOptions = DEFAULT_CACHE_EDIT_OPTIONS,
): ChatMessage[] {
  const { keepRecentTurns, maxResultChars } = options;

  // If there are no messages, skip processing.
  if (messages.length === 0) return [];

  // keepRecentTurns = 0 means "all turns are old" — everything is eligible.
  if (keepRecentTurns <= 0) {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        if (content.length > maxResultChars) {
          return {
            ...msg,
            content:
              content.slice(0, maxResultChars) +
              `\n\n[... result truncated (${Math.round(content.length / 1024)}KB total), removed for context management ...]`,
          };
        }
      }
      return msg;
    });
  }

  // Calculate cutoff index based on assistant turn count (from end)
  let assistantTurns = 0;
  let cutoffIndex = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      assistantTurns++;
      if (assistantTurns >= keepRecentTurns) {
        cutoffIndex = i;
        break;
      }
    }
  }

  // If we never hit the threshold, all messages are "recent" — nothing to
  // truncate.  Return a shallow copy for consistency.
  if (assistantTurns < keepRecentTurns) {
    return messages.map((msg) => msg);
  }

  // Truncate old tool results above the cutoff
  return messages.map((msg, idx) => {
    if (idx < cutoffIndex && msg.role === "tool") {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      if (content.length > maxResultChars) {
        return {
          ...msg,
          content:
            content.slice(0, maxResultChars) +
            `\n\n[... result truncated (${Math.round(content.length / 1024)}KB total), removed for context management ...]`,
        };
      }
    }
    return msg;
  });
}
