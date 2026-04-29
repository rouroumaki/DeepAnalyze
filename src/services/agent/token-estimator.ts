// =============================================================================
// DeepAnalyze - Token Estimator
// =============================================================================
// Dual-layer token estimator.
// Uses API-reported usage when available (accurate), falls back to
// conservative 4/3 character-based estimation.
//
// Reference: refcode/claude-code/src/utils/tokenEstimation.ts
// =============================================================================

export class TokenEstimator {
  /** API-reported token counts keyed by message hash */
  private reportedTokens = new Map<string, number>();

  /**
   * Record API-reported token usage for a message.
   */
  reportUsage(messageHash: string, tokenCount: number): void {
    this.reportedTokens.set(messageHash, tokenCount);
  }

  /**
   * Estimate tokens for a single message.
   * Uses API-reported value if available, otherwise conservative estimation.
   */
  estimateMessage(msg: {
    content?: string;
    toolCalls?: Array<{ function: { arguments: string } }>;
    role: string;
  }): number {
    const hash = this.hashMessage(msg);
    const reported = this.reportedTokens.get(hash);
    if (reported !== undefined) return reported;

    let tokens = 0;
    if (msg.content) {
      // Conservative: chars/3 * 4/3 safety factor
      tokens += Math.ceil((msg.content.length / 3) * (4 / 3));
    }
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        tokens += Math.ceil((tc.function.arguments.length / 3) * (4 / 3));
        tokens += 20; // overhead per tool call
      }
    }
    tokens += 10; // per-message overhead
    return tokens;
  }

  /**
   * Estimate total tokens for a message array.
   */
  estimateMessages(messages: Array<{
    content?: string;
    toolCalls?: Array<{ function: { arguments: string } }>;
    role: string;
  }>): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessage(msg), 0);
  }

  /**
   * Simple hash for matching messages to API-reported values.
   */
  private hashMessage(msg: {
    content?: string;
    toolCalls?: Array<{ function: { arguments: string } }>;
    role: string;
  }): string {
    const parts = [msg.role];
    if (msg.content) parts.push(msg.content.slice(0, 100));
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        parts.push(tc.function.arguments.slice(0, 50));
      }
    }
    return parts.join("|");
  }

  /**
   * Clear all cached values.
   */
  clear(): void {
    this.reportedTokens.clear();
  }
}
