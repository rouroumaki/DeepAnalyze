// =============================================================================
// DeepAnalyze - Repository Interfaces & Domain Types
// Defines all repository interfaces for the data access layer, supporting
// both PostgreSQL (pgvector + zhparser) and SQLite backends.
// =============================================================================

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** Structural element anchor within a document. */
export interface AnchorDef {
  id: string;
  doc_id: string;
  kb_id: string;
  element_type: string;
  element_index: number;
  section_path?: string;
  section_title?: string;
  page_number?: number;
  raw_json_path?: string;
  structure_page_id?: string;
  content_preview?: string;
  content_hash?: string;
  metadata?: Record<string, unknown>;
}

/** Wiki page record with full content. */
export interface WikiPage {
  id: string;
  kb_id: string;
  doc_id: string | null;
  page_type: string;
  title: string;
  file_path: string;
  content: string;
  content_hash: string;
  token_count: number;
  metadata: Record<string, unknown> | null;
  fts_vector?: unknown; // tsvector in PG, unused in SQLite
  created_at: string;
  updated_at: string;
}

/** Data required to create a new wiki page. */
export interface WikiPageCreate {
  kb_id: string;
  doc_id?: string;
  page_type: string;
  title: string;
  content?: string;
  file_path?: string;
  content_hash?: string;
  token_count?: number;
  metadata?: Record<string, unknown>;
}

/** Document record. */
export interface Document {
  id: string;
  kb_id: string;
  filename: string;
  file_path: string;
  file_hash: string;
  file_size: number;
  file_type: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  processing_step?: string;
  processing_progress?: number;
  processing_error?: string;
}

/** Embedding row with raw vector data. */
export interface EmbeddingRow {
  id: string;
  page_id: string;
  model_name: string;
  dimension: number;
  vector: Float32Array;
  text_chunk: string;
  chunk_index: number;
  created_at: string;
}

/** Data required to create or update an embedding. */
export interface EmbeddingCreate {
  id: string;
  page_id: string;
  model_name: string;
  dimension: number;
  vector: Float32Array;
  text_chunk?: string;
  chunk_index?: number;
}

/** Result row from vector similarity search. */
export interface VectorSearchResult {
  id: string;
  page_id: string;
  text_chunk: string;
  model_name: string;
  similarity: number;
  kb_id: string;
  doc_id: string | null;
  page_type: string;
  title: string;
}

/** Result row from full-text search. */
export interface FTSSearchResult {
  id: string;
  kb_id: string;
  doc_id: string | null;
  page_type: string;
  title: string;
  file_path: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// Repository Interfaces
// ---------------------------------------------------------------------------

/** Options for vector similarity search. */
export interface VectorSearchOptions {
  topK: number;
  minScore?: number;
  pageTypes?: string[];
  modelName?: string;
}

/** Options for full-text search. */
export interface FTSSearchOptions {
  topK: number;
}

/**
 * Vector similarity search repository.
 * Handles embedding upserts and cosine-similarity lookups via pgvector.
 */
export interface VectorSearchRepo {
  upsertEmbedding(row: EmbeddingCreate): Promise<void>;
  searchByVector(
    queryVector: Float32Array,
    kbIds: string[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]>;
  deleteByPageId(pageId: string): Promise<void>;
  deleteByDocId(docId: string): Promise<void>;
}

/**
 * Full-text search repository.
 * Handles FTS vector updates and text-based search via zhparser/GIN index.
 */
export interface FTSSearchRepo {
  upsertFTSEntry(pageId: string, title: string, content: string): Promise<void>;
  searchByText(
    query: string,
    kbIds: string[],
    options: FTSSearchOptions,
  ): Promise<FTSSearchResult[]>;
  deleteByPageId(pageId: string): Promise<void>;
}

/**
 * Anchor repository.
 * Manages structural element anchors for documents.
 */
export interface AnchorRepo {
  batchInsert(anchors: AnchorDef[]): Promise<void>;
  getByDocId(docId: string): Promise<AnchorDef[]>;
  getById(id: string): Promise<AnchorDef | undefined>;
  getByStructurePageId(pageId: string): Promise<AnchorDef[]>;
  updateStructurePageId(anchorIds: string[], pageId: string): Promise<void>;
  deleteByDocId(docId: string): Promise<void>;
}

/**
 * Wiki page repository.
 * CRUD operations for wiki pages, abstracting filesystem and DB concerns.
 */
export interface WikiPageRepo {
  create(data: WikiPageCreate): Promise<WikiPage>;
  getById(id: string): Promise<WikiPage | undefined>;
  getByDocAndType(docId: string, pageType: string): Promise<WikiPage | undefined>;
  getByKbAndType(kbId: string, pageType?: string): Promise<WikiPage[]>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  updateContent(id: string, content: string, contentHash: string, tokenCount: number): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteByDocId(docId: string): Promise<void>;
}

/**
 * Document repository.
 * CRUD operations for document records.
 */
export interface DocumentRepo {
  getById(id: string): Promise<Document | undefined>;
  getByKbId(kbId: string): Promise<Document[]>;
  create(doc: Omit<Document, 'id' | 'created_at'>): Promise<Document>;
  updateStatus(id: string, status: string): Promise<void>;
  updateProcessing(id: string, step: string, progress: number, error?: string): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteByKbId(kbId: string): Promise<void>;
}

/**
 * Embedding repository.
 * Manages embedding rows with deduplication by page+model+chunk.
 */
export interface EmbeddingRepo {
  getOrNone(pageId: string, modelName: string, chunkIndex: number): Promise<EmbeddingRow | undefined>;
  upsert(row: EmbeddingCreate): Promise<void>;
  deleteByPageId(pageId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// RepoSet - Bundles all repositories behind a single interface
// ---------------------------------------------------------------------------

/** A complete set of repository instances for the application. */
export interface RepoSet {
  vectorSearch: VectorSearchRepo;
  ftsSearch: FTSSearchRepo;
  anchor: AnchorRepo;
  wikiPage: WikiPageRepo;
  document: DocumentRepo;
  embedding: EmbeddingRepo;
}
