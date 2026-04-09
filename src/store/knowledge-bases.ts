// =============================================================================
// DeepAnalyze - Knowledge Base Data Operations
// CRUD operations for knowledge_base records in the SQLite database.
// =============================================================================

import { DB } from "./database.js";
import type { KnowledgeBase } from "../types/index.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Row-to-object mapping (snake_case DB -> camelCase JS)
// ---------------------------------------------------------------------------

function rowToKnowledgeBase(row: Record<string, unknown>): KnowledgeBase {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    ownerId: row.owner_id as string,
    visibility: row.visibility as KnowledgeBase["visibility"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new knowledge base.
 */
export function createKnowledgeBase(
  name: string,
  ownerId: string,
  description?: string,
  visibility?: KnowledgeBase["visibility"],
): KnowledgeBase {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO knowledge_bases (id, name, description, owner_id, visibility)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, description ?? null, ownerId, visibility ?? "private");

  return {
    id,
    name,
    description: description ?? null,
    ownerId,
    visibility: visibility ?? "private",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get a knowledge base by ID.
 */
export function getKnowledgeBase(id: string): KnowledgeBase | undefined {
  const db = DB.getInstance().raw;
  const row = db
    .prepare("SELECT * FROM knowledge_bases WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToKnowledgeBase(row) : undefined;
}

/**
 * List all knowledge bases.
 */
export function listKnowledgeBases(): KnowledgeBase[] {
  const db = DB.getInstance().raw;
  const rows = db
    .prepare("SELECT * FROM knowledge_bases ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToKnowledgeBase);
}

/**
 * Update a knowledge base. Only the provided fields will be changed.
 */
export function updateKnowledgeBase(
  id: string,
  updates: {
    name?: string;
    description?: string;
    visibility?: KnowledgeBase["visibility"];
  },
): KnowledgeBase | undefined {
  const db = DB.getInstance().raw;

  // Build SET clause dynamically from provided fields
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    setClauses.push("description = ?");
    values.push(updates.description);
  }
  if (updates.visibility !== undefined) {
    setClauses.push("visibility = ?");
    values.push(updates.visibility);
  }

  if (setClauses.length === 0) {
    return getKnowledgeBase(id);
  }

  // Always update the timestamp
  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  const stmt = `UPDATE knowledge_bases SET ${setClauses.join(", ")} WHERE id = ?`;
  const result = db.prepare(stmt).run(...values);

  if (result.changes === 0) {
    return undefined;
  }

  return getKnowledgeBase(id);
}

/**
 * Delete a knowledge base and all associated data.
 * The ON DELETE CASCADE foreign key constraint will remove related documents,
 * wiki pages, and wiki links automatically.
 */
export function deleteKnowledgeBase(id: string): boolean {
  const db = DB.getInstance().raw;
  const result = db.prepare("DELETE FROM knowledge_bases WHERE id = ?").run(id);
  return result.changes > 0;
}
