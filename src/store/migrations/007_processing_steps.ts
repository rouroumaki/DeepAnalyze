// =============================================================================
// Migration 007: Add processing step tracking columns to documents
// =============================================================================
// Adds processing_step, processing_progress, and processing_error columns
// to the documents table for granular pipeline tracking.
// Also seeds auto_process and processing_concurrency settings.
// =============================================================================

import type Database from "better-sqlite3";

export const migration = {
  version: 7,
  name: "processing_steps",

  up(db: Database.Database): void {
    // Check which columns already exist on the documents table
    const columns = db
      .prepare("PRAGMA table_info(documents)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    // Add processing_step column if missing
    if (!columnNames.has("processing_step")) {
      db.exec(
        "ALTER TABLE documents ADD COLUMN processing_step TEXT DEFAULT NULL"
      );
      console.log("[Migration 007] Added processing_step column to documents");
    }

    // Add processing_progress column if missing
    if (!columnNames.has("processing_progress")) {
      db.exec(
        "ALTER TABLE documents ADD COLUMN processing_progress REAL DEFAULT 0.0"
      );
      console.log("[Migration 007] Added processing_progress column to documents");
    }

    // Add processing_error column if missing
    if (!columnNames.has("processing_error")) {
      db.exec(
        "ALTER TABLE documents ADD COLUMN processing_error TEXT DEFAULT NULL"
      );
      console.log("[Migration 007] Added processing_error column to documents");
    }

    // Insert default processing settings
    db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_process', ?)"
    ).run("true");

    db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('processing_concurrency', ?)"
    ).run("1");

    console.log("[Migration 007] Processing steps migration applied");
  },
};
