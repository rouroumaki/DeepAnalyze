// =============================================================================
// DeepAnalyze - SQLite Repository Implementations
// Wraps the existing SQLite (better-sqlite3) tables behind the Repository
// interfaces so that routes like preview and search-test work without PG.
// =============================================================================

import { DB } from "../database.js";
import { readFileSync } from "node:fs";
import type {
  RepoSet,
  AnchorRepo,
  AnchorDef,
  WikiPageRepo,
  WikiPage,
  WikiPageCreate,
  DocumentRepo,
  Document,
  VectorSearchRepo,
  VectorSearchResult,
  VectorSearchOptions,
  FTSSearchRepo,
  FTSSearchResult,
  FTSSearchOptions,
  EmbeddingRepo,
  EmbeddingRow,
  EmbeddingCreate,
} from "./interfaces";

// ---------------------------------------------------------------------------
// SqliteWikiPageRepo
// ---------------------------------------------------------------------------

export class SqliteWikiPageRepo implements WikiPageRepo {
  private get db() { return DB.getInstance().raw; }

  async create(data: WikiPageCreate): Promise<WikiPage> {
    const id = crypto.randomUUID();
    const metadata = data.metadata ? JSON.stringify(data.metadata) : null;
    this.db.prepare(
      `INSERT INTO wiki_pages (id, kb_id, doc_id, page_type, title, file_path, content_hash, token_count, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, data.kb_id, data.doc_id ?? null, data.page_type, data.title, data.file_path ?? "", data.content_hash ?? "", data.token_count ?? 0, metadata);
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<WikiPage | undefined> {
    const row = this.db.prepare("SELECT * FROM wiki_pages WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  async getByDocAndType(docId: string, pageType: string): Promise<WikiPage | undefined> {
    const row = this.db.prepare("SELECT * FROM wiki_pages WHERE doc_id = ? AND page_type = ? LIMIT 1").get(docId, pageType) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  async getManyByDocAndType(docId: string, pageType: string): Promise<WikiPage[]> {
    const rows = this.db.prepare("SELECT * FROM wiki_pages WHERE doc_id = ? AND page_type = ? ORDER BY created_at").all(docId, pageType) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  async getByKbAndType(kbId: string, pageType?: string): Promise<WikiPage[]> {
    const sql = pageType
      ? "SELECT * FROM wiki_pages WHERE kb_id = ? AND page_type = ?"
      : "SELECT * FROM wiki_pages WHERE kb_id = ?";
    const params = pageType ? [kbId, pageType] : [kbId];
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    this.db.prepare("UPDATE wiki_pages SET metadata = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(metadata), id);
  }

  async updateContent(id: string, content: string, contentHash: string, tokenCount: number): Promise<void> {
    this.db.prepare("UPDATE wiki_pages SET content_hash = ?, token_count = ?, updated_at = datetime('now') WHERE id = ?").run(contentHash, tokenCount, id);
  }

  async deleteById(id: string): Promise<void> {
    this.db.prepare("DELETE FROM wiki_pages WHERE id = ?").run(id);
  }

  async deleteByDocId(docId: string): Promise<void> {
    this.db.prepare("DELETE FROM wiki_pages WHERE doc_id = ?").run(docId);
  }

  private mapRow(row: Record<string, unknown>): WikiPage {
    const filePath = row.file_path as string;
    let content = "";
    try {
      if (filePath) content = readFileSync(filePath, "utf-8");
    } catch { /* file may not exist */ }
    return {
      id: row.id as string,
      kb_id: row.kb_id as string,
      doc_id: (row.doc_id as string) ?? null,
      page_type: row.page_type as string,
      title: row.title as string,
      file_path: filePath,
      content,
      content_hash: (row.content_hash as string) ?? "",
      token_count: (row.token_count as number) ?? 0,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
      created_at: (row.created_at as string) ?? "",
      updated_at: (row.updated_at as string) ?? "",
    };
  }
}

// ---------------------------------------------------------------------------
// SqliteAnchorRepo
// ---------------------------------------------------------------------------

export class SqliteAnchorRepo implements AnchorRepo {
  private get db() { return DB.getInstance().raw; }

  async batchInsert(anchors: AnchorDef[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO anchors (id, doc_id, kb_id, element_type, element_index, section_path, section_title, page_number, raw_json_path, structure_page_id, content_preview, content_hash, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const a of anchors) {
      stmt.run(a.id, a.doc_id, a.kb_id, a.element_type, a.element_index, a.section_path ?? null, a.section_title ?? null, a.page_number ?? null, a.raw_json_path ?? null, a.structure_page_id ?? null, a.content_preview ?? null, a.content_hash ?? null, JSON.stringify(a.metadata ?? {}));
    }
  }

  async getByDocId(docId: string): Promise<AnchorDef[]> {
    const rows = this.db.prepare("SELECT * FROM anchors WHERE doc_id = ? ORDER BY element_index").all(docId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  async getById(anchorId: string): Promise<AnchorDef | undefined> {
    const row = this.db.prepare("SELECT * FROM anchors WHERE id = ?").get(anchorId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  async getByStructurePageId(pageId: string): Promise<AnchorDef[]> {
    const rows = this.db.prepare("SELECT * FROM anchors WHERE structure_page_id = ? ORDER BY element_index").all(pageId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  async updateStructurePageId(anchorIds: string[], pageId: string): Promise<void> {
    const placeholders = anchorIds.map(() => "?").join(",");
    this.db.prepare(`UPDATE anchors SET structure_page_id = ? WHERE id IN (${placeholders})`).run(pageId, ...anchorIds);
  }

  async deleteByDocId(docId: string): Promise<void> {
    this.db.prepare("DELETE FROM anchors WHERE doc_id = ?").run(docId);
  }

  private mapRow(row: Record<string, unknown>): AnchorDef {
    return {
      id: row.id as string,
      doc_id: row.doc_id as string,
      kb_id: row.kb_id as string,
      element_type: row.element_type as string,
      element_index: row.element_index as number,
      section_path: (row.section_path as string) ?? undefined,
      section_title: (row.section_title as string) ?? undefined,
      page_number: (row.page_number as number) ?? undefined,
      raw_json_path: (row.raw_json_path as string) ?? undefined,
      structure_page_id: (row.structure_page_id as string) ?? undefined,
      content_preview: (row.content_preview as string) ?? undefined,
      content_hash: (row.content_hash as string) ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// SqliteDocumentRepo
// ---------------------------------------------------------------------------

export class SqliteDocumentRepo implements DocumentRepo {
  private get db() { return DB.getInstance().raw; }

  async getById(id: string): Promise<Document | undefined> {
    const row = this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  async getByKbId(kbId: string): Promise<Document[]> {
    const rows = this.db.prepare("SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC").all(kbId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  async create(doc: Omit<Document, "id" | "created_at">): Promise<Document> {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO documents (id, kb_id, filename, file_path, file_hash, file_size, file_type, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, doc.kb_id, doc.filename, doc.file_path, doc.file_hash, doc.file_size, doc.file_type, doc.status, JSON.stringify(doc.metadata ?? {}));
    return (await this.getById(id))!;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    this.db.prepare("UPDATE documents SET status = ? WHERE id = ?").run(status, id);
  }

  async updateProcessing(id: string, step: string, progress: number, error?: string): Promise<void> {
    // SQLite documents table doesn't have processing columns; this is a no-op
    // until migration adds them, or we just ignore it.
  }

  async deleteById(id: string): Promise<void> {
    this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  }

  async deleteByKbId(kbId: string): Promise<void> {
    this.db.prepare("DELETE FROM documents WHERE kb_id = ?").run(kbId);
  }

  private mapRow(row: Record<string, unknown>): Document {
    return {
      id: row.id as string,
      kb_id: row.kb_id as string,
      filename: row.filename as string,
      file_path: row.file_path as string,
      file_hash: row.file_hash as string,
      file_size: (row.file_size as number) ?? 0,
      file_type: (row.file_type as string) ?? "",
      status: row.status as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
      created_at: (row.created_at as string) ?? "",
    };
  }
}

// ---------------------------------------------------------------------------
// SqliteVectorSearchRepo (uses embeddings table with brute-force cosine sim)
// ---------------------------------------------------------------------------

export class SqliteVectorSearchRepo implements VectorSearchRepo {
  private get db() { return DB.getInstance().raw; }

  async upsertEmbedding(row: EmbeddingCreate): Promise<void> {
    const buffer = Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
    this.db.prepare(
      `INSERT INTO embeddings (id, page_id, model_name, dimension, vector, text_chunk, chunk_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, model_name, chunk_index) DO UPDATE SET
         vector = excluded.vector, text_chunk = excluded.text_chunk, dimension = excluded.dimension, id = excluded.id`,
    ).run(row.id, row.page_id, row.model_name, row.dimension, buffer, row.text_chunk ?? null, row.chunk_index ?? 0);
  }

  async searchByVector(queryVector: Float32Array, kbIds: string[], options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    // Brute-force cosine similarity (acceptable for small datasets)
    const modelName = options.modelName ?? "default";
    const placeholders = kbIds.map(() => "?").join(",");
    const rows = this.db.prepare(
      `SELECT e.*, wp.kb_id, wp.doc_id, wp.page_type, wp.title
       FROM embeddings e
       JOIN wiki_pages wp ON e.page_id = wp.id
       WHERE e.model_name = ? AND wp.kb_id IN (${placeholders})`,
    ).all(modelName, ...kbIds) as Record<string, unknown>[];

    const scored = rows.map((row) => {
      const blob = row.vector as Buffer;
      const vec = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / Float32Array.BYTES_PER_ELEMENT);
      const similarity = cosineSimilarity(queryVector, vec);
      return { row, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    const topK = options.topK ?? 10;
    return scored.slice(0, topK).map(({ row, similarity }) => ({
      id: row.id as string,
      page_id: row.page_id as string,
      text_chunk: (row.text_chunk as string) ?? "",
      model_name: row.model_name as string,
      similarity,
      kb_id: row.kb_id as string,
      doc_id: (row.doc_id as string) ?? null,
      page_type: row.page_type as string,
      title: row.title as string,
    }));
  }

  async deleteByPageId(pageId: string): Promise<void> {
    this.db.prepare("DELETE FROM embeddings WHERE page_id = ?").run(pageId);
  }

  async deleteByDocId(docId: string): Promise<void> {
    const pages = this.db.prepare("SELECT id FROM wiki_pages WHERE doc_id = ?").all(docId) as { id: string }[];
    for (const p of pages) {
      this.db.prepare("DELETE FROM embeddings WHERE page_id = ?").run(p.id);
    }
  }
}

// ---------------------------------------------------------------------------
// SqliteFTSSearchRepo (uses FTS5)
// ---------------------------------------------------------------------------

export class SqliteFTSSearchRepo implements FTSSearchRepo {
  private get db() { return DB.getInstance().raw; }

  async upsertFTSEntry(pageId: string, title: string, content: string): Promise<void> {
    const rowResult = this.db.prepare("SELECT rowid FROM wiki_pages WHERE id = ?").get(pageId) as { rowid: number } | undefined;
    if (!rowResult) return;
    const rowid = rowResult.rowid;
    this.db.prepare("DELETE FROM fts_content WHERE rowid = ?").run(rowid);
    this.db.prepare("INSERT INTO fts_content(rowid, title, content) VALUES (?, ?, ?)").run(rowid, title, content);
  }

  async searchByText(query: string, kbIds: string[], options: FTSSearchOptions): Promise<FTSSearchResult[]> {
    const placeholders = kbIds.map(() => "?").join(",");
    const rows = this.db.prepare(
      `SELECT wp.id, wp.kb_id, wp.doc_id, wp.page_type, wp.title, wp.file_path,
              bm25(fts_content) as rank
       FROM fts_content fc
       JOIN wiki_pages wp ON fc.rowid = wp.rowid
       WHERE fts_content MATCH ? AND wp.kb_id IN (${placeholders})
       ORDER BY rank
       LIMIT ?`,
    ).all(query, ...kbIds, options.topK) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      kb_id: r.kb_id as string,
      doc_id: (r.doc_id as string) ?? null,
      page_type: r.page_type as string,
      title: r.title as string,
      file_path: (r.file_path as string) ?? "",
      rank: r.rank as number,
    }));
  }

  async deleteByPageId(pageId: string): Promise<void> {
    const rowResult = this.db.prepare("SELECT rowid FROM wiki_pages WHERE id = ?").get(pageId) as { rowid: number } | undefined;
    if (rowResult) {
      this.db.prepare("DELETE FROM fts_content WHERE rowid = ?").run(rowResult.rowid);
    }
  }
}

// ---------------------------------------------------------------------------
// SqliteEmbeddingRepo
// ---------------------------------------------------------------------------

export class SqliteEmbeddingRepo implements EmbeddingRepo {
  private get db() { return DB.getInstance().raw; }

  async getOrNone(pageId: string, modelName: string, chunkIndex: number): Promise<EmbeddingRow | undefined> {
    const row = this.db.prepare("SELECT * FROM embeddings WHERE page_id = ? AND model_name = ? AND chunk_index = ?").get(pageId, modelName, chunkIndex) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const blob = row.vector as Buffer;
    const vector = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / Float32Array.BYTES_PER_ELEMENT);
    return {
      id: row.id as string,
      page_id: row.page_id as string,
      model_name: row.model_name as string,
      dimension: row.dimension as number,
      vector,
      text_chunk: (row.text_chunk as string) ?? "",
      chunk_index: row.chunk_index as number,
      created_at: (row.created_at as string) ?? "",
    };
  }

  async upsert(row: EmbeddingCreate): Promise<void> {
    const buffer = Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
    this.db.prepare(
      `INSERT INTO embeddings (id, page_id, model_name, dimension, vector, text_chunk, chunk_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, model_name, chunk_index) DO UPDATE SET
         vector = excluded.vector, text_chunk = excluded.text_chunk, dimension = excluded.dimension, id = excluded.id`,
    ).run(row.id, row.page_id, row.model_name, row.dimension, buffer, row.text_chunk ?? null, row.chunk_index ?? 0);
  }

  async deleteByPageId(pageId: string): Promise<void> {
    this.db.prepare("DELETE FROM embeddings WHERE page_id = ?").run(pageId);
  }
}

// ---------------------------------------------------------------------------
// Helper: cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSqliteRepos(): RepoSet {
  return {
    vectorSearch: new SqliteVectorSearchRepo(),
    ftsSearch: new SqliteFTSSearchRepo(),
    anchor: new SqliteAnchorRepo(),
    wikiPage: new SqliteWikiPageRepo(),
    document: new SqliteDocumentRepo(),
    embedding: new SqliteEmbeddingRepo(),
  };
}
