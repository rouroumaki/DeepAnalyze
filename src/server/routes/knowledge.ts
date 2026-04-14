// =============================================================================
// DeepAnalyze - Knowledge Base API Routes
// Hono routes for knowledge base management, document upload, and processing.
// =============================================================================

import { Hono } from "hono";
import {
  createKnowledgeBase,
  getKnowledgeBase,
  listKnowledgeBases,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from "../../store/knowledge-bases.js";
import {
  createDocument,
  listDocuments,
  getDocument,
  updateDocumentStatus,
} from "../../store/documents.js";
import { createWikiPage, getWikiPage, getWikiPageByDoc, getWikiPagesByKb, getPageContent } from "../../store/wiki-pages.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DEEPANALYZE_CONFIG } from "../../core/config.js";
import { getProcessingQueue } from "../../services/processing-queue.js";

// ---------------------------------------------------------------------------
// Background helpers for post-processing
// ---------------------------------------------------------------------------

/**
 * Generate vector embeddings and FTS index for wiki pages of a document.
 * Embeds L0 (abstract) and L1 (overview) pages for semantic search.
 */
async function generateEmbeddingsAndIndex(kbId: string, docId: string): Promise<void> {
  try {
    const { ModelRouter } = await import("../../models/router.js");
    const { EmbeddingManager } = await import("../../models/embedding.js");
    const { Indexer } = await import("../../wiki/indexer.js");

    const modelRouter = new ModelRouter();
    await modelRouter.initialize();
    const embeddingManager = new EmbeddingManager(modelRouter);
    const indexer = new Indexer(embeddingManager);

    // Index L0 (abstract) and L1 (overview) pages
    for (const pageType of ["abstract", "overview"]) {
      const page = getWikiPageByDoc(docId, pageType);
      if (!page) continue;

      const content = getPageContent(page.filePath);
      if (!content || content.trim().length === 0) continue;

      await indexer.indexPage(page, content);
    }
  } catch (err) {
    console.warn(
      `[Knowledge] Embedding generation failed for doc ${docId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Extract entities from the overview page and create entity wiki pages
 * plus forward/backward links.
 */
async function extractEntitiesAndLinks(kbId: string, docId: string, filename: string): Promise<void> {
  try {
    const { ModelRouter } = await import("../../models/router.js");
    const { EntityExtractor } = await import("../../wiki/entity-extractor.js");
    const { Linker } = await import("../../wiki/linker.js");

    // Read the overview content for entity extraction
    const overviewPage = getWikiPageByDoc(docId, "overview");
    if (!overviewPage) return;

    const overviewContent = getPageContent(overviewPage.filePath);
    if (!overviewContent || overviewContent.trim().length < 50) return;

    // Extract entities using LLM
    const modelRouter = new ModelRouter();
    await modelRouter.initialize();
    const extractor = new EntityExtractor(modelRouter);
    const entities = await extractor.extract(overviewContent);

    if (entities.length === 0) return;

    const wikiDir = join(DEEPANALYZE_CONFIG.dataDir, "wiki");
    const linker = new Linker();

    // Create entity pages and links (limit to 20 entities per document)
    for (const entity of entities.slice(0, 20)) {
      const entityTitle = `${entity.type}: ${entity.name}`;
      const entityContent = `# ${entity.name}\n\nType: ${entity.type}\n\nMentions:\n${entity.mentions.map((m) => `- ${m}`).join("\n")}\n\nSource: ${filename}`;

      const entityPage = createWikiPage(
        kbId,
        null,
        "entity",
        entityTitle,
        entityContent,
        wikiDir,
      );

      // Create forward link from overview to entity
      linker.createLink(
        overviewPage.id,
        entityPage.id,
        "entity_ref",
        entity.name,
        entity.mentions[0] || "",
      );

      // Create backward link from entity to overview
      linker.createLink(
        entityPage.id,
        overviewPage.id,
        "backward",
        entity.name,
        `Referenced in ${filename}`,
      );
    }

    console.log(`[Knowledge] Extracted ${entities.length} entities from ${filename}`);
  } catch (err) {
    console.warn(
      `[Knowledge] Entity extraction failed for doc ${docId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Exported document parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse a document file into plain text content.
 *
 * Handles text files (read directly) and binary files (parsed via Docling).
 * This function is shared between the route handler and the ProcessingQueue.
 */
export async function parseDocumentFile(filePath: string, fileType: string): Promise<string> {
  const textTypes = ["txt", "markdown", "md", "csv", "json", "html", "xml", "rtf"];
  const doclingTypes = ["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "png", "jpg", "jpeg", "tiff", "bmp"];

  let content: string;

  if (textTypes.includes(fileType)) {
    // Text files: read directly
    try {
      content = readFileSync(filePath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read document: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (doclingTypes.includes(fileType)) {
    // Non-text files: use Docling subprocess for parsing
    try {
      const { SubprocessManager } = await import("../../subprocess/manager.js");
      const { startDocling, parseWithDocling } = await import("../../subprocess/docling-client.js");
      const projectRoot = resolve(DEEPANALYZE_CONFIG.dataDir, "..");

      const mgr = new SubprocessManager();
      await startDocling(projectRoot, mgr);
      console.log(`[Knowledge] Docling parsing: ${filePath}`);

      const result = await parseWithDocling(mgr, filePath, {
        ocr: true,
        extract_tables: true,
      });
      await mgr.stop("docling");

      content = result.content;
      console.log(`[Knowledge] Docling parsed ${filePath}: ${content.length} chars`);
    } catch (err) {
      throw new Error(
        `Docling parsing failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    throw new Error(`Unsupported file type: '${fileType}'`);
  }

  return content;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export const knowledgeRoutes = new Hono();

// =====================================================================
// GET / - Knowledge API root (API discoverability)
// =====================================================================

knowledgeRoutes.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "Knowledge Base API",
    endpoints: [
      "GET    /kbs",
      "POST   /kbs",
      "GET    /kbs/:kbId",
      "PUT    /kbs/:kbId",
      "DELETE /kbs/:kbId",
      "GET    /kbs/:kbId/documents",
      "GET    /kbs/:kbId/entities",
      "POST   /kbs/:kbId/upload",
      "POST   /kbs/:kbId/process/:docId",
      "POST   /kbs/:kbId/process-all",
      "POST   /kbs/:kbId/trigger-processing",
      "GET    /:kbId/search?query=...",
      "GET    /:kbId/wiki/*",
      "POST   /:kbId/expand",
    ],
  });
});

