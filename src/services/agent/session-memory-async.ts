// =============================================================================
// DeepAnalyze - Async Session Memory Extraction
// =============================================================================
// Triggers background memory extraction periodically without blocking the
// main agent loop. Inspired by Claude Code's SM-compact async extraction.
// =============================================================================

import type { AgentSettings } from "./types.js";
import { DEFAULT_AGENT_SETTINGS } from "./types.js";

/**
 * Async session memory extractor.
 * Triggers background extraction periodically without blocking the agent loop.
 *
 * Reference: Claude Code's SM-compact async extraction
 */
export class AsyncSessionMemoryExtractor {
  private extractPromise: Promise<void> | null = null;
  private lastExtractedTokens = 0;
  private settings: AgentSettings;

  constructor(settings?: Partial<AgentSettings>) {
    this.settings = { ...DEFAULT_AGENT_SETTINGS, ...settings };
  }

  /**
   * Try to trigger async extraction. Non-blocking.
   * Skips if already extracting or if token increment is insufficient.
   */
  tryExtract(
    currentTokens: number,
    extractFn: () => Promise<void>,
  ): void {
    // Already extracting → skip
    if (this.extractPromise) return;

    // Check token increment
    const increment = currentTokens - this.lastExtractedTokens;
    if (increment < this.settings.sessionMemoryUpdateInterval * 3) {
      return;
    }

    // Start background extraction
    this.extractPromise = extractFn()
      .then(() => {
        this.lastExtractedTokens = currentTokens;
      })
      .catch((err) => {
        console.warn("[AsyncSessionMemory] Background extraction failed:", err);
      })
      .finally(() => {
        this.extractPromise = null;
      });
  }

  /**
   * Wait for any in-progress extraction to complete.
   */
  async waitForExtraction(): Promise<void> {
    if (this.extractPromise) {
      await this.extractPromise;
    }
  }

  /**
   * Whether extraction is currently in progress.
   */
  get isExtracting(): boolean {
    return this.extractPromise !== null;
  }

  /**
   * Reset state (e.g., after compaction).
   */
  reset(): void {
    this.lastExtractedTokens = 0;
  }
}
