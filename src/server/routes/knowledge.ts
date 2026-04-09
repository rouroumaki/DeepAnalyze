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
import { createWikiPage } from "../../store/wiki-pages.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEEPANALYZE_CONFIG } from "../../core/config.js";

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export const knowledgeRoutes = new Hono();

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

  try {
    // Step 1: Update status to "parsing"
    updateDocumentStatus(docId, "parsing");

    // Step 2: Read the document file
    let content: string;
    try {
      content = readFileSync(doc.filePath, "utf-8");
    } catch (err) {
      // If we can't read the file as text, mark as error
      updateDocumentStatus(docId, "error");
      return c.json({
        documentId: docId,
        status: "error",
        message: `Failed to read document: ${err instanceof Error ? err.message : String(err)}`,
      }, 500);
    }

    // Step 3: Determine if the file type can be processed directly
    const textTypes = ["txt", "markdown", "csv", "json", "html", "xml", "rtf"];
    if (!textTypes.includes(doc.fileType)) {
      // Non-text file types require external parsing (e.g., Docling for PDFs)
      updateDocumentStatus(docId, "error");
      return c.json({
        documentId: docId,
        status: "error",
        message: `File type '${doc.fileType}' requires external parsing. Use the Docling integration for this file type.`,
      }, 400);
    }

    // Step 4: Update status to "compiling"
    updateDocumentStatus(docId, "compiling");

    // Step 5: Create wiki pages from the content
    // For the simplified pipeline, create fulltext and overview pages directly.
    // The full WikiCompiler (with LLM-powered summarization) is invoked separately
    // when the agent pipeline is available.
    const wikiDir = join(DEEPANALYZE_CONFIG.dataDir, "wiki");
    const docWikiDir = join(wikiDir, kbId, "documents", docId);

    try {
      mkdirSync(docWikiDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Create a fulltext (L2) wiki page with the raw content
    createWikiPage(
      kbId,
      docId,
      "fulltext",
      `Document: ${doc.filename}`,
      content,
      wikiDir,
    );

    // For text files, create an overview (L1) page with the first portion
    const overviewContent = content.length > 2000
      ? `# ${doc.filename}\n\n${content.slice(0, 2000)}\n\n...(truncated, full content is ${content.length} characters)`
      : `# ${doc.filename}\n\n${content}`;

    createWikiPage(
      kbId,
      docId,
      "overview",
      `Overview: ${doc.filename}`,
      overviewContent,
      wikiDir,
    );

    // Create an abstract (L0) page with the first line or a summary
    const firstParagraph = content.split("\n\n")[0] || content.slice(0, 200);
    const abstractContent = firstParagraph.length > 200
      ? firstParagraph.slice(0, 200) + "..."
      : firstParagraph;

    createWikiPage(
      kbId,
      docId,
      "abstract",
      `Abstract: ${doc.filename}`,
      abstractContent,
      wikiDir,
    );

    // Step 6: Update status to "ready"
    updateDocumentStatus(docId, "ready");

    return c.json({
      documentId: docId,
      status: "ready",
      message: "Document processed successfully. Created fulltext, overview, and abstract pages.",
    });
  } catch (err) {
    console.error(
      `[Knowledge] Document processing failed for ${docId}:`,
      err instanceof Error ? err.message : String(err),
    );
    updateDocumentStatus(docId, "error");
    return c.json({
      documentId: docId,
      status: "error",
      message: `Processing failed: ${err instanceof Error ? err.message : String(err)}`,
    }, 500);
  }
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

  const documents = listDocuments(kbId);
  let processed = 0;
  let errors = 0;

  for (const doc of documents) {
    // Only process documents that are in "uploaded" or "error" state
    if (doc.status !== "uploaded" && doc.status !== "error") {
      continue;
    }

    try {
      // Update status to "parsing"
      updateDocumentStatus(doc.id, "parsing");

      // Read the document file
      let content: string;
      try {
        content = readFileSync(doc.filePath, "utf-8");
      } catch {
        updateDocumentStatus(doc.id, "error");
        errors++;
        continue;
      }

      // Check if the file type can be processed directly
      const textTypes = ["txt", "markdown", "csv", "json", "html", "xml", "rtf"];
      if (!textTypes.includes(doc.fileType)) {
        updateDocumentStatus(doc.id, "error");
        errors++;
        continue;
      }

      // Update status to "compiling"
      updateDocumentStatus(doc.id, "compiling");

      // Create wiki pages
      const wikiDir = join(DEEPANALYZE_CONFIG.dataDir, "wiki");
      const docWikiDir = join(wikiDir, kbId, "documents", doc.id);

      try {
        mkdirSync(docWikiDir, { recursive: true });
      } catch {
        // Directory may already exist
      }

      // Fulltext page
      createWikiPage(
        kbId,
        doc.id,
        "fulltext",
        `Document: ${doc.filename}`,
        content,
        wikiDir,
      );

      // Overview page
      const overviewContent = content.length > 2000
        ? `# ${doc.filename}\n\n${content.slice(0, 2000)}\n\n...(truncated, full content is ${content.length} characters)`
        : `# ${doc.filename}\n\n${content}`;

      createWikiPage(
        kbId,
        doc.id,
        "overview",
        `Overview: ${doc.filename}`,
        overviewContent,
        wikiDir,
      );

      // Abstract page
      const firstParagraph = content.split("\n\n")[0] || content.slice(0, 200);
      const abstractContent = firstParagraph.length > 200
        ? firstParagraph.slice(0, 200) + "..."
        : firstParagraph;

      createWikiPage(
        kbId,
        doc.id,
        "abstract",
        `Abstract: ${doc.filename}`,
        abstractContent,
        wikiDir,
      );

      // Mark as ready
      updateDocumentStatus(doc.id, "ready");
      processed++;
    } catch (err) {
      console.error(
        `[Knowledge] Batch processing failed for doc ${doc.id}:`,
        err instanceof Error ? err.message : String(err),
      );
      updateDocumentStatus(doc.id, "error");
      errors++;
    }
  }

  return c.json({ processed, errors });
});
