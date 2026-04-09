// =============================================================================
// DeepAnalyze - SQLite Database Layer
// Uses better-sqlite3 with WAL mode, foreign keys, and migration tracking.
// =============================================================================

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Import all migrations
import { migration as m001_init } from './migrations/001_init.ts';
import { migration as m002_wiki_indexes } from './migrations/002_wiki_indexes.ts';

/** Ordered list of migrations */
const MIGRATIONS = [
  m001_init,
  m002_wiki_indexes,
] as const;

// ---------------------------------------------------------------------------
// Database singleton
// ---------------------------------------------------------------------------

export class DB {
  private static instance: DB | null = null;
  private readonly db: Database.Database;

  private constructor(dbPath: string) {
    // Ensure parent directory exists
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    // Enable foreign key enforcement
    this.db.pragma('foreign_keys = ON');

    // Ensure _migrations tracking table exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name    TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** Get or create the singleton instance */
  static getInstance(dbPath?: string): DB {
    if (!DB.instance) {
      const resolved = dbPath ?? 'data/deepanalyze.db';
      DB.instance = new DB(resolved);
    }
    return DB.instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    if (DB.instance) {
      DB.instance.close();
      DB.instance = null;
    }
  }

  /** Run all pending migrations in order */
  migrate(): void {
    const applied = new Set<number>();
    const rows = this.db.prepare('SELECT version FROM _migrations').all() as Array<{ version: number }>;
    for (const row of rows) {
      applied.add(row.version);
    }

    for (const m of MIGRATIONS) {
      if (!applied.has(m.version)) {
        console.log(`[DB] Running migration ${m.version}: ${m.name}`);
        // Run inside a transaction for safety
        this.db.transaction(() => {
          m.up(this.db);
          this.db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
        })();
        console.log(`[DB] Migration ${m.version}: ${m.name} applied`);
      }
    }
  }

  /** Access the raw better-sqlite3 database */
  get raw(): Database.Database {
    return this.db;
  }

  /** Close the database connection */
  close(): void {
    try {
      this.db.close();
      console.log('[DB] Connection closed');
    } catch {
      // Already closed or never opened — ignore
    }
    DB.instance = null;
  }
}
