// =============================================================================
// DeepAnalyze - Message Store
// CRUD operations for chat messages within sessions.
// =============================================================================

import { DB } from "./database.ts";
import type { Message, MessageRole } from "../types/index.ts";
import { randomUUID } from "crypto";

/**
 * Create a new message in a session.
 * Also bumps the session's `updated_at` timestamp so the session sorts to the top.
 *
 * @param sessionId  The parent session id.
 * @param role       Who sent the message (user | assistant | tool).
 * @param content    The text content (may be null for tool messages).
 * @param metadata   Optional arbitrary JSON metadata.
 */
export function createMessage(
  sessionId: string,
  role: MessageRole,
  content: string | null,
  metadata?: Record<string, unknown>,
): Message {
  const db = DB.getInstance().raw;

  const id = randomUUID();
  const now = new Date().toISOString();
  const metadataStr = metadata ? JSON.stringify(metadata) : null;

  // Use a transaction so the message insert + session bump are atomic
  const insertAndBump = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, sessionId, role, content ?? "", metadataStr, now);

    db.prepare(
      `UPDATE sessions SET updated_at = ? WHERE id = ?`,
    ).run(now, sessionId);
  });

  insertAndBump();

  return {
    id,
    sessionId,
    role,
    content: content ?? "",
    metadata: metadataStr,
    createdAt: now,
  };
}

/**
 * Get all messages for a session, ordered chronologically.
 */
export function getMessages(sessionId: string): Message[] {
  const db = DB.getInstance().raw;
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as Array<{
    id: string;
    session_id: string;
    role: MessageRole;
    content: string;
    metadata: string | null;
    created_at: string;
  }>;

  return rows.map(rowToMessage);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a raw database row (snake_case) to the Message interface (camelCase). */
function rowToMessage(row: {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  metadata: string | null;
  created_at: string;
}): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}
