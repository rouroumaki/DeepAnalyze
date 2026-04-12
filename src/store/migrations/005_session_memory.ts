// =============================================================================
// Migration 005: session_memory table
// =============================================================================
// Stores structured session memory notes extracted from conversations.
// Used by SessionMemoryManager for SM-compact and system prompt injection.
// =============================================================================

import type Database from "better-sqlite3";

export const migration = {
  version: 5,
  name: "session_memory",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_memory (
        id                    TEXT PRIMARY KEY,
        session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        content               TEXT NOT NULL,
        token_count           INTEGER NOT NULL DEFAULT 0,
        last_token_position   INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_memory_session
        ON session_memory(session_id);
    `);
  },
};
