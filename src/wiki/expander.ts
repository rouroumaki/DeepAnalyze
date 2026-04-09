// =============================================================================
// DeepAnalyze - Wiki Expander
// Layer-by-layer expand tool for drilling down from abstract to full content.
// Supports expanding from L0 (abstract) -> L1 (overview) -> L2 (fulltext) -> raw.
// =============================================================================

import { DB } from "../store/database.js";
import {
  getWikiPage,
  getWikiPageByDoc,
  getPageContent,
} from "../store/wiki-pages.js";
import type { WikiPage } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of expanding a page to a specific level. */
export interface ExpandResult {
  /** The page ID. */
  pageId: string;
  /** The document ID this page belongs to. */
  docId: string | null;
  /** The current expansion level. */
  level: "L0" | "L1" | "L2" | "raw";
  /** The content at this level. */
  content: string;
  /** Title of the page. */
  title: string;
  /** Child pages at the next level of detail. */
  childPages?: ExpandResult[];
  /** Estimated token count. */
  tokenCount: number;
}

// ---------------------------------------------------------------------------
// Expander
// ---------------------------------------------------------------------------

export class Expander {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Expand from a page ID to get its content at the current level.
   * Also returns child pages that can be expanded further.
   */
  async expand(pageId: string): Promise<ExpandResult> {
    const page = getWikiPage(pageId);
    if (!page) {
      throw new Error(`Wiki page not found: ${pageId}`);
    }

    const content = getPageContent(page.filePath);
    const level = this.pageTypeToLevel(page.pageType);

    // Get child pages at the next level of detail
    let childPages: ExpandResult[] | undefined;

    if (page.docId && level !== "raw") {
      const childLevel = this.nextLevel(level);
      if (childLevel) {
        const childPageType = this.levelToPageType(childLevel);
        if (childPageType) {
          const childPage = getWikiPageByDoc(page.docId, childPageType);
          if (childPage) {
            const childContent = getPageContent(childPage.filePath);
            childPages = [
              {
                pageId: childPage.id,
                docId: childPage.docId,
                level: childLevel,
                content: childContent,
                title: childPage.title,
                tokenCount: childPage.tokenCount,
              },
            ];
          }
        }
      }
    }

    return {
      pageId: page.id,
      docId: page.docId,
      level,
      content,
      title: page.title,
      childPages,
      tokenCount: page.tokenCount,
    };
  }

  /**
   * Expand to a specific level starting from a document.
   * Returns the content at the target level, with all intermediate levels
   * accessible as child pages.
   */
  async expandToLevel(
    docId: string,
    targetLevel: "L0" | "L1" | "L2",
  ): Promise<ExpandResult> {
    const targetPageType = this.levelToPageType(targetLevel);
    if (!targetPageType) {
      throw new Error(`Invalid target level: ${targetLevel}`);
    }

    const page = getWikiPageByDoc(docId, targetPageType);
    if (!page) {
      throw new Error(
        `No page found for document ${docId} at level ${targetLevel}`,
      );
    }

    const content = getPageContent(page.filePath);

    // Build the tree of child pages at more detailed levels
    let childPages: ExpandResult[] | undefined;
    const childLevel = this.nextLevel(targetLevel);
    if (childLevel) {
      const childPageType = this.levelToPageType(childLevel);
      if (childPageType && page.docId) {
        const childPage = getWikiPageByDoc(page.docId, childPageType);
        if (childPage) {
          const childContent = getPageContent(childPage.filePath);
          childPages = [
            {
              pageId: childPage.id,
              docId: childPage.docId,
              level: childLevel,
              content: childContent,
              title: childPage.title,
              tokenCount: childPage.tokenCount,
            },
          ];
        }
      }
    }

    return {
      pageId: page.id,
      docId: page.docId,
      level: targetLevel,
      content,
      title: page.title,
      childPages,
      tokenCount: page.tokenCount,
    };
  }

