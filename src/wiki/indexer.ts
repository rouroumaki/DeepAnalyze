// =============================================================================
// DeepAnalyze - Wiki Indexer
// Manages the indexing of wiki pages into both the FTS5 full-text search table
// and the embeddings table for vector similarity search.
// =============================================================================

import { randomUUID } from "node:crypto";
import { DB } from "../store/database.js";
import { getWikiPagesByKb, getPageContent } from "../store/wiki-pages.js";
import type { WikiPage } from "../types/index.js";
import type { EmbeddingManager } from "../models/embedding.js";

// ---------------------------------------------------------------------------
// Indexer
// ---------------------------------------------------------------------------

export class Indexer {
  private embeddingManager: EmbeddingManager;

  constructor(embeddingManager: EmbeddingManager) {
    this.embeddingManager = embeddingManager;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Index all pages for a specific document. L0 (abstract) and L1 (overview)
   * pages are indexed into the embeddings table; L2 (fulltext) pages are
   * indexed into both FTS5 and embeddings.
   */
  async indexDocument(kbId: string, docId: string): Promise<void> {
    const db = DB.getInstance().raw;

    // Get all pages for this document
    const pages = db
      .prepare("SELECT * FROM wiki_pages WHERE doc_id = ?")
      .all(docId) as Record<string, unknown>[];

    for (const row of pages) {
      const page = this.rowToWikiPage(row);
      const content = getPageContent(page.filePath);
      await this.indexPage(page, content);
    }
  }

  /**
   * Index a single page into both FTS5 and embeddings.
   */
  async indexPage(page: WikiPage, content: string): Promise<void> {
    const db = DB.getInstance().raw;

    // Insert into FTS5 for full-text search (BM25).
    // Since fts_content uses content='wiki_pages', we insert directly
    // using the page's rowid to keep the FTS index in sync.
    try {
      // Get the rowid of the wiki_pages record
      const rowResult = db
        .prepare("SELECT rowid FROM wiki_pages WHERE id = ?")
        .get(page.id) as Record<string, unknown> | undefined;

      if (rowResult) {
        const rowid = rowResult.rowid as number;

        // Delete any existing FTS entry for this rowid, then re-insert
        db.prepare("DELETE FROM fts_content WHERE rowid = ?").run(rowid);
        db.prepare(
          "INSERT INTO fts_content(rowid, title, content) VALUES (?, ?, ?)",
        ).run(rowid, page.title, content);
      }
    } catch (err) {
      // FTS5 operations may fail if the table is misconfigured.
      // Log but do not crash -- embedding indexing can still proceed.
      console.warn(
        `[Indexer] FTS5 indexing failed for page ${page.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Compute and store embedding
    try {
      await this.getOrComputeEmbedding(page.id, content, 0);
    } catch (err) {
      console.warn(
        `[Indexer] Embedding computation failed for page ${page.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Re-index an entire knowledge base: all pages in all documents.
   */
  async indexKb(kbId: string): Promise<void> {
    const pages = getWikiPagesByKb(kbId);

    for (const page of pages) {
      try {
        const content = getPageContent(page.filePath);
        await this.indexPage(page, content);
      } catch (err) {
        console.warn(
          `[Indexer] Failed to index page ${page.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Remove all embeddings for a page.
   */
  async removePageIndex(pageId: string): Promise<void> {
    const db = DB.getInstance().raw;

    // Remove embeddings
    db.prepare("DELETE FROM embeddings WHERE page_id = ?").run(pageId);

    // Remove from FTS5
    try {
      const rowResult = db
        .prepare("SELECT rowid FROM wiki_pages WHERE id = ?")
        .get(pageId) as Record<string, unknown> | undefined;

      if (rowResult) {
        const rowid = rowResult.rowid as number;
        db.prepare("DELETE FROM fts_content WHERE rowid = ?").run(rowid);
      }
    } catch {
      // Ignore FTS5 errors during removal
    }
  }

  /**
   * Get an existing embedding for a page/chunk or compute and store a new one.
   */
  async getOrComputeEmbedding(
    pageId: string,
    text: string,
    chunkIndex: number = 0,
  ): Promise<Float32Array> {
    const db = DB.getInstance().raw;
    const modelName = this.embeddingManager.providerName;

    // Check for an existing embedding
    const existing = db
      .prepare(
        "SELECT vector FROM embeddings WHERE page_id = ? AND model_name = ? AND chunk_index = ?",
      )
      .get(pageId, modelName, chunkIndex) as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      const blob = existing.vector as Buffer;
      return new Float32Array(
        blob.buffer,
        blob.byteOffset,
        blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );
    }

    // Compute new embedding
    const result = await this.embeddingManager.embed(text);
    const vector = result.embedding;

    // Serialize Float32Array to Buffer for SQLite BLOB storage
    const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);

    const id = randomUUID();
    db.prepare(
      `INSERT INTO embeddings (id, page_id, model_name, dimension, vector, text_chunk, chunk_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, pageId, modelName, this.embeddingManager.dimension, buffer, text, chunkIndex);

    return vector;
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(
        `Vector dimension mismatch: ${a.length} vs ${b.length}`,
      );
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;

    return dot / denom;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private rowToWikiPage(row: Record<string, unknown>): WikiPage {
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
}