// =====================================================================
// GET /kbs - List all knowledge bases
// =====================================================================

knowledgeRoutes.get("/kbs", (c) => {
  const knowledgeBases = listKnowledgeBases();
  return c.json({ knowledgeBases });
});

// =====================================================================
// POST /kbs - Create a new knowledge base
// =====================================================================

knowledgeRoutes.post("/kbs", async (c) => {
  const body = await c.req.json<{
    name?: string;
    description?: string;
    visibility?: "private" | "team" | "public";
    ownerId?: string;
  }>();

  if (!body.name) {
    return c.json({ error: "name is required" }, 400);
  }

  const ownerId = body.ownerId ?? "default-user";
  const kb = createKnowledgeBase(
    body.name,
    ownerId,
    body.description,
    body.visibility,
  );

  // Create the data directories: {dataDir}/original/{kbId}/ and {dataDir}/wiki/{kbId}/
  const originalDir = join(DEEPANALYZE_CONFIG.dataDir, "original", kb.id);
  const wikiDir = join(DEEPANALYZE_CONFIG.dataDir, "wiki", kb.id);

  try {
    mkdirSync(originalDir, { recursive: true });
    mkdirSync(wikiDir, { recursive: true });
  } catch (err) {
    console.error(
      "[Knowledge] Failed to create directories for KB:",
      err instanceof Error ? err.message : String(err),
    );
    // KB was created in DB but directories failed - still return the KB
  }

  return c.json(kb, 201);
});

// =====================================================================
// GET /kbs/:kbId - Get a single knowledge base
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId", (c) => {
  const kbId = c.req.param("kbId");
  const kb = getKnowledgeBase(kbId);

  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  return c.json(kb);
});

// =====================================================================
// PUT /kbs/:kbId - Update a knowledge base
// =====================================================================

knowledgeRoutes.put("/kbs/:kbId", async (c) => {
  const kbId = c.req.param("kbId");
  const body = await c.req.json<{
    name?: string;
    description?: string;
    visibility?: "private" | "team" | "public";
  }>();

  const kb = updateKnowledgeBase(kbId, body);

  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  return c.json(kb);
});

// =====================================================================
// DELETE /kbs/:kbId - Delete a knowledge base
// =====================================================================

