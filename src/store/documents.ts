// =============================================================================
// DeepAnalyze - Document Data Operations
// CRUD operations for document records in the SQLite database.
// =============================================================================

import { DB } from "./database.js";
import type { Document } from "../types/index.js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { copyFileSync, statSync, readFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join, extname, dirname } from "node:path";

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, string> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "doc",
  ".xlsx": "xlsx",
  ".xls": "xls",
  ".pptx": "pptx",
  ".ppt": "ppt",
  ".txt": "txt",
  ".md": "markdown",
  ".csv": "csv",
  ".json": "json",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".rtf": "rtf",
  ".odt": "odt",
  ".epub": "epub",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".bmp": "image",
  ".tiff": "image",
  ".tif": "image",
};

function detectFileType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return EXTENSION_MAP[ext] ?? "unknown";
}

// ---------------------------------------------------------------------------
// Row-to-object mapping (snake_case DB -> camelCase JS)
// ---------------------------------------------------------------------------

function rowToDocument(row: Record<string, unknown>): Document {
  return {
    id: row.id as string,
    kbId: row.kb_id as string,
    filename: row.filename as string,
    filePath: row.file_path as string,
    fileHash: row.file_hash as string,
    fileSize: row.file_size as number,
    fileType: row.file_type as string,
    status: row.status as Document["status"],
    metadata: row.metadata as string | null,
    createdAt: row.created_at as string,
    processingStep: row.processing_step as string | null ?? null,
    processingProgress: row.processing_progress as number ?? 0.0,
    processingError: row.processing_error as string | null ?? null,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new document record. Copies the source file into the
 * original/{kbId}/{docId}/ directory and computes an MD5 hash.
 */
export function createDocument(
  kbId: string,
  filename: string,
  sourcePath: string,
  originalDir: string,
): Document {
  const db = DB.getInstance().raw;
  const id = randomUUID();

  // Copy source file to original/{kbId}/{docId}/{filename}
  const destDir = join(originalDir, kbId, id);
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, filename);
  copyFileSync(sourcePath, destPath);

  // Compute MD5 hash of the original file
  const fileBuffer = readFileSync(destPath);
  const fileHash = createHash("md5").update(fileBuffer).digest("hex");

  // Get file size
  const stat = statSync(destPath);
  const fileSize = stat.size;

  // Detect file type from extension
  const fileType = detectFileType(filename);

  // Insert into database
  db.prepare(
    `INSERT INTO documents (id, kb_id, filename, file_path, file_hash, file_size, file_type, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded')`,
  ).run(id, kbId, filename, destPath, fileHash, fileSize, fileType);

  return {
    id,
    kbId,
    filename,
    filePath: destPath,
    fileHash,
    fileSize,
    fileType,
    status: "uploaded",
    metadata: null,
    createdAt: new Date().toISOString(),
    processingStep: null,
    processingProgress: 0.0,
    processingError: null,
  };
}

/**
 * Get a single document by ID.
 */
export function getDocument(id: string): Document | undefined {
  const db = DB.getInstance().raw;
  const row = db
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToDocument(row) : undefined;
}

/**
 * List all documents for a knowledge base.
 */
export function listDocuments(kbId: string): Document[] {
  const db = DB.getInstance().raw;
  const rows = db
    .prepare("SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC")
    .all(kbId) as Record<string, unknown>[];
  return rows.map(rowToDocument);
}

/**
 * Update the processing status of a document.
 */
export function updateDocumentStatus(
  id: string,
  status: Document["status"],
): void {
  const db = DB.getInstance().raw;
  db.prepare("UPDATE documents SET status = ? WHERE id = ?").run(status, id);
}

/**
 * Delete a document and clean up associated data.
 * Removes: document DB row, wiki pages, wiki links, file from disk.
 */
export function deleteDocument(id: string): boolean {
  const db = DB.getInstance().raw;
  const doc = getDocument(id);
  if (!doc) return false;

  // Collect wiki page file paths for disk cleanup
  const wikiRows = db
    .prepare("SELECT file_path FROM wiki_pages WHERE doc_id = ?")
    .all(id) as Array<{ file_path: string }>;

  // Wrap DB operations in a transaction for consistency
  const deleteTx = db.transaction(() => {
    // Delete wiki links referencing this document's pages
    db.prepare(
      `DELETE FROM wiki_links WHERE source_page_id IN (SELECT id FROM wiki_pages WHERE doc_id = ?)
       OR target_page_id IN (SELECT id FROM wiki_pages WHERE doc_id = ?)`,
    ).run(id, id);

    // Delete wiki pages for this document
    db.prepare("DELETE FROM wiki_pages WHERE doc_id = ?").run(id);

    // Delete the document DB row
    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  });

  deleteTx();

  // Clean up files from disk (after successful DB transaction)
  for (const row of wikiRows) {
    try { unlinkSync(row.file_path); } catch { /* file may not exist */ }
  }

  try {
    const dir = dirname(doc.filePath);
    rmSync(dir, { recursive: true, force: true });
  } catch { /* directory may not exist */ }

  return true;
}
