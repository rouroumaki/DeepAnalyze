// =============================================================================
// DeepAnalyze - Tool Setup
// =============================================================================
// Creates a fully configured ToolRegistry with all custom DeepAnalyze tools
// (kb_search, wiki_browse, expand, report_generate, timeline_build, graph_build)
// registered and wired to their backends.
// =============================================================================

import { ToolRegistry } from "./tool-registry.js";
import { Retriever } from "../../wiki/retriever.js";
import { Linker } from "../../wiki/linker.js";
import { Expander } from "../../wiki/expander.js";
import type { EmbeddingManager } from "../../models/embedding.js";
import type { Indexer } from "../../wiki/indexer.js";
import type { ModelRouter } from "../../models/router.js";
import {
  getWikiPage,
  getWikiPagesByKb,
  getPageContent,
} from "../../store/wiki-pages.js";
import { createReportTool } from "../../tools/ReportTool/index.js";
import { createTimelineTool } from "../../tools/TimelineTool/index.js";
import { createGraphTool } from "../../tools/GraphTool/index.js";

// ---------------------------------------------------------------------------
// Dependencies for tool registration
// ---------------------------------------------------------------------------

/** All external dependencies needed to set up the tool registry. */
export interface ToolSetupDeps {
  retriever: Retriever;
  linker: Linker;
  expander: Expander;
  embeddingManager: EmbeddingManager;
  indexer: Indexer;
  modelRouter: ModelRouter;
  /** Root data directory for wiki content files. */
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

/**
 * Create a ToolRegistry with all DeepAnalyze tools registered and wired to
 * their real backend implementations.
 *
 * The returned registry includes:
 * - think (built-in, always present)
 * - finish (built-in, always present)
 * - kb_search (Retriever-backed semantic + BM25 + link search)
 * - wiki_browse (page listing, content reading, link traversal)
 * - expand (layer-by-layer content expansion L0 -> L1 -> L2)
 * - report_generate (structured analysis report generation)
 * - timeline_build (chronological event extraction from wiki pages)
 * - graph_build (entity relationship graph from wiki pages and links)
 */
export function createConfiguredToolRegistry(deps: ToolSetupDeps): ToolRegistry {
  const registry = new ToolRegistry();

  // -----------------------------------------------------------------------
  // kb_search tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "kb_search",
    description:
      "Search the knowledge base using semantic and keyword matching. " +
      "Returns ranked results with snippets. Combines vector similarity, " +
      "BM25 full-text search, and link traversal for comprehensive results.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query text",
        },
        kbIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Knowledge base IDs to search within. Omit to search all KBs.",
        },
        topK: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
        linkedFrom: {
          type: "string",
          description:
            "Page ID to start link traversal from (adds linked results).",
        },
        pageTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter results to specific page types (abstract, overview, fulltext, entity, concept, report).",
        },
        minScore: {
          type: "number",
          description: "Minimum relevance score threshold (0-1 scale).",
        },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>) {
      const query = input.query as string;
      const kbIds = (input.kbIds as string[]) || [];

      if (kbIds.length === 0) {
        // When no KB IDs are specified, search across all knowledge bases.
        // Retrieve all KB IDs from the database.
        const { DB } = await import("../../store/database.js");
        const db = DB.getInstance().raw;
        const rows = db
          .prepare("SELECT id FROM knowledge_bases")
          .all() as Array<{ id: string }>;
        const allKbIds = rows.map((r) => r.id);

        if (allKbIds.length === 0) {
          return {
            results: [],
            total: 0,
            message: "No knowledge bases found.",
          };
        }

        return deps.retriever.search(query, {
          kbIds: allKbIds,
          topK: (input.topK as number) || 10,
          linkedFrom: input.linkedFrom as string | undefined,
          pageTypes: input.pageTypes as string[] | undefined,
          minScore: input.minScore as number | undefined,
        });
      }

      return deps.retriever.search(query, {
        kbIds,
        topK: (input.topK as number) || 10,
        linkedFrom: input.linkedFrom as string | undefined,
        pageTypes: input.pageTypes as string[] | undefined,
        minScore: input.minScore as number | undefined,
      });
    },
  });

  // -----------------------------------------------------------------------
  // wiki_browse tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "wiki_browse",
    description:
      "Browse wiki pages and follow links between related documents. " +
      "Can view a specific page by ID, list pages in a knowledge base, " +
      "or explore linked pages through link traversal.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "Specific page ID to view. Returns page content and metadata.",
        },
        kbId: {
          type: "string",
          description:
            "Knowledge base ID. Returns a list of all pages in the KB.",
        },
        followLinks: {
          type: "boolean",
          description:
            "When viewing a page, also include outgoing and incoming links (default: false).",
        },
        depth: {
          type: "number",
          description:
            "Link traversal depth when followLinks is true (max 3, default: 1).",
        },
        pageType: {
          type: "string",
          description:
            "Filter pages by type when listing KB pages (abstract, overview, fulltext, entity, concept, report).",
        },
      },
    },
    async execute(input: Record<string, unknown>) {
      // Mode 1: View a specific page by ID
      if (input.pageId) {
        const pageId = input.pageId as string;
        const page = getWikiPage(pageId);

        if (!page) {
          return { error: `Page not found: ${pageId}` };
        }

        let content: string;
        try {
          content = getPageContent(page.filePath);
        } catch {
          content = "[Content could not be read]";
        }

        const result: Record<string, unknown> = {
          id: page.id,
          kbId: page.kbId,
          docId: page.docId,
          pageType: page.pageType,
          title: page.title,
          tokenCount: page.tokenCount,
          content,
        };

        // Optionally include link information
        if (input.followLinks) {
          const depth = Math.min((input.depth as number) || 1, 3);

          const outgoingLinks = deps.linker.getOutgoingLinks(pageId);
          const incomingLinks = deps.linker.getIncomingLinks(pageId);

          const linkedPages = deps.linker.getLinkedPages(pageId, depth);

          result.outgoingLinks = outgoingLinks.map((link) => ({
            targetPageId: link.targetPageId,
            linkType: link.linkType,
            entityName: link.entityName,
          }));

          result.incomingLinks = incomingLinks.map((link) => ({
            sourcePageId: link.sourcePageId,
            linkType: link.linkType,
            entityName: link.entityName,
          }));

          result.linkedPages = linkedPages.map((lp) => ({
            pageId: lp.page.id,
            title: lp.page.title,
            pageType: lp.page.pageType,
            distance: lp.distance,
            linkType: lp.linkType,
          }));
        }

        return result;
      }

      // Mode 2: List pages in a knowledge base
      if (input.kbId) {
        const kbId = input.kbId as string;
        const pageType = input.pageType as string | undefined;
        const pages = getWikiPagesByKb(kbId, pageType);

        return {
          kbId,
          total: pages.length,
          pages: pages.map((p) => ({
            id: p.id,
            docId: p.docId,
            pageType: p.pageType,
            title: p.title,
            tokenCount: p.tokenCount,
          })),
        };
      }

      return {
        error:
          'Provide either "pageId" to view a specific page, or "kbId" to list pages in a knowledge base.',
      };
    },
  });

  // -----------------------------------------------------------------------
  // expand tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "expand",
    description:
      "Expand from summary to detailed content. Drills down through " +
      "L0 (abstract) -> L1 (overview) -> L2 (fulltext) layers. " +
      "Use this to get more detail on a document or page.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "Page ID to expand. Returns content at its current level.",
        },
        docId: {
          type: "string",
          description: "Document ID to expand to a specific level.",
        },
        targetLevel: {
          type: "string",
          enum: ["L0", "L1", "L2"],
          description:
            "Target expansion level when expanding by docId. L0=abstract, L1=overview, L2=fulltext.",
        },
        heading: {
          type: "string",
          description:
            "Specific section heading to extract within a page.",
        },
        tokenBudget: {
          type: "number",
          description:
            "Maximum tokens to return when expanding by docId. Automatically picks the best level.",
        },
      },
    },
    async execute(input: Record<string, unknown>) {
      try {
        // Mode 1: Expand a specific section by heading
        if (input.heading && input.pageId) {
          const result = await deps.expander.expandSection(
            input.pageId as string,
            input.heading as string,
          );

          if (!result) {
            return {
              error: `Section "${input.heading}" not found in page ${input.pageId}`,
            };
          }

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
          };
        }

        // Mode 2: Expand with token budget (automatically picks level)
        if (input.docId && input.tokenBudget) {
          const result = await deps.expander.expandWithBudget(
            input.docId as string,
            input.tokenBudget as number,
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        // Mode 3: Expand to a specific target level by docId
        if (input.docId && input.targetLevel) {
          const result = await deps.expander.expandToLevel(
            input.docId as string,
            input.targetLevel as "L0" | "L1" | "L2",
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        // Mode 4: Expand a page by pageId (returns current level + child pages)
        if (input.pageId) {
          const result = await deps.expander.expand(
            input.pageId as string,
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        return {
          error:
            'Provide at least "pageId" or "docId". Use "targetLevel" or "tokenBudget" with docId, or "heading" with pageId.',
        };
      } catch (err) {
        return {
          error: `Expand failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });

  // -----------------------------------------------------------------------
  // report_generate tool
  // -----------------------------------------------------------------------

  registry.register(createReportTool({ retriever: deps.retriever, dataDir: deps.dataDir }));

  // -----------------------------------------------------------------------
  // timeline_build tool
  // -----------------------------------------------------------------------

  registry.register(createTimelineTool({ retriever: deps.retriever, dataDir: deps.dataDir }));

  // -----------------------------------------------------------------------
  // graph_build tool
  // -----------------------------------------------------------------------

  registry.register(createGraphTool({ linker: deps.linker, retriever: deps.retriever, dataDir: deps.dataDir }));

  return registry;
}