knowledgeRoutes.delete("/kbs/:kbId", (c) => {
  const kbId = c.req.param("kbId");

  // Try to remove the data directories for this KB
  const originalDir = join(DEEPANALYZE_CONFIG.dataDir, "original", kbId);
  const wikiDir = join(DEEPANALYZE_CONFIG.dataDir, "wiki", kbId);

  try {
    rmSync(originalDir, { recursive: true, force: true });
  } catch {
    // Directory may not exist, ignore
  }

  try {
    rmSync(wikiDir, { recursive: true, force: true });
  } catch {
    // Directory may not exist, ignore
  }

  const deleted = deleteKnowledgeBase(kbId);

  if (!deleted) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  return c.json({ id: kbId, deleted: true });
});

// =====================================================================
// GET /kbs/:kbId/documents - List documents in a KB
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId/documents", (c) => {
  const kbId = c.req.param("kbId");
  const kb = getKnowledgeBase(kbId);

  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  const documents = listDocuments(kbId);
  return c.json({ documents });
});

// =====================================================================
// GET /kbs/:kbId/entities - List all entities for a KB
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId/entities", async (c) => {
  const kbId = c.req.param("kbId");

  try {
    const { DB } = await import("../../store/database.js");
    const db = DB.getInstance().raw;

    // Get all entity pages for this KB
    const entities = db.prepare(`
      SELECT
        wp.title as name,
        wp.metadata,
        COUNT(DISTINCT wl.source_page_id) as mention_count,
        COUNT(DISTINCT wp2.doc_id) as doc_count
      FROM wiki_pages wp
      LEFT JOIN wiki_links wl ON wl.target_page_id = wp.id AND wl.link_type = 'entity_ref'
      LEFT JOIN wiki_pages wp2 ON wp2.id = wl.source_page_id
      WHERE wp.kb_id = ? AND wp.page_type = 'entity'
      GROUP BY wp.id
      ORDER BY mention_count DESC
    `).all(kbId) as Array<{ name: string; metadata: string | null; mention_count: number; doc_count: number }>;

    return c.json(entities.map((e) => {
      let entityType = "实体";
      if (e.metadata) {
        try {
          const parsed = JSON.parse(e.metadata);
          if (parsed?.type) entityType = parsed.type;
        } catch {
          // metadata not valid JSON, use default
        }
      }
      // Strip type prefix from title (e.g. "Person: John Doe" -> "John Doe")
      const cleanName = e.name.includes(": ") ? e.name.split(": ").slice(1).join(": ") : e.name;
      return {
        name: cleanName,
        type: entityType,
        mentions: e.mention_count,
        docCount: e.doc_count,
      };
    }));
  } catch (err) {
    return c.json({
      error: "Failed to fetch entities",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// =====================================================================
// POST /kbs/:kbId/upload - Upload a document to a KB
// =====================================================================

knowledgeRoutes.post("/kbs/:kbId/upload", async (c) => {
  const kbId = c.req.param("kbId");

  // Verify KB exists
  const kb = getKnowledgeBase(kbId);
  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  // Parse multipart form data
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }

  // Read the file into a buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Save to a temp file so createDocument can copy it
  const tempPath = join(
    tmpdir(),
    `deepanalyze-${Date.now()}-${file.name}`,
  );

  try {
    writeFileSync(tempPath, buffer);

    // Create document record (copies from temp to the data dir)
    const originalDir = join(DEEPANALYZE_CONFIG.dataDir, "original");
    const doc = createDocument(kbId, file.name, tempPath, originalDir);

    // Auto-enqueue for processing (respects auto_process setting)
    const queue = getProcessingQueue();
    let autoProcess = true;
    try {
      const { DB } = await import("../../store/database.js");
      const db = DB.getInstance().raw;
      const row = db.prepare("SELECT value FROM settings WHERE key = 'auto_process'").get() as { value: string } | undefined;
      autoProcess = row?.value !== "false";
    } catch {
      // Settings table may not exist yet — default to auto-process
    }

    if (autoProcess) {
      queue.enqueue({
        kbId,
        docId: doc.id,
        filename: doc.filename,
        filePath: doc.filePath,
        fileType: doc.fileType,
      });
    }

    return c.json(doc, 201);
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tempPath);
    } catch {
      // Temp file cleanup is best-effort
    }
  }
});

// =====================================================================
// POST /kbs/:kbId/process/:docId - Process a single document
// =====================================================================

