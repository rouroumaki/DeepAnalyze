// prompt-cache.ts

/**
 * Prompt caching support for the agent system.
 *
 * Strategy:
 * 1. System prompt is split into static prefix (cacheable) + dynamic suffix
 * 2. Tool definitions are sorted alphabetically for cache stability
 * 3. cache_control markers placed on appropriate messages
 *
 * Reference: refcode/claude-code/src/services/api/claude.ts addCacheBreakpoints()
 */

// ---------------------------------------------------------------------------
// System prompt splitting
// ---------------------------------------------------------------------------

export interface SystemPromptParts {
  /** Static prefix (agent definition + tool descriptions) — cacheable */
  staticPrefix: string;
  /** Dynamic boundary marker */
  dynamicBoundary: string;
  /** Dynamic suffix (scope injection, session memory, project config) — changes per request */
  dynamicSuffix: string;
}

const DYNAMIC_BOUNDARY = "\n\n---DYNAMIC_BOUNDARY---\n\n";

/**
 * Split a full system prompt into static and dynamic parts.
 * Uses the DYNAMIC_BOUNDARY marker as separator.
 * If no boundary found, the entire prompt is treated as static.
 */
export function splitSystemPrompt(fullPrompt: string): SystemPromptParts {
  const boundaryIndex = fullPrompt.indexOf(DYNAMIC_BOUNDARY);

  if (boundaryIndex === -1) {
    return {
      staticPrefix: fullPrompt,
      dynamicBoundary: "",
      dynamicSuffix: "",
    };
  }

  return {
    staticPrefix: fullPrompt.slice(0, boundaryIndex),
    dynamicBoundary: DYNAMIC_BOUNDARY,
    dynamicSuffix: fullPrompt.slice(boundaryIndex + DYNAMIC_BOUNDARY.length),
  };
}

/**
 * Reassemble system prompt parts into a full prompt.
 */
export function assembleSystemPrompt(parts: SystemPromptParts): string {
  if (!parts.dynamicSuffix) return parts.staticPrefix;
  return parts.staticPrefix + parts.dynamicBoundary + parts.dynamicSuffix;
}

// ---------------------------------------------------------------------------
// Cache control for API messages
// ---------------------------------------------------------------------------

/**
 * Add cache_control hints to messages for prompt caching.
 * Places cache_control on the last user message to enable cache writing.
 *
 * Reference: refcode/claude-code/src/services/api/claude.ts addCacheBreakpoints()
 *
 * Note: The actual cache_control injection happens in the provider adapter
 * (e.g., Anthropic provider). This function marks which messages should have it.
 */
export function markCacheBreakpoints<T extends { role: string }>(
  messages: T[],
): T[] {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      // Return a new array with the last user message marked
      return messages.map((msg, idx) =>
        idx === i
          ? { ...msg, __cache_control: { type: "ephemeral" as const } }
          : msg
      );
    }
  }
  return messages;
}
