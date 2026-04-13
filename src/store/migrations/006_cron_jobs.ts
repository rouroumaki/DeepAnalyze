// =============================================================================
// Migration 006: cron_jobs table
// =============================================================================
// Stores scheduled tasks that execute periodically using cron expressions.
// =============================================================================

import type Database from "better-sqlite3";

export const migration = {
  version: 6,
  name: "cron_jobs",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        schedule          TEXT NOT NULL,
        message           TEXT NOT NULL,
        enabled           INTEGER NOT NULL DEFAULT 1,
        channel           TEXT DEFAULT NULL,
        chat_id           TEXT DEFAULT NULL,
        deliver_response  INTEGER NOT NULL DEFAULT 0,
        last_run          TEXT,
        next_run          TEXT,
        last_status       TEXT,
        last_error        TEXT,
        run_count         INTEGER NOT NULL DEFAULT 0,
        error_count       INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run);
    `);
  },
};
