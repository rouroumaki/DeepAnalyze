// =============================================================================
// Migration 008: Add stale column to embeddings table
// Used for marking embeddings as outdated when embedding model dimension changes.
// =============================================================================

import type Database from "better-sqlite3";

export const migration = {
  version: 8,
  name: "embedding_stale",

  up(db: Database.Database): void {
    const columns = db
      .prepare("PRAGMA table_info(embeddings)")
      .all() as Array<{ name: string }>;
    const hasStale = columns.some((c) => c.name === "stale");

    if (!hasStale) {
      db.exec(
        "ALTER TABLE embeddings ADD COLUMN stale INTEGER NOT NULL DEFAULT 0",
      );
      console.log("[Migration 008] Added stale column to embeddings");
    } else {
      console.log("[Migration 008] stale column already exists, skipping");
    }
  },
};
