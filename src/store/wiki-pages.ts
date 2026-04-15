// =============================================================================
// DeepAnalyze - Wiki Page Data Operations
// CRUD operations for wiki_page records, with filesystem management for
// the underlying markdown files.
// =============================================================================

import { DB } from "./database.js";
import type { WikiPage } from "../types/index.js";
import { randomUUID } from "node:crypto";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Path helpers - determine filesystem location based on page type
// ---------------------------------------------------------------------------

function resolvePageFilePath(
  wikiDir: string,
  kbId: string,
  docId: string | null,
  pageType: WikiPage["pageType"],
  title: string,
  id: string,
): string {
  switch (pageType) {
    case "abstract":
      return join(wikiDir, kbId, "documents", docId!, ".abstract.md");
    case "overview":
      return join(wikiDir, kbId, "documents", docId!, ".overview.md");
    case "fulltext":
      return join(wikiDir, kbId, "documents", docId!, "parsed.md");
    case "entity": {
      // Sanitize title for use as filename
      const safeName = title.replace(/[/\\?%*:|"<>]/g, "_");
      return join(wikiDir, kbId, "entities", `${safeName}.md`);
    }
    case "concept": {
      const safeName = title.replace(/[/\\?%*:|"<>]/g, "_");
      return join(wikiDir, kbId, "concepts", `${safeName}.md`);
    }
    case "report":
      return join(wikiDir, kbId, "reports", `${id}.md`);
    case "structure": {
      const safeName = title.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 100);
      return join(wikiDir, kbId, "documents", docId!, "structure", `${safeName}.md`);
    }
    default:
      throw new Error(`Unknown page type: ${pageType}`);
  }
}

// ---------------------------------------------------------------------------
// Row-to-object mapping (snake_case DB -> camelCase JS)
// ---------------------------------------------------------------------------

function rowToWikiPage(row: Record<string, unknown>): WikiPage {
  return {
    id: row.id as string,
    kbId: row.kb_id as string,
    docId: row.doc_id as string | null,
    pageType: row.page_type as WikiPage["pageType"],
    title: row.title as string,
    filePath: row.file_path as string,
    contentHash: row.content_hash as string,
    tokenCount: row.token_count as number,
    metadata: row.metadata as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new wiki page. Writes the markdown content to the filesystem
 * and inserts a record into the database.
 */
export function createWikiPage(
  kbId: string,
  docId: string | null,
  pageType: WikiPage["pageType"],
  title: string,
  content: string,
  wikiDir: string,
): WikiPage {
  const db = DB.getInstance().raw;
  const id = randomUUID();

  // Resolve the filesystem path for this page
  const filePath = resolvePageFilePath(wikiDir, kbId, docId, pageType, title, id);

  // Ensure parent directory exists
  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true });

  // Check if file already exists (e.g., entity pages with same title)
  // For entity/concept pages, we may want to append instead of overwrite
  if (existsSync(filePath) && (pageType === "entity" || pageType === "concept")) {
    // Append new content to existing entity/concept page
    const existing = readFileSync(filePath, "utf-8");
    const updated = existing + "\n\n---\n\n" + content;
    writeFileSync(filePath, updated, "utf-8");
  } else {
    writeFileSync(filePath, content, "utf-8");
  }

  // Compute content hash
  const contentHash = createHash("md5").update(content).digest("hex");

  // Rough token count estimate (~4 chars per token)
  const tokenCount = Math.ceil(content.length / 4);

  // Insert into database
  db.prepare(
    `INSERT INTO wiki_pages (id, kb_id, doc_id, page_type, title, file_path, content_hash, token_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, kbId, docId, pageType, title, filePath, contentHash, tokenCount);

  return {
    id,
    kbId,
    docId,
    pageType,
    title,
    filePath,
    contentHash,
    tokenCount,
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get a single wiki page by ID.
 */
export function getWikiPage(id: string): WikiPage | undefined {
  const db = DB.getInstance().raw;
  const row = db
    .prepare("SELECT * FROM wiki_pages WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToWikiPage(row) : undefined;
}

/**
 * Get a wiki page by document ID and page type.
 */
export function getWikiPageByDoc(
  docId: string,
  pageType: string,
): WikiPage | undefined {
  const db = DB.getInstance().raw;
  const row = db
    .prepare(
      "SELECT * FROM wiki_pages WHERE doc_id = ? AND page_type = ? LIMIT 1",
    )
    .get(docId, pageType) as Record<string, unknown> | undefined;
  return row ? rowToWikiPage(row) : undefined;
}

/**
 * List all wiki pages for a knowledge base, optionally filtered by page type.
 */
export function getWikiPagesByKb(
  kbId: string,
  pageType?: string,
): WikiPage[] {
  const db = DB.getInstance().raw;
  let rows: Record<string, unknown>[];

  if (pageType) {
    rows = db
      .prepare(
        "SELECT * FROM wiki_pages WHERE kb_id = ? AND page_type = ? ORDER BY created_at DESC",
      )
      .all(kbId, pageType) as Record<string, unknown>[];
  } else {
    rows = db
      .prepare("SELECT * FROM wiki_pages WHERE kb_id = ? ORDER BY created_at DESC")
      .all(kbId) as Record<string, unknown>[];
  }

  return rows.map(rowToWikiPage);
}

/**
 * Update the content of a wiki page (filesystem + DB).
 */
export function updateWikiPage(id: string, content: string): void {
  const db = DB.getInstance().raw;

  const page = getWikiPage(id);
  if (!page) {
    throw new Error(`Wiki page not found: ${id}`);
  }

  // Write updated content to filesystem
  writeFileSync(page.filePath, content, "utf-8");

  // Update DB record
  const contentHash = createHash("md5").update(content).digest("hex");
  const tokenCount = Math.ceil(content.length / 4);

  db.prepare(
    `UPDATE wiki_pages
     SET content_hash = ?, token_count = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(contentHash, tokenCount, id);
}

/**
 * Delete a wiki page (filesystem + DB).
 */
export function deleteWikiPage(id: string): void {
  const db = DB.getInstance().raw;

  const page = getWikiPage(id);
  if (!page) {
    throw new Error(`Wiki page not found: ${id}`);
  }

  // Remove file from filesystem
  if (existsSync(page.filePath)) {
    unlinkSync(page.filePath);
  }

  // Remove from database (cascading will handle wiki_links)
  db.prepare("DELETE FROM wiki_pages WHERE id = ?").run(id);
}

/**
 * Read the content of a wiki page from the filesystem.
 */
export function getPageContent(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

/**
 * Get all structure pages for a specific document, ordered by title.
 * Uses the PG Repository layer if available, otherwise falls back to SQLite.
 */
export async function getStructurePagesByDoc(docId: string): Promise<any[]> {
  if (process.env.PG_HOST) {
    const { createReposAsync } = await import('./repos/index.js');
    const repos = await createReposAsync();
    const page = await repos.wikiPage.getByDocAndType(docId, 'structure');
    return page ? [page] : [];
  }
  // SQLite fallback
  const db = DB.getInstance().raw;
  const rows = db.prepare(
    "SELECT * FROM wiki_pages WHERE doc_id = ? AND page_type = 'structure' ORDER BY title"
  ).all(docId);
  return rows;
}