  /**
   * Expand a specific section within a page, identified by a heading.
   * Returns the content of the section (text between the heading and the
   * next heading of the same or higher level).
   */
  async expandSection(
    pageId: string,
    heading: string,
  ): Promise<ExpandResult | null> {
    const page = getWikiPage(pageId);
    if (!page) {
      throw new Error(`Wiki page not found: ${pageId}`);
    }

    const content = getPageContent(page.filePath);
    const level = this.pageTypeToLevel(page.pageType);

    // Find the section by heading (case-insensitive match)
    const lines = content.split("\n");
    const normalizedHeading = heading.toLowerCase().trim();

    let sectionStart = -1;
    let headingLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (match) {
        const hLevel = match[1].length;
        const hText = match[2].toLowerCase().trim();

        if (hText.includes(normalizedHeading) || normalizedHeading.includes(hText)) {
          sectionStart = i;
          headingLevel = hLevel;
          break;
        }
      }
    }

    if (sectionStart === -1) {
      return null;
    }

    // Find the end of the section (next heading of same or higher level)
    let sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+/);
      if (match && match[1].length <= headingLevel) {
        sectionEnd = i;
        break;
      }
    }

    const sectionContent = lines.slice(sectionStart, sectionEnd).join("\n");
    const tokenCount = Math.ceil(sectionContent.length / 4);

    return {
      pageId: page.id,
      docId: page.docId,
      level,
      content: sectionContent,
      title: `${page.title} - ${lines[sectionStart].replace(/^#+\s*/, "")}`,
      tokenCount,
    };
  }

  /**
   * Expand with a token budget. Starts from the most compressed level (L0)
   * and progressively adds more detail until the budget is exhausted.
   * Returns the accumulated content across levels.
   */
  async expandWithBudget(
    docId: string,
    tokenBudget: number,
  ): Promise<ExpandResult> {
    const levels: Array<"L0" | "L1" | "L2"> = ["L0", "L1", "L2"];
    let totalTokens = 0;
    let bestResult: ExpandResult | null = null;

    for (const level of levels) {
      const pageType = this.levelToPageType(level);
      if (!pageType) continue;

      const page = getWikiPageByDoc(docId, pageType);
      if (!page) continue;

      const tokens = page.tokenCount;

      // Check if adding this level would exceed the budget
      if (totalTokens + tokens > tokenBudget) {
        // Budget is exhausted. If we have no result yet, include this
        // level anyway (better to return something than nothing).
        if (!bestResult) {
          const content = getPageContent(page.filePath);
          bestResult = {
            pageId: page.id,
            docId: page.docId,
            level,
            content,
            title: page.title,
            tokenCount: tokens,
          };
        }
        break;
      }

      const content = getPageContent(page.filePath);
      bestResult = {
        pageId: page.id,
        docId: page.docId,
        level,
        content,
        title: page.title,
        tokenCount: tokens,
      };
      totalTokens += tokens;
    }

    if (!bestResult) {
      throw new Error(
        `No wiki pages found for document ${docId}`,
      );
    }

    return bestResult;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Map a page type to its expansion level.
   */
  private pageTypeToLevel(pageType: string): "L0" | "L1" | "L2" | "raw" {
    switch (pageType) {
      case "abstract":
        return "L0";
      case "overview":
        return "L1";
      case "fulltext":
        return "L2";
      case "entity":
      case "concept":
      case "report":
        return "raw";
      default:
        return "raw";
    }
  }

  /**
   * Map an expansion level back to a page type.
   */
  private levelToPageType(
    level: "L0" | "L1" | "L2" | "raw",
  ): string | null {
    switch (level) {
      case "L0":
        return "abstract";
      case "L1":
        return "overview";
      case "L2":
        return "fulltext";
      case "raw":
        return null;
      default:
        return null;
    }
  }

  /**
   * Get the next more detailed level after the given level.
   */
  private nextLevel(
    level: "L0" | "L1" | "L2" | "raw",
  ): "L0" | "L1" | "L2" | "raw" | null {
    switch (level) {
      case "L0":
        return "L1";
      case "L1":
        return "L2";
      case "L2":
        return "raw";
      case "raw":
        return null;
      default:
        return null;
    }
  }
}
