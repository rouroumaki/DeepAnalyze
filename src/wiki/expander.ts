// =============================================================================
// DeepAnalyze - Wiki Expander
// Layer-by-layer expand tool for drilling down from abstract to full content.
// Supports expanding from Abstract → Structure → Raw (DoclingDocument JSON).
// Uses PG Repository layer for all database operations.
// =============================================================================

import { getRepos } from "../store/repos/index.js";
import type { WikiPage } from "../types/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
  level: "abstract" | "structure" | "fulltext" | "raw";
  /** The content at this level. */
  content: string;
  /** Title of the page. */
  title: string;
  /** Child pages at the next level of detail. */
  childPages?: ExpandResult[];
  /** Estimated token count. */
  tokenCount: number;
}

/** Result of expanding to the raw layer for a specific anchor. */
export interface RawExpandResult {
  /** The anchor ID. */
  anchorId: string;
  /** The document ID. */
  docId: string;
  /** The raw DoclingDocument JSON node at the anchor. */
  targetNode: unknown;
  /** Surrounding context nodes (siblings before and after). */
  context: { before: unknown[]; after: unknown[] };
  /** The full raw JSON (for deep inspection). */
  fullRaw: Record<string, unknown> | null;
  /** JSON Pointer path to the target node. */
  jsonPointer: string;
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
    const repos = await getRepos();
    const pgPage = await repos.wikiPage.getById(pageId);
    if (!pgPage) {
      throw new Error(`Wiki page not found: ${pageId}`);
    }

    const content = pgPage.content || "";
    const level = this.pageTypeToLevel(pgPage.page_type);

    // Get child pages at the next level of detail
    let childPages: ExpandResult[] | undefined;

    if (pgPage.doc_id && level !== "raw") {
      const childLevel = this.nextLevel(level);
      if (childLevel) {
        const childPageType = this.levelToPageType(childLevel);
        if (childPageType) {
          const childPage = await repos.wikiPage.getByDocAndType(pgPage.doc_id, childPageType);
          if (childPage) {
            const childContent = childPage.content || "";
            childPages = [
              {
                pageId: childPage.id,
                docId: childPage.doc_id,
                level: childLevel,
                content: childContent,
                title: childPage.title,
                tokenCount: childPage.token_count,
              },
            ];
          }
        }
      }
    }

