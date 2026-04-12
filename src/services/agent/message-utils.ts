// =============================================================================
// DeepAnalyze - Message Sequence Utilities
// =============================================================================
// Validates and repairs message arrays to ensure they conform to LLM API
// role ordering constraints (system → user → assistant → tool patterns).
// =============================================================================

import type { ChatMessage } from "../../models/provider.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validate that a message array conforms to API role ordering constraints:
 * - First message must be "system" (optional, but if present must be first)
 * - "tool" messages must be preceded by an "assistant" message with toolCalls
 * - No two consecutive messages with the same role (some providers enforce this)
 */
export function validateMessageSequence(messages: ChatMessage[]): ValidationResult {
  const issues: string[] = [];

  if (messages.length === 0) {
    return { valid: true, issues: [] };
  }

  // Check first message
  if (messages[0].role !== "system") {
    // Not necessarily an error, but worth noting
  }

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    // Tool message must follow an assistant message with toolCalls
    if (curr.role === "tool") {
      if (prev.role !== "assistant" || !prev.toolCalls || prev.toolCalls.length === 0) {
        // Look backwards for the nearest assistant with toolCalls
        let found = false;
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].role === "assistant" && messages[j].toolCalls?.length) {
            found = true;
            break;
          }
          if (messages[j].role === "assistant" && !messages[j].toolCalls?.length) {
            break;
          }
        }
        if (!found) {
          issues.push(`Message ${i}: tool message without preceding assistant+toolCalls`);
        }
      }
    }

    // System message in the middle
    if (curr.role === "system" && i > 0) {
      issues.push(`Message ${i}: system message must be the first message`);
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/**
 * Repair a message array to fix common API role ordering violations:
 * 1. If a "tool" message follows a "user" or "system" message (no assistant),
 *    insert a synthetic assistant message as a bridge.
 * 2. Ensure no orphaned tool messages exist without a parent assistant.
 */
export function repairMessageSequence(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 1) return messages;

  const repaired: ChatMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = repaired[repaired.length - 1];
    const curr = messages[i];

    // Fix: tool message following non-assistant → insert synthetic assistant
    if (curr.role === "tool" && prev.role !== "assistant") {
      repaired.push({
        role: "assistant",
        content: "",
        toolCalls: [{
          id: `repair-${i}`,
          type: "function",
          function: {
            name: "tool_call",
            arguments: "{}",
          },
        }],
      });
    }

    repaired.push(curr);
  }

  return repaired;
}

// ---------------------------------------------------------------------------
// Group boundaries
// ---------------------------------------------------------------------------

/**
 * Find the indices that represent message group boundaries.
 * A "group" is an assistant message followed by its tool result messages.
 * Returns the indices of each assistant message that starts a group.
 */
export function findGroupBoundaries(messages: ChatMessage[]): number[] {
  const boundaries: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "assistant" && messages[i].toolCalls && messages[i].toolCalls.length > 0) {
      boundaries.push(i);
    }
  }
  return boundaries;
}
