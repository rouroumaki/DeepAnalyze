// =============================================================================
// Migration 009: Add anchors table for SQLite
// Stores structural element anchors for documents (headings, tables, images, etc.)
// =============================================================================

import type Database from "better-sqlite3";

export const migration = {
  version: 9,
  name: "anchors",

  up(db: Database.Database): void {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='anchors'")
      .get() as { name: string } | undefined;

    if (!tables) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS anchors (
          id                TEXT PRIMARY KEY,
          doc_id            TEXT NOT NULL,
          kb_id             TEXT NOT NULL,
          element_type      TEXT NOT NULL,
          element_index     INTEGER NOT NULL,
          section_path      TEXT,
          section_title     TEXT,
          page_number       INTEGER,
          raw_json_path     TEXT,
          structure_page_id TEXT,
          content_preview   TEXT,
          content_hash      TEXT,
          metadata          TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_anchors_doc_id ON anchors(doc_id);
        CREATE INDEX IF NOT EXISTS idx_anchors_kb_id  ON anchors(kb_id);
        CREATE INDEX IF NOT EXISTS idx_anchors_structure ON anchors(structure_page_id);
        CREATE INDEX IF NOT EXISTS idx_anchors_type ON anchors(element_type);
      `);
      console.log("[Migration 009] Created anchors table");
    } else {
      console.log("[Migration 009] anchors table already exists, skipping");
    }
  },
};
