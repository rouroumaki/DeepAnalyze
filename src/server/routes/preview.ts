// =============================================================================
// DeepAnalyze - Preview & Anchor API Routes
// Layer preview (raw/structure/abstract), anchor details, and structure map.
// =============================================================================

import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRepos } from "../../store/repos/index.js";
import { DisplayResolver } from "../../services/display-resolver.js";
import { DEEPANALYZE_CONFIG } from "../../core/config.js";

export function createPreviewRoutes(): Hono {
  const app = new Hono();

  // =====================================================================
  // GET /kbs/:kbId/documents/:docId/preview/:layer
  // Layer preview: raw / structure / abstract
  // =====================================================================

  app.get("/kbs/:kbId/documents/:docId/preview/:layer", async (c) => {
    const { kbId, docId, layer } = c.req.param();
    const repos = await getRepos();

    switch (layer) {
      case "raw": {
        try {
          const rawPath = join(DEEPANALYZE_CONFIG.dataDir, kbId, "documents", docId, "raw", "docling.json");
          const rawJson = await readFile(rawPath, "utf-8");
          const parsed = JSON.parse(rawJson);
          const elementCount = countElements(parsed);
          return c.json({ content: parsed, summary: { elementCount } });
        } catch {
          return c.json({ error: "Raw data not found" }, 404);
        }
      }

      case "structure": {
        const chunkId = c.req.query("chunkId");
        if (chunkId) {
          const page = await repos.wikiPage.getById(chunkId);
          if (!page) return c.json({ error: "Chunk not found" }, 404);
          const anchors = await repos.anchor.getByStructurePageId(chunkId);
          return c.json({ chunk: page, anchors });
        }

        // List all structure pages for this document
        const pages = await repos.wikiPage.getManyByDocAndType(docId, "structure");
        const summaries = pages.map((p) => ({
          id: p.id,
          title: p.title,
          sectionPath: p.metadata?.sectionPath,
          anchorIds: p.metadata?.anchorIds,
          pageRange: p.metadata?.pageRange ?? p.metadata?.timeRange,
          hasTable: Array.isArray(p.metadata?.elementTypes) && (p.metadata?.elementTypes as string[]).includes("table"),
          hasImage: Array.isArray(p.metadata?.elementTypes) && (p.metadata?.elementTypes as string[]).includes("image"),
          modality: p.metadata?.modality,
        }));
        return c.json({ chunks: summaries });
      }

      case "abstract": {
        const page = await repos.wikiPage.getByDocAndType(docId, "abstract");
        if (!page) return c.json({ error: "Abstract not found" }, 404);
        return c.json({
          content: page.content,
          metadata: {
            documentType: page.metadata?.documentType,
            tags: page.metadata?.tags,
            keyDates: page.metadata?.keyDates,
            toc: page.metadata?.toc,
          },
        });
      }

      default:
        return c.json({ error: `Invalid layer: ${layer}` }, 400);
    }
  });

  // =====================================================================
  // GET /anchors/:anchorId
  // Anchor detail: definition + structure snippet + raw context
  // =====================================================================

  app.get("/anchors/:anchorId", async (c) => {
    const { anchorId } = c.req.param();
    const repos = await getRepos();

    const anchor = await repos.anchor.getById(anchorId);
    if (!anchor) return c.json({ error: "Anchor not found" }, 404);

    // Structure layer snippet
    let structureSnippet: string | null = null;
    if (anchor.structure_page_id) {
      const page = await repos.wikiPage.getById(anchor.structure_page_id);
      if (page) {
        structureSnippet = extractSnippet(page.content, anchor.content_preview ?? "");
      }
    }

    // Raw layer context
    let rawContext: unknown = null;
    if (anchor.raw_json_path) {
      try {
        const rawPath = join(DEEPANALYZE_CONFIG.dataDir, anchor.kb_id, "documents", anchor.doc_id, "raw", "docling.json");
        const rawJson = JSON.parse(await readFile(rawPath, "utf-8"));
        rawContext = resolveJsonPointer(rawJson, anchor.raw_json_path);
      } catch {
        // Raw file not found or path invalid
      }
    }

    // Display names
    const displayResolver = new DisplayResolver();
    const displayInfo = await displayResolver.resolve(anchor.doc_id);

    return c.json({
      anchor,
      structureSnippet,
      rawContext,
      display: displayInfo,
    });
  });

  // =====================================================================
  // GET /kbs/:kbId/documents/:docId/structure-map
  // Flat list of all structure chunks with anchors (for navigation sidebar)
  // =====================================================================

  app.get("/kbs/:kbId/documents/:docId/structure-map", async (c) => {
    const { docId } = c.req.param();
    const repos = await getRepos();

    const pages = await repos.wikiPage.getManyByDocAndType(docId, "structure");
    const anchors = await repos.anchor.getByDocId(docId);

    const map = pages.map((page) => ({
      id: page.id,
      title: page.title,
      sectionPath: page.metadata?.sectionPath,
      pageRange: page.metadata?.pageRange ?? page.metadata?.timeRange,
      modality: page.metadata?.modality,
      anchors: anchors
        .filter((a) => a.structure_page_id === page.id)
        .map((a) => ({
          id: a.id,
          type: a.element_type,
          preview: a.content_preview,
        })),
    }));

    return c.json({ structureMap: map });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countElements(obj: unknown): number {
  if (!obj || typeof obj !== "object") return 0;
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o["main-text"])) return (o["main-text"] as unknown[]).length;
  if (Array.isArray(o["body"])) return (o["body"] as unknown[]).length;
  return Object.keys(o).length;
}

function extractSnippet(content: string, preview: string): string {
  if (!preview) return content.slice(0, 200);
  const idx = content.indexOf(preview);
  if (idx === -1) return content.slice(0, 200);
  const start = Math.max(0, idx - 50);
  const end = Math.min(content.length, idx + preview.length + 50);
  return content.slice(start, end);
}

function resolveJsonPointer(obj: unknown, pointer: string): unknown {
  if (!pointer || pointer === "#") return obj;
  const path = pointer.startsWith("#/") ? pointer.slice(2).split("/") : pointer.split("/");
  let current: unknown = obj;
  for (const key of path) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }
  return current;
}
