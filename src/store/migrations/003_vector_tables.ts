// =============================================================================
// Migration 003: Vector Tables
// Adds embedding storage for vector similarity search and a search cache table.
// =============================================================================

import type Database from "better-sqlite3";

export const migration = {
  version: 3,
  name: "vector_tables",

  up(db: Database.Database): void {
    db.exec(`
      -- Embeddings storage (serialized Float32 vectors as BLOB)
      CREATE TABLE IF NOT EXISTS embeddings (
        id          TEXT PRIMARY KEY,
        page_id     TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        model_name  TEXT NOT NULL,
        dimension   INTEGER NOT NULL,
        vector      BLOB NOT NULL,
        text_chunk  TEXT,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_embeddings_page_id ON embeddings(page_id);
      CREATE INDEX IF NOT EXISTS idx_embeddings_model    ON embeddings(model_name);

      -- Search results cache (for performance, stores query results)
      CREATE TABLE IF NOT EXISTS search_cache (
        id          TEXT PRIMARY KEY,
        query_hash  TEXT NOT NULL,
        kb_ids      TEXT NOT NULL,
        results     TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_search_cache_query ON search_cache(query_hash);
    `);
  },
};
