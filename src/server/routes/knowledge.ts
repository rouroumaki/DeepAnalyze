// =============================================================================
// DeepAnalyze - Knowledge Base API Routes
// Hono routes for knowledge base management, document upload, and processing.
// =============================================================================

import { Hono } from "hono";
import { getRepos } from "../../store/repos/index.js";
import type { WikiPage, WikiPageCreate } from "../../store/repos/index.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, createReadStream } from "node:fs";
import { copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DEEPANALYZE_CONFIG } from "../../core/config.js";
import { getProcessingQueue } from "../../services/processing-queue.js";

// ---------------------------------------------------------------------------
// Helper: Detect file type from extension
// ---------------------------------------------------------------------------

function detectFileType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const typeMap: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    html: "text/html",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
  };
  return typeMap[ext] ?? "application/octet-stream";
}

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
    await embeddingManager.initialize();
    const indexer = new Indexer(embeddingManager);

    // Index L0 (abstract) and L1 (overview) pages
    const repos = await getRepos();
    for (const pageType of ["abstract", "overview"]) {
      const page = await repos.wikiPage.getByDocAndType(docId, pageType);
      if (!page) continue;

      const content = page.content;
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

    const repos = await getRepos();

    // Read the overview content for entity extraction
    const overviewPage = await repos.wikiPage.getByDocAndType(docId, "overview");
    if (!overviewPage) return;

    const overviewContent = overviewPage.content;
    if (!overviewContent || overviewContent.trim().length < 50) return;

    // Extract entities using LLM
    const modelRouter = new ModelRouter();
    await modelRouter.initialize();
    const extractor = new EntityExtractor(modelRouter);
    const entities = await extractor.extract(overviewContent);

    if (entities.length === 0) return;

    // Create entity pages and links (limit to 20 entities per document)
    for (const entity of entities.slice(0, 20)) {
      const entityTitle = `${entity.type}: ${entity.name}`;
      const entityContent = `# ${entity.name}\n\nType: ${entity.type}\n\nMentions:\n${entity.mentions.map((m) => `- ${m}`).join("\n")}\n\nSource: ${filename}`;

      const wikiDir = join(DEEPANALYZE_CONFIG.dataDir, "wiki");
      const filePath = join(wikiDir, kbId, `${entityTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.md`);

      const entityPage = await repos.wikiPage.create({
        kb_id: kbId,
        doc_id: undefined,
        page_type: "entity",
        title: entityTitle,
        content: entityContent,
        file_path: filePath,
      });

      // Create forward link from overview to entity
      await repos.wikiLink.create(
        overviewPage.id,
        entityPage.id,
        "entity_ref",
        entity.name,
        entity.mentions[0] || "",
      );

      // Create backward link from entity to overview
      await repos.wikiLink.create(
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
 * Routes through ProcessorFactory which picks the best processor for each
 * file type (native JS processors for Excel, docling for PDF/DOCX, etc.).
 * This function is shared between the route handler and the ProcessingQueue.
 */
export async function parseDocumentFile(filePath: string, fileType: string): Promise<string> {
  const { ProcessorFactory } = await import("../../services/document-processors/processor-factory.js");
  const factory = ProcessorFactory.getInstance();
  const parsed = await factory.parse(filePath, fileType);

  if (!parsed.success) {
    throw new Error(parsed.error ?? `Parse failed for ${filePath}`);
  }

  return parsed.text;
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
      "GET    /kbs/:kbId/pages/:pageId?level=L1",
      "GET    /kbs/:kbId/pages/:pageId/preview?level=L1&q=keyword",
      "POST   /kbs/:kbId/upload",
      "GET    /kbs/:kbId/documents/:docId/status",
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

knowledgeRoutes.get("/kbs", async (c) => {
  const repos = await getRepos();
  const knowledgeBases = await repos.knowledgeBase.list();
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
  const repos = await getRepos();
  const kb = await repos.knowledgeBase.create(
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

knowledgeRoutes.get("/kbs/:kbId", async (c) => {
  const kbId = c.req.param("kbId");
  const repos = await getRepos();
  const kb = await repos.knowledgeBase.get(kbId);

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

  const repos = await getRepos();
  const kb = await repos.knowledgeBase.update(kbId, body);

  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  return c.json(kb);
});

// =====================================================================
// DELETE /kbs/:kbId - Delete a knowledge base
// =====================================================================

knowledgeRoutes.delete("/kbs/:kbId", async (c) => {
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

  const repos = await getRepos();
  const deleted = await repos.knowledgeBase.delete(kbId);

  if (!deleted) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  return c.json({ id: kbId, deleted: true });
});

// =====================================================================
// GET /kbs/:kbId/documents - List documents in a KB
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId/documents", async (c) => {
  const kbId = c.req.param("kbId");
  const repos = await getRepos();
  const kb = await repos.knowledgeBase.get(kbId);

  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  const documents = await repos.document.getByKbId(kbId);
  return c.json({ documents });
});

// =====================================================================
// GET /kbs/:kbId/entities - List all entities for a KB
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId/entities", async (c) => {
  const kbId = c.req.param("kbId");

  try {
    const repos = await getRepos();

    // Get all entity pages for this KB
    const entityPages = await repos.wikiPage.getByKbAndType(kbId, "entity");

    // For each entity, count mentions via wiki_links
    const entities = [];
    for (const page of entityPages) {
      const outgoing = await repos.wikiLink.getIncoming(page.id);
      const mentionCount = outgoing.filter((l) => l.linkType === "entity_ref").length;

      // Count distinct source docs
      const docIds = new Set<string>();
      for (const link of outgoing) {
        if (link.linkType === "entity_ref") {
          const sourcePage = await repos.wikiPage.getById(link.sourcePageId);
          if (sourcePage?.doc_id) docIds.add(sourcePage.doc_id);
        }
      }

      let entityType = "实体";
      if (page.metadata && typeof page.metadata === "object") {
        const meta = page.metadata as Record<string, unknown>;
        if (meta.type) entityType = meta.type as string;
      }

      // Strip type prefix from title (e.g. "Person: John Doe" -> "John Doe")
      const cleanName = page.title.includes(": ") ? page.title.split(": ").slice(1).join(": ") : page.title;

      entities.push({
        name: cleanName,
        type: entityType,
        mentions: mentionCount,
        docCount: docIds.size,
      });
    }

    // Sort by mention count descending
    entities.sort((a, b) => b.mentions - a.mentions);

    return c.json(entities);
  } catch (err) {
    return c.json({
      error: "Failed to fetch entities",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// =====================================================================
// GET /kbs/:kbId/pages/:pageId - Get page with level parameter
// Returns page content and lists all available levels for the document.
// =====================================================================

const PAGE_TYPE_TO_LEVEL: Record<string, "L0" | "L1" | "L2"> = {
  abstract: "L0",
  overview: "L1",
  fulltext: "L2",
};

const LEVEL_TO_PAGE_TYPE: Record<string, string> = {
  L0: "abstract",
  L1: "overview",
  L2: "fulltext",
};

knowledgeRoutes.get("/kbs/:kbId/pages/:pageId", async (c) => {
  const kbId = c.req.param("kbId");
  const pageId = c.req.param("pageId");
  const levelParam = c.req.query("level"); // "L0", "L1", "L2"
  const pageTypeParam = c.req.query("pageType"); // "abstract", "overview", "fulltext"

  try {
    const repos = await getRepos();

    // Look up the original page
    const page = await repos.wikiPage.getById(pageId);
    if (!page || page.kb_id !== kbId) {
      return c.json({ error: "Page not found" }, 404);
    }

    // Determine which page type to return
    // If levelParam or pageTypeParam is given, try to find the sibling page at that level
    let targetPage = page;
    const requestedPageType = pageTypeParam ?? (levelParam ? LEVEL_TO_PAGE_TYPE[levelParam] : undefined);

    if (requestedPageType && requestedPageType !== page.page_type && page.doc_id) {
      const sibling = await repos.wikiPage.getByDocAndType(page.doc_id, requestedPageType);
      if (sibling) {
        targetPage = sibling;
      }
    }

    // Find all available levels for this document
    const availableLevels: Array<"L0" | "L1" | "L2"> = [];
    if (targetPage.doc_id) {
      const docPages = await repos.wikiPage.getManyByDocAndType(targetPage.doc_id, "abstract");
      const overviewPages = await repos.wikiPage.getManyByDocAndType(targetPage.doc_id, "overview");
      const fulltextPages = await repos.wikiPage.getManyByDocAndType(targetPage.doc_id, "fulltext");

      const pageTypes = new Set<string>();
      for (const p of [...docPages, ...overviewPages, ...fulltextPages]) {
        pageTypes.add(p.page_type);
      }
      for (const pt of pageTypes) {
        const lvl = PAGE_TYPE_TO_LEVEL[pt];
        if (lvl) availableLevels.push(lvl);
      }
    } else {
      // Single page without document association - just report its own level
      const lvl = PAGE_TYPE_TO_LEVEL[targetPage.page_type];
      if (lvl) availableLevels.push(lvl);
    }

    return c.json({
      id: targetPage.id,
      kbId: targetPage.kb_id,
      docId: targetPage.doc_id,
      pageType: targetPage.page_type,
      level: PAGE_TYPE_TO_LEVEL[targetPage.page_type] ?? "L1",
      title: targetPage.title,
      content: targetPage.content,
      tokenCount: targetPage.token_count,
      availableLevels,
      createdAt: targetPage.created_at,
      updatedAt: targetPage.updated_at,
    });
  } catch (err) {
    return c.json({
      error: "Failed to get page",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// =====================================================================
// GET /kbs/:kbId/pages/:pageId/preview - Preview snippet with highlights
// Returns a short snippet with keyword highlighting for hover preview.
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId/pages/:pageId/preview", async (c) => {
  const kbId = c.req.param("kbId");
  const pageId = c.req.param("pageId");
  const level = c.req.query("level") || "L1"; // "L0", "L1", "L2"
  const q = c.req.query("q") || ""; // query keywords (space-separated)
  const snippetLen = parseInt(c.req.query("snippetLen") || "300", 10);

  try {
    const repos = await getRepos();

    const page = await repos.wikiPage.getById(pageId);
    if (!page || page.kb_id !== kbId) {
      return c.json({ error: "Page not found" }, 404);
    }

    // If a specific level is requested, try to load that sibling page
    let targetPage = page;
    const requestedType = LEVEL_TO_PAGE_TYPE[level];
    if (requestedType && requestedType !== page.page_type && page.doc_id) {
      const sibling = await repos.wikiPage.getByDocAndType(page.doc_id, requestedType);
      if (sibling) targetPage = sibling;
    }

    const fullContent = targetPage.content;
    const keywords = q.split(/\s+/).map((w) => w.trim()).filter(Boolean);

    // Find the best snippet position based on keyword density
    let snippetStart = 0;
    if (keywords.length > 0 && fullContent.length > snippetLen) {
      let bestPos = 0;
      let bestScore = -1;

      // Slide a window of snippetLen over the content and score by keyword matches
      const step = Math.max(50, Math.floor(snippetLen / 4));
      for (let pos = 0; pos < fullContent.length - snippetLen; pos += step) {
        const window = fullContent.substring(pos, pos + snippetLen).toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          const idx = window.indexOf(kw.toLowerCase());
          if (idx >= 0) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestPos = pos;
        }
      }

      if (bestScore > 0) {
        snippetStart = bestPos;
      }
    }

    // Extract snippet
    let snippet: string;
    if (fullContent.length <= snippetLen) {
      snippet = fullContent;
    } else {
      const end = Math.min(fullContent.length, snippetStart + snippetLen);
      snippet = fullContent.substring(snippetStart, end);
      if (snippetStart > 0) snippet = "..." + snippet;
      if (end < fullContent.length) snippet = snippet + "...";
    }

    // Compute available levels
    const availableLevels: Array<"L0" | "L1" | "L2"> = [];

    if (targetPage.doc_id) {
      const docPages = await repos.wikiPage.getManyByDocAndType(targetPage.doc_id, "abstract");
      const overviewPages = await repos.wikiPage.getManyByDocAndType(targetPage.doc_id, "overview");
      const fulltextPages = await repos.wikiPage.getManyByDocAndType(targetPage.doc_id, "fulltext");

      const pageTypes = new Set<string>();
      for (const p of [...docPages, ...overviewPages, ...fulltextPages]) {
        pageTypes.add(p.page_type);
      }
      for (const pt of pageTypes) {
        const lvl = PAGE_TYPE_TO_LEVEL[pt];
        if (lvl) availableLevels.push(lvl);
      }
    } else {
      const lvl = PAGE_TYPE_TO_LEVEL[targetPage.page_type];
      if (lvl) availableLevels.push(lvl);
    }

    return c.json({
      title: targetPage.title,
      level: PAGE_TYPE_TO_LEVEL[targetPage.page_type] ?? level,
      tokenCount: targetPage.token_count,
      snippet,
      availableLevels,
    });
  } catch (err) {
    return c.json({
      error: "Failed to get preview",
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
  const repos = await getRepos();
  const kb = await repos.knowledgeBase.get(kbId);
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

  // Save to a temp file so we can copy it to the data dir
  const tempPath = join(
    tmpdir(),
    `deepanalyze-${randomUUID()}-${file.name}`,
  );

  try {
    writeFileSync(tempPath, buffer);

    // Create document record: copy file to original dir, compute hash, insert into DB
    const originalDir = join(DEEPANALYZE_CONFIG.dataDir, "original");
    const docId = randomUUID();

    // Copy source file to original/{kbId}/{docId}/{filename}
    const destDir = join(originalDir, kbId, docId);
    mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, file.name);
    copyFileSync(tempPath, destPath);

    // Compute MD5 hash of the original file
    const fileBuffer = readFileSync(destPath);
    const fileHash = createHash("md5").update(fileBuffer).digest("hex");

    // Get file size
    const stat = statSync(destPath);
    const fileSize = stat.size;

    // Detect file type from extension
    const fileType = detectFileType(file.name);

    const doc = await repos.document.create({
      kb_id: kbId,
      filename: file.name,
      file_path: destPath,
      file_hash: fileHash,
      file_size: fileSize,
      file_type: fileType,
      status: "uploaded",
      metadata: {},
      processing_step: null,
      processing_progress: 0,
      processing_error: null,
    });

    // Auto-enqueue for processing (respects auto_process setting)
    const queue = getProcessingQueue();
    let autoProcess = true;
    try {
      const autoProcessVal = await repos.settings.get("auto_process");
      autoProcess = autoProcessVal !== "false";
    } catch {
      // Settings table may not exist yet — default to auto-process
    }

    if (autoProcess) {
      queue.enqueue({
        kbId,
        docId: doc.id,
        filename: doc.filename,
        filePath: doc.file_path,
        fileType: doc.file_type,
      });
    }

    // Map to API response (camelCase)
    return c.json({
      id: doc.id,
      kbId: doc.kb_id,
      filename: doc.filename,
      filePath: doc.file_path,
      fileHash: doc.file_hash,
      fileSize: doc.file_size,
      fileType: doc.file_type,
      status: doc.status,
      createdAt: doc.created_at,
    }, 201);
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
  const repos = await getRepos();
  const kb = await repos.knowledgeBase.get(kbId);
  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  // Verify document exists and belongs to this KB
  const doc = await repos.document.getById(docId);
  if (!doc || doc.kb_id !== kbId) {
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
    filePath: doc.file_path,
    fileType: doc.file_type,
  });

  return c.json({
    documentId: docId,
    status: "queued",
    message: "Document enqueued for processing",
  });
});

// =====================================================================
// DELETE /kbs/:kbId/documents/:docId - Delete a document
// =====================================================================

knowledgeRoutes.delete("/kbs/:kbId/documents/:docId", async (c) => {
  const kbId = c.req.param("kbId");
  const docId = c.req.param("docId");

  const repos = await getRepos();

  // Verify document exists and belongs to this KB
  const doc = await repos.document.getById(docId);
  if (!doc || doc.kb_id !== kbId) {
    return c.json({ error: "Document not found" }, 404);
  }

  await repos.document.deleteById(docId);

  return c.json({ id: docId, deleted: true });
});

// =====================================================================
// GET /knowledge/:kbId/documents/:docId/status - Document processing status
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId/documents/:docId/status", async (c) => {
  const kbId = c.req.param("kbId");
  const docId = c.req.param("docId");

  const repos = await getRepos();
  const doc = await repos.document.getById(docId);

  if (!doc || doc.kb_id !== kbId) {
    return c.json({ error: "Document not found" }, 404);
  }

  const stageMap: Record<string, { stage: string; progress: number }> = {
    uploaded:   { stage: "Queued",     progress: 5 },
    parsing:    { stage: "Parsing",    progress: 50 },
    compiling:  { stage: "Compiling",  progress: 60 },
    indexing:   { stage: "Indexing",   progress: 75 },
    linking:    { stage: "Linking",    progress: 90 },
    ready:      { stage: "Ready",      progress: 100 },
    error:      { stage: "Error",      progress: 0 },
  };

  const info = stageMap[doc.status] ?? { stage: doc.status, progress: 0 };

  return c.json({
    docId: doc.id,
    filename: doc.filename,
    stage: info.stage,
    progress: info.progress,
    status: doc.status,
  });
});

// =====================================================================
// POST /kbs/:kbId/process-all - Process all uploaded documents in a KB
// =====================================================================

knowledgeRoutes.post("/kbs/:kbId/process-all", async (c) => {
  const kbId = c.req.param("kbId");

  // Verify KB exists
  const repos = await getRepos();
  const kb = await repos.knowledgeBase.get(kbId);
  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  const queue = getProcessingQueue();
  const documents = await repos.document.getByKbId(kbId);
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
      filePath: doc.file_path,
      fileType: doc.file_type,
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
  const repos = await getRepos();

  // Verify KB exists
  const kb = await repos.knowledgeBase.get(kbId);
  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  const queue = getProcessingQueue();

  const documents = await repos.document.getByKbId(kbId);
  const uploadedDocs = documents.filter((d) => d.status === "uploaded");

  let enqueued = 0;
  for (const doc of uploadedDocs) {
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
  const repos = await getRepos();
  const kb = await repos.knowledgeBase.get(kbId);
  if (!kb) {
    return c.json({ error: "Knowledge base not found" }, 404);
  }

  try {
    // Simple search: use wiki_pages table to find matching content
    // Search by title and page content
    const allPages = await repos.wikiPage.getByKbAndType(kbId);
    const escaped = query.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const likePattern = escaped.toLowerCase();

    const titleRows = allPages.filter(
      (p) =>
        p.title.toLowerCase().includes(likePattern) ||
        p.page_type === "abstract" ||
        p.page_type === "overview",
    ).slice(0, topK);

    // Also scan content of all pages in this KB (limit to avoid excessive I/O)
    const existingIds = new Set(titleRows.map((r) => r.id));
    const contentMatches: Array<(WikiPage & { _score: number; _snippet: string })> = [];

    for (const page of allPages) {
      if (existingIds.has(page.id)) continue;
      try {
        const content = page.content;
        const idx = content.toLowerCase().indexOf(query.toLowerCase());
        if (idx >= 0) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(content.length, idx + query.length + 100);
          let snippet = content.substring(start, end);
          if (start > 0) snippet = "..." + snippet;
          if (end < content.length) snippet = snippet + "...";
          contentMatches.push({ ...page, _score: 0.5, _snippet: snippet });
        }
      } catch {
        // skip unreadable pages
      }
      if (contentMatches.length >= topK * 2) break;
    }

    // Merge title matches and content matches
    const results = [
      ...titleRows.map((page) => {
        let snippet = "";
        try {
          snippet = page.content.substring(0, 200);
        } catch { /* ignore */ }
        return {
          docId: page.doc_id || "",
          level: page.page_type,
          content: snippet,
          score: 0.8,
          metadata: { pageId: page.id, title: page.title },
        };
      }),
      ...contentMatches.map((page) => ({
        docId: page.doc_id || "",
        level: page.page_type,
        content: page._snippet,
        score: page._score,
        metadata: { pageId: page.id, title: page.title },
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

  const repos = await getRepos();

  if (!pagePath) {
    // List all pages in the KB
    const pages = await repos.wikiPage.getByKbAndType(kbId);
    return c.json({ pages });
  }

  try {
    // Try to find page by ID first
    let page = await repos.wikiPage.getById(decodeURIComponent(pagePath));

    if (!page) {
      // Try to find by title containing the page path
      const decodedPath = decodeURIComponent(pagePath);
      const allPages = await repos.wikiPage.getByKbAndType(kbId);
      page = allPages.find((p) => p.title.includes(decodedPath));
    }

    if (!page) {
      return c.json({ error: "Page not found" }, 404);
    }

    const content = page.content;

    // Query links for this page
    let links: Array<{
      sourcePageId: string;
      targetPageId: string;
      linkType: string;
      entityName?: string;
    }> = [];
    try {
      const outgoing = await repos.wikiLink.getOutgoing(page.id);
      const incoming = await repos.wikiLink.getIncoming(page.id);
      links = [
        ...outgoing.map((l) => ({
          sourcePageId: l.sourcePageId,
          targetPageId: l.targetPageId,
          linkType: l.linkType,
          entityName: l.entityName || undefined,
        })),
        ...incoming.map((l) => ({
          sourcePageId: l.sourcePageId,
          targetPageId: l.targetPageId,
          linkType: l.linkType,
          entityName: l.entityName || undefined,
        })),
      ];
    } catch {
      // Linker may fail if wiki_links table doesn't exist yet
    }

    return c.json({
      id: page.id,
      kbId: page.kb_id,
      docId: page.doc_id,
      pageType: page.page_type,
      title: page.title,
      content,
      tokenCount: page.token_count,
      links,
      createdAt: page.created_at,
      updatedAt: page.updated_at,
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

// =====================================================================
// GET /kbs/:kbId/documents/:docId/download - Download original file
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId/documents/:docId/download", async (c) => {
  const { kbId, docId } = c.req.param();

  const repos = await getRepos();
  const doc = await repos.document.getById(docId);
  if (!doc || doc.kb_id !== kbId) {
    return c.json({ error: "Document not found" }, 404);
  }

  const filePath = doc.file_path;
  const originalName = doc.filename;

  try {
    const stream = createReadStream(filePath);
    return new Response(stream as any, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(originalName)}"`,
      },
    });
  } catch {
    return c.json({ error: "File not found on disk" }, 404);
  }
});

// =====================================================================
// GET /kbs/:kbId/documents/:docId/export/:format - Multi-format export
// format: "raw-json" | "doctags" | "markdown" | "structure-bundle"
// =====================================================================

knowledgeRoutes.get("/kbs/:kbId/documents/:docId/export/:format", async (c) => {
  const { kbId, docId, format } = c.req.param();

  try {
    const repos = await getRepos();

    switch (format) {
      case "raw-json": {
        const rawPath = join(DEEPANALYZE_CONFIG.dataDir, kbId, "documents", docId, "raw", "docling.json");
        try {
          const content = readFileSync(rawPath, "utf-8");
          return new Response(content, {
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition": `attachment; filename="${docId}_raw.json"`,
            },
          });
        } catch {
          return c.json({ error: "Raw JSON not found" }, 404);
        }
      }

      case "doctags": {
        const pages = await repos.wikiPage.getManyByDocAndType(docId, "structure");
        if (pages.length === 0) return c.json({ error: "No structure pages found" }, 404);
        const doctags = pages.map((p) => `# ${p.title}\n\n${p.content}`).join("\n\n---\n\n");
        return new Response(doctags, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="${docId}_doctags.txt"`,
          },
        });
      }

      case "markdown": {
        const pages = await repos.wikiPage.getManyByDocAndType(docId, "structure");
        if (pages.length === 0) return c.json({ error: "No structure pages found" }, 404);
        const md = pages.map((p) => `## ${p.title}\n\n${p.content}`).join("\n\n");
        return new Response(md, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="${docId}.md"`,
          },
        });
      }

      case "structure-bundle": {
        const pages = await repos.wikiPage.getManyByDocAndType(docId, "structure");
        const anchors = await repos.anchor.getByDocId(docId);
        const manifest = JSON.stringify({
          docId,
          kbId,
          pages: pages.map((p) => ({
            id: p.id,
            title: p.title,
            pageType: p.page_type,
            metadata: p.metadata,
          })),
          anchors: anchors.map((a) => ({
            id: a.id,
            type: a.element_type,
            sectionTitle: a.section_title,
            pageNumber: a.page_number,
          })),
        }, null, 2);
        return new Response(manifest, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${docId}_structure_manifest.json"`,
          },
        });
      }

      default:
        return c.json({ error: `Invalid format: ${format}. Use raw-json, doctags, markdown, or structure-bundle.` }, 400);
    }
  } catch (err) {
    return c.json({
      error: "Export failed",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// =============================================================================
// POST /kbs/:kbId/reindex - Reindex all documents in a knowledge base
// Triggered when embedding model dimension changes to rebuild stale embeddings.
// =============================================================================

knowledgeRoutes.post("/kbs/:kbId/reindex", async (c) => {
  const kbId = c.req.param("kbId");

  try {
    const repos = await getRepos();
    const kb = await repos.knowledgeBase.get(kbId);
    if (!kb) {
      return c.json({ error: "Knowledge base not found" }, 404);
    }

    const docs = await repos.document.getByKbId(kbId);
    const queue = getProcessingQueue();
    let enqueued = 0;

    for (const doc of docs) {
      if (doc.status === "ready") {
        queue.enqueue({
          kbId,
          docId: doc.id,
          filename: doc.filename,
          filePath: doc.file_path,
          fileType: doc.file_type,
        });
        enqueued++;
      }
    }

    return c.json({
      message: `Reindex triggered for ${enqueued} documents in knowledge base ${kbId}`,
      enqueued,
      total: docs.length,
    });
  } catch (err) {
    return c.json({
      error: "Reindex failed",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
