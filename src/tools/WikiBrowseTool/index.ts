// =============================================================================
// DeepAnalyze - Wiki Browse Tool
// Browse wiki pages and follow links between related documents.
// Provides page content viewing and link traversal capabilities.
// =============================================================================

import { getWikiPage, getWikiPagesByKb, getPageContent } from "../../store/wiki-pages.js";
import type { WikiPage } from "../../types/index.js";
import type { Linker, LinkedPageResult } from "../../wiki/linker.js";
import type { PageManager } from "../../wiki/page-manager.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface WikiBrowseInput {
  /** View a specific page by ID. */
  pageId?: string;
  /** List pages in a knowledge base. */
  kbId?: string;
  /** Filter listed pages by type. */
  pageType?: string;
  /** Follow links from a page. */
  followLinks?: boolean;
  /** Depth of link traversal (default 1, max 3). */
  depth?: number;
}

export interface PageView {
  id: string;
  title: string;
  pageType: string;
  content: string;
  tokenCount: number;
  outgoingLinks: Array<{ targetId: string; targetTitle: string; linkType: string }>;
  incomingLinks: Array<{ sourceId: string; sourceTitle: string; linkType: string }>;
}

export interface WikiBrowseOutput {
  /** The viewed page (when pageId is provided). */
  page?: PageView;
  /** Listed pages (when kbId is provided). */
  pages?: Array<{
    id: string;
    title: string;
    pageType: string;
    tokenCount: number;
  }>;
  /** Linked pages discovered through traversal. */
  linkedPages?: Array<{
    id: string;
    title: string;
    pageType: string;
    distance: number;
    linkType: string;
  }>;
}

// ---------------------------------------------------------------------------
// WikiBrowseTool
// ---------------------------------------------------------------------------

export class WikiBrowseTool {
  readonly name = "wiki_browse";
  readonly description =
    "Browse wiki pages by ID or list pages in a knowledge base. " +
    "Follow links between related documents to discover connected content. " +
    "Supports viewing page content and traversing the link graph.";

  private linker: Linker;
  private pageManager: PageManager;

  constructor(linker: Linker, pageManager: PageManager) {
    this.linker = linker;
    this.pageManager = pageManager;
  }

  /**
   * Execute the browse operation.
   */
  async execute(input: WikiBrowseInput): Promise<WikiBrowseOutput> {
    const output: WikiBrowseOutput = {};

    // View a specific page
    if (input.pageId) {
      const page = getWikiPage(input.pageId);
      if (!page) {
        throw new Error(`Wiki page not found: ${input.pageId}`);
      }

      let content: string;
      try {
        content = getPageContent(page.filePath);
      } catch {
        content = "";
      }

      // Get outgoing and incoming links
      const outgoing = this.linker.getOutgoingLinks(page.id);
      const incoming = this.linker.getIncomingLinks(page.id);

      const outgoingLinks = outgoing.map((l) => {
        const target = getWikiPage(l.targetPageId);
        return {
          targetId: l.targetPageId,
          targetTitle: target?.title ?? l.targetPageId,
          linkType: l.linkType,
        };
      });

      const incomingLinks = incoming.map((l) => {
        const source = getWikiPage(l.sourcePageId);
        return {
          sourceId: l.sourcePageId,
          sourceTitle: source?.title ?? l.sourcePageId,
          linkType: l.linkType,
        };
      });

      output.page = {
        id: page.id,
        title: page.title,
        pageType: page.pageType,
        content,
        tokenCount: page.tokenCount,
        outgoingLinks,
        incomingLinks,
      };
    }

    // List pages in a knowledge base
    if (input.kbId) {
      const pages = await this.pageManager.listPages(input.kbId, input.pageType);
      output.pages = pages.map((p) => ({
        id: p.id,
        title: p.title,
        pageType: p.pageType,
        tokenCount: p.tokenCount,
      }));
    }

    // Follow links from a page
    if (input.followLinks && input.pageId) {
      const depth = Math.min(input.depth ?? 1, 3);
      const linkedPages = this.linker.getLinkedPages(input.pageId, depth);

      output.linkedPages = linkedPages.map((lp) => ({
        id: lp.page.id,
        title: lp.page.title,
        pageType: lp.page.pageType,
        distance: lp.distance,
        linkType: lp.linkType,
      }));
    }

    return output;
  }
}