knowledgeRoutes.post("/kbs/:kbId/process/:docId", async (c) => {
  const kbId = c.req.param("kbId");
  const docId = c.req.param("docId");

  // Verify KB exists
  const kb = getKnowledgeBase(kbId);
  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  // Verify document exists and belongs to this KB
  const doc = getDocument(docId);
  if (!doc || doc.kbId !== kbId) {
    return c.json({ error: "Document not found" }, 404);
  }

  // Don't re-process already ready documents
  if (doc.status === "ready") {
    return c.json({
      documentId: docId,
      status: "ready",
      message: "Document is already processed",
    });
  }

  // Enqueue for asynchronous processing
  const queue = getProcessingQueue();
  queue.enqueue({
    kbId,
    docId: doc.id,
    filename: doc.filename,
    filePath: doc.filePath,
    fileType: doc.fileType,
  });

  return c.json({
    documentId: docId,
    status: "queued",
    message: "Document enqueued for processing",
  });
});

// =====================================================================
// POST /kbs/:kbId/process-all - Process all uploaded documents in a KB
// =====================================================================

knowledgeRoutes.post("/kbs/:kbId/process-all", async (c) => {
  const kbId = c.req.param("kbId");

  // Verify KB exists
  const kb = getKnowledgeBase(kbId);
  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  const queue = getProcessingQueue();
  const documents = listDocuments(kbId);
  let enqueued = 0;

  for (const doc of documents) {
    // Only enqueue documents that are in "uploaded" or "error" state
    if (doc.status !== "uploaded" && doc.status !== "error") {
      continue;
    }

    queue.enqueue({
      kbId,
      docId: doc.id,
      filename: doc.filename,
      filePath: doc.filePath,
      fileType: doc.fileType,
    });
    enqueued++;
  }

  return c.json({ enqueued });
});

// =====================================================================
// POST /kbs/:kbId/trigger-processing - Enqueue all uploaded docs for processing
// =====================================================================

knowledgeRoutes.post("/kbs/:kbId/trigger-processing", async (c) => {
  const kbId = c.req.param("kbId");
  const queue = getProcessingQueue();
  const { DB } = await import("../../store/database.js");
  const db = DB.getInstance().raw;

  const docs = db
    .prepare("SELECT id, filename, file_path, file_type FROM documents WHERE kb_id = ? AND status = 'uploaded'")
    .all(kbId) as Array<{ id: string; filename: string; file_path: string; file_type: string }>;

  let enqueued = 0;
  for (const doc of docs) {
    queue.enqueue({
      kbId,
      docId: doc.id,
      filename: doc.filename,
      filePath: doc.file_path,
      fileType: doc.file_type,
    });
    enqueued++;
  }

  return c.json({ enqueued });
});

// =====================================================================
// GET /:kbId/search - Search wiki pages in a knowledge base
// =====================================================================

