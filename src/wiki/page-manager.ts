// =============================================================================
// DeepAnalyze - Page Manager
// High-level wiki page management that coordinates DB records and filesystem.
// =============================================================================

import {
  createWikiPage,
  getWikiPage,
  getWikiPagesByKb,
  getPageContent,
  updateWikiPage as updateWikiPageInStore,
} from "../store/wiki-pages.js";
import type { WikiPage } from "../types/index.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export class PageManager {
  private readonly wikiDir: string;

  constructor(dataDir: string) {
    this.wikiDir = join(dataDir, "wiki");
  }

  /**
   * Expose the base wiki directory for use by the compiler.
   */
  getWikiDir(): string {
    return this.wikiDir;
  }

  /**
   * Initialize the wiki directory structure for a knowledge base.
   * Creates all required subdirectories and seed files.
   */
  async initKb(kbId: string): Promise<void> {
    const kbDir = join(this.wikiDir, kbId);

    // Create directory structure
    const dirs = [
      join(kbDir, "documents"),
      join(kbDir, "entities"),
      join(kbDir, "concepts"),
      join(kbDir, "reports"),
    ];

    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }

    // Create index.md if it doesn't exist
    const indexPath = join(kbDir, "index.md");
    if (!existsSync(indexPath)) {
      writeFileSync(
        indexPath,
        `# Knowledge Base: ${kbId}\n\nThis is the wiki index for knowledge base **${kbId}**.\n`,
        "utf-8",
      );
    }

    // Create log.md if it doesn't exist
    const logPath = join(kbDir, "log.md");
    if (!existsSync(logPath)) {
      writeFileSync(
        logPath,
        `# Compilation Log: ${kbId}\n\nCompilation events are recorded here.\n`,
        "utf-8",
      );
    }
  }

  /**
   * Read the content of a wiki page from the filesystem.
   */
  async getPageContent(pageId: string): Promise<string> {
    const page = getWikiPage(pageId);
    if (!page) {
      throw new Error(`Wiki page not found: ${pageId}`);
    }
    return getPageContent(page.filePath);
  }

  /**
   * Update the content of a wiki page on both filesystem and DB.
   */
  async updatePage(pageId: string, content: string): Promise<void> {
    updateWikiPageInStore(pageId, content);
  }

  /**
   * List all pages for a knowledge base, optionally filtered by page type.
   */
  async listPages(kbId: string, pageType?: string): Promise<WikiPage[]> {
    return getWikiPagesByKb(kbId, pageType);
  }
}