    return {
      pageId: pgPage.id,
      docId: pgPage.doc_id,
      level,
      content,
      title: pgPage.title,
      childPages,
      tokenCount: pgPage.token_count,
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
    const repos = await getRepos();
    const targetPageType = this.levelToPageType(targetLevel);
    if (!targetPageType) {
      throw new Error(`Invalid target level: ${targetLevel}`);
    }

    const page = await repos.wikiPage.getByDocAndType(docId, targetPageType);
    if (!page) {
      throw new Error(
        `No page found for document ${docId} at level ${targetLevel}`,
      );
    }

    const content = page.content || "";

    // Build the tree of child pages at more detailed levels
    let childPages: ExpandResult[] | undefined;
    const childLevel = this.nextLevel(targetLevel);
    if (childLevel) {
      const childPageType = this.levelToPageType(childLevel);
      if (childPageType && page.doc_id) {
        const childPage = await repos.wikiPage.getByDocAndType(page.doc_id, childPageType);
        if (childPage) {
          const childContent = childPage.content || "";
          childPages = [
            {
              pageId: childPage.id,
              docId: childPage.doc_id,
              level: childLevel,
              content: childContent,
              title: childPage.title,
              tokenCount: childPage.token_count,
            },
          ];
        }
      }
    }

    return {
      pageId: page.id,
      docId: page.doc_id,
      level: targetLevel,
      content,
      title: page.title,
      childPages,
      tokenCount: page.token_count,
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
    const repos = await getRepos();
    const pgPage = await repos.wikiPage.getById(pageId);
    if (!pgPage) {
      throw new Error(`Wiki page not found: ${pageId}`);
    }

    const content = pgPage.content || "";
    const level = this.pageTypeToLevel(pgPage.page_type);

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
      pageId: pgPage.id,
      docId: pgPage.doc_id,
      level,
      content: sectionContent,
      title: `${pgPage.title} - ${lines[sectionStart].replace(/^#+\s*/, "")}`,
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
    const repos = await getRepos();
    const levels: Array<"L0" | "L1" | "L2"> = ["L0", "L1", "L2"];
    let totalTokens = 0;
    let bestResult: ExpandResult | null = null;

    for (const level of levels) {
      const pageType = this.levelToPageType(level);
      if (!pageType) continue;

      const page = await repos.wikiPage.getByDocAndType(docId, pageType);
      if (!page) continue;

      const tokens = page.token_count;

      // Check if adding this level would exceed the budget
      if (totalTokens + tokens > tokenBudget) {
        // Budget is exhausted. If we have no result yet, include this
        // level anyway (better to return something than nothing).
        if (!bestResult) {
          const content = page.content || "";
          bestResult = {
            pageId: page.id,
            docId: page.doc_id,
            level,
            content,
            title: page.title,
            tokenCount: tokens,
          };
        }
        break;
      }

      const content = page.content || "";
      bestResult = {
        pageId: page.id,
        docId: page.doc_id,
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
  // Raw layer access (anchor-based)
  // -----------------------------------------------------------------------

  /**
   * Expand to the Raw layer for a specific anchor element.
   *
   * Flow:
   *  1. Look up anchor by ID from AnchorRepo (PG)
   *  2. Read the raw DoclingDocument JSON from disk
   *  3. Use JSON Pointer to locate the target element
   *  4. Return the element with surrounding context
   */
  async expandToRaw(anchorId: string): Promise<RawExpandResult> {
    // Look up anchor via PG Repository
    const anchor = await this.getAnchorById(anchorId);
    if (!anchor) {
      throw new Error(`Anchor not found: ${anchorId}`);
    }

    const docId = anchor.doc_id;
    const jsonPointer = anchor.raw_json_path ?? `#/body/children/0`;

    // Load the raw DoclingDocument JSON
    const raw = this.loadRawJson(docId);
    if (!raw) {
      throw new Error(`Raw JSON not found for document ${docId}`);
    }

    // Resolve the JSON Pointer to get the target node
    const targetNode = this.resolveJsonPointer(raw, jsonPointer);
    if (targetNode === undefined) {
      throw new Error(`JSON Pointer ${jsonPointer} not found in raw JSON`);
    }

    // Get context (surrounding siblings)
    const children = (raw as Record<string, unknown>).body
      ? ((raw as Record<string, unknown>).body as Record<string, unknown>).children as unknown[]
      : [];
    const targetIndex = this.extractIndexFromPointer(jsonPointer);
    const contextBefore = children.slice(Math.max(0, targetIndex - 2), targetIndex);
    const contextAfter = children.slice(targetIndex + 1, targetIndex + 3);

    return {
      anchorId,
      docId,
      targetNode,
      context: { before: contextBefore, after: contextAfter },
      fullRaw: raw,
      jsonPointer,
    };
  }

  /**
   * Resolve a JSON Pointer (e.g., "#/body/children/3") to a value in a JSON object.
   */
  resolveJsonPointer(obj: Record<string, unknown>, pointer: string): unknown {
    // Strip leading "#/" or "/"
    let path = pointer;
    if (path.startsWith("#/")) {
      path = path.slice(2);
    } else if (path.startsWith("/")) {
      path = path.slice(1);
    }

    if (!path) return obj;

    const tokens = path.split("/");
    let current: unknown = obj;

    for (const token of tokens) {
      if (current === null || current === undefined) return undefined;

      if (Array.isArray(current)) {
        const index = parseInt(token, 10);
        if (isNaN(index)) return undefined;
        current = current[index];
      } else if (typeof current === "object") {
        current = (current as Record<string, unknown>)[token];
      } else {
        return undefined;
      }
    }

    return current;
  }

  // -----------------------------------------------------------------------
  // Private helpers (Raw layer)
  // -----------------------------------------------------------------------

  /**
   * Get an anchor by ID via PG Repository.
   */
  private async getAnchorById(
    anchorId: string,
  ): Promise<{ doc_id: string; raw_json_path?: string } | null> {
    try {
      const repos = await getRepos();
      const anchor = await repos.anchor.getById(anchorId);
      return anchor ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Load the raw DoclingDocument JSON from disk.
   */
  private loadRawJson(docId: string): Record<string, unknown> | null {
    // Try to find the wiki directory
    const wikiDir = join(this.dataDir, "wiki");

    try {
      // Try direct path construction: find the KB directory
      const kbDirs = readdirSync(wikiDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const kbDir of kbDirs) {
        const rawPath = join(wikiDir, kbDir, "documents", docId, "raw", "docling.json");
        try {
          const content = readFileSync(rawPath, "utf-8");
          return JSON.parse(content);
        } catch {
          continue;
        }
      }
    } catch {
      // Wiki directory not found
    }

    return null;
  }

  /**
   * Extract the array index from a JSON Pointer like "#/body/children/3".
   */
  private extractIndexFromPointer(pointer: string): number {
    const parts = pointer.split("/");
    const lastPart = parts[parts.length - 1];
    const index = parseInt(lastPart, 10);
    return isNaN(index) ? 0 : index;
  }

  // -----------------------------------------------------------------------
  // Private helpers (level mapping)
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