knowledgeRoutes.get("/:kbId/search", async (c) => {
  const kbId = c.req.param("kbId");
  // Accept both "query" and "q" parameter names for flexibility
  const query = decodeURIComponent(c.req.query("query") || c.req.query("q") || "");
  const topK = parseInt(c.req.query("topK") || "10", 10);
  const docIdsParam = c.req.query("docIds");

  if (!query.trim()) {
    return c.json({ error: "query parameter is required (use ?query=... or ?q=...)" }, 400);
  }

  // Build docId filter set if provided
  const docIdFilter = docIdsParam
    ? new Set(docIdsParam.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  // Verify KB exists
  const kb = getKnowledgeBase(kbId);
  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  try {
    // Simple search: use wiki_pages table to find matching content
    const { DB } = await import("../../store/database.js");
    const db = DB.getInstance().raw;
    const likePattern = `%${query}%`;

    // Search by title and page content
    const titleRows = db.prepare(
      `SELECT id, kb_id, doc_id, page_type, title, file_path
       FROM wiki_pages
       WHERE kb_id = ? AND (title LIKE ? OR page_type IN ('abstract', 'overview'))
       LIMIT ?`,
    ).all(kbId, likePattern, topK) as Record<string, unknown>[];

    // Also scan content of all pages in this KB (limit to avoid excessive I/O)
    const allPages = db.prepare(
      `SELECT id, kb_id, doc_id, page_type, title, file_path
       FROM wiki_pages WHERE kb_id = ?`,
    ).all(kbId) as Record<string, unknown>[];

    const existingIds = new Set(titleRows.map((r) => r.id as string));
    const contentMatches: Array<Record<string, unknown> & { _score: number; _snippet: string }> = [];

    for (const row of allPages) {
      if (existingIds.has(row.id as string)) continue;
      try {
        const content = getPageContent(row.file_path as string);
        const idx = content.toLowerCase().indexOf(query.toLowerCase());
        if (idx >= 0) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(content.length, idx + query.length + 100);
          let snippet = content.substring(start, end);
          if (start > 0) snippet = "..." + snippet;
          if (end < content.length) snippet = snippet + "...";
          contentMatches.push({ ...row, _score: 0.5, _snippet: snippet });
        }
      } catch {
        // skip unreadable pages
      }
      if (contentMatches.length >= topK * 2) break;
    }

    // Merge title matches and content matches
    const results = [
      ...titleRows.map((row) => {
        let snippet = "";
        try {
          const content = getPageContent(row.file_path as string);
          snippet = content.substring(0, 200);
        } catch { /* ignore */ }
        return {
          docId: (row.doc_id as string) || "",
          level: row.page_type as string,
          content: snippet,
          score: 0.8,
          metadata: { pageId: row.id as string, title: row.title as string },
        };
      }),
      ...contentMatches.map((row) => ({
        docId: (row.doc_id as string) || "",
        level: row.page_type as string,
        content: row._snippet,
        score: row._score,
        metadata: { pageId: row.id as string, title: row.title as string },
      })),
    ].slice(0, topK);

    // Apply docId filter if provided
    const filteredResults = docIdFilter
      ? results.filter((r) => !r.docId || docIdFilter.has(r.docId))
      : results;

    return c.json({ results: filteredResults, totalFound: filteredResults.length });
  } catch (err) {
    console.error("[Knowledge] Search failed:", err);
    return c.json({
      error: "Search failed",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// =====================================================================
// GET /:kbId/wiki/* - Browse wiki pages
// =====================================================================

knowledgeRoutes.get("/:kbId/wiki/*", async (c) => {
  const kbId = c.req.param("kbId");
  // Extract the page path after /:kbId/wiki/
  const fullPath = c.req.path;
  const wikiPrefix = `/api/knowledge/${kbId}/wiki/`;
  const pagePath = fullPath.startsWith(wikiPrefix)
    ? fullPath.substring(wikiPrefix.length)
    : "";

  if (!pagePath) {
    // List all pages in the KB
    const pages = getWikiPagesByKb(kbId);
    return c.json({ pages });
  }

  try {
    const { DB } = await import("../../store/database.js");
    const db = DB.getInstance().raw;

    // Try to find page by ID first
    let page = getWikiPage(decodeURIComponent(pagePath));

    if (!page) {
      // Try to find by file_path containing the page path
      const row = db.prepare(
        `SELECT id FROM wiki_pages WHERE kb_id = ? AND file_path LIKE ? LIMIT 1`,
      ).get(kbId, `%${decodeURIComponent(pagePath)}%`) as Record<string, unknown> | undefined;

      if (row) {
        page = getWikiPage(row.id as string);
      }
    }

    if (!page) {
      return c.json({ error: "Page not found" }, 404);
    }

    const content = getPageContent(page.filePath);

    return c.json({
      id: page.id,
      kbId: page.kbId,
      docId: page.docId,
      pageType: page.pageType,
      title: page.title,
      content,
      tokenCount: page.tokenCount,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    });
  } catch (err) {
    return c.json({
      error: "Failed to browse wiki",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// =====================================================================
// POST /:kbId/expand - Expand wiki content to a deeper level
// =====================================================================

knowledgeRoutes.post("/:kbId/expand", async (c) => {
  const kbId = c.req.param("kbId");
  const body = await c.req.json<{
    docId?: string;
    level?: string;
    section?: string;
    pageId?: string;
  }>();

  if (!body.docId && !body.pageId) {
    return c.json({ error: "docId or pageId is required" }, 400);
  }

  try {
    const { Expander } = await import("../../wiki/expander.js");
    const expander = new Expander(DEEPANALYZE_CONFIG.dataDir);

    if (body.pageId && body.section) {
      const result = await expander.expandSection(body.pageId, body.section);
      if (!result) {
        return c.json({ error: "Section not found" }, 404);
      }
      return c.json({
        content: result.content,
        level: result.level,
        expandable: true,
        pageId: result.pageId,
      });
    }

    if (body.docId && body.level) {
      const result = await expander.expandToLevel(
        body.docId,
        body.level as "L0" | "L1" | "L2",
      );
      return c.json({
        content: result.content,
        level: result.level,
        expandable: !!result.childPages && result.childPages.length > 0,
        pageId: result.pageId,
      });
    }

    if (body.pageId) {
      const result = await expander.expand(body.pageId);
      return c.json({
        content: result.content,
        level: result.level,
        expandable: !!result.childPages && result.childPages.length > 0,
        pageId: result.pageId,
      });
    }

    return c.json({ error: "Invalid parameters" }, 400);
  } catch (err) {
    return c.json({
      error: "Expand failed",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
