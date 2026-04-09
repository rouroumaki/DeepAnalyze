// =============================================================================
// DeepAnalyze - Session Store
// CRUD operations for chat sessions.
// =============================================================================

import { DB } from "./database.ts";
import type { Session } from "../types/index.ts";
import { randomUUID } from "crypto";

/**
 * Create a new chat session.
 * @param title  Optional title for the session.
 * @param kbScope Optional JSON object representing knowledge-base scope.
 */
export function createSession(
  title?: string,
  kbScope?: Record<string, unknown>,
): Session {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  const now = new Date().toISOString();
  const kbScopeStr = kbScope ? JSON.stringify(kbScope) : null;

  db.prepare(
    `INSERT INTO sessions (id, title, kb_scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, title ?? null, kbScopeStr, now, now);

  return {
    id,
    title: title ?? null,
    kbScope: kbScopeStr,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * List all sessions ordered by most recently updated first.
 */
export function listSessions(): Session[] {
  const db = DB.getInstance().raw;
  const rows = db
    .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
    .all() as Array<{
    id: string;
    title: string | null;
    kb_scope: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(rowToSession);
}

/**
 * Get a single session by id.
 */
export function getSession(id: string): Session | undefined {
  const db = DB.getInstance().raw;
  const row = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as
    | {
        id: string;
        title: string | null;
        kb_scope: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? rowToSession(row) : undefined;
}

/**
 * Delete a session by id.
 * @returns true if the session existed and was deleted.
 */
export function deleteSession(id: string): boolean {
  const db = DB.getInstance().raw;
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a raw database row (snake_case) to the Session interface (camelCase). */
function rowToSession(row: {
  id: string;
  title: string | null;
  kb_scope: string | null;
  created_at: string;
  updated_at: string;
}): Session {
  return {
    id: row.id,
    title: row.title,
    kbScope: row.kb_scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
