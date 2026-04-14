// =============================================================================
// DeepAnalyze - Report Data Operations
// CRUD operations for reports and report references in the SQLite database.
// =============================================================================

import { DB } from "./database.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Report {
  id: string;
  sessionId: string;
  messageId: string;
  title: string;
  cleanContent: string;
  rawContent: string;
  entities: string[];
  createdAt: string;
}

export interface ReportReference {
  id: number;
  reportId: string;
  refIndex: number;
  docId: string;
  pageId: string;
  title: string;
  level: "L0" | "L1" | "L2";
  snippet: string;
  highlight: string;
}

export interface ReportWithReferences extends Report {
  references: ReportReference[];
}

export interface CreateReportData {
  sessionId: string;
  messageId: string;
  title: string;
  cleanContent: string;
  rawContent: string;
  entities?: string[];
  references?: Omit<ReportReference, "id" | "reportId">[];
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * Run schema migration for reports and report_references tables.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function migrateReports(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      message_id    TEXT NOT NULL,
      title         TEXT NOT NULL,
      clean_content TEXT NOT NULL,
      raw_content   TEXT NOT NULL,
      entities      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS report_references (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id  TEXT NOT NULL,
      ref_index  INTEGER NOT NULL,
      doc_id     TEXT NOT NULL,
      page_id    TEXT NOT NULL,
      title      TEXT NOT NULL,
      level      TEXT NOT NULL CHECK(level IN ('L0', 'L1', 'L2')),
      snippet    TEXT NOT NULL,
      highlight  TEXT NOT NULL,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reports_session    ON reports(session_id);
    CREATE INDEX IF NOT EXISTS idx_reports_message    ON reports(message_id);
    CREATE INDEX IF NOT EXISTS idx_report_refs_report ON report_references(report_id);
  `);
}

// ---------------------------------------------------------------------------
// Row-to-object mapping (snake_case DB -> camelCase JS)
// ---------------------------------------------------------------------------

function rowToReport(row: Record<string, unknown>): Report {
  let entities: string[] = [];
  if (row.entities) {
    try {
      const parsed = JSON.parse(row.entities as string);
      entities = Array.isArray(parsed) ? parsed : [];
    } catch {
      entities = [];
    }
  }

  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    messageId: row.message_id as string,
    title: row.title as string,
    cleanContent: row.clean_content as string,
    rawContent: row.raw_content as string,
    entities,
    createdAt: row.created_at as string,
  };
}

function rowToReportReference(row: Record<string, unknown>): ReportReference {
  return {
    id: row.id as number,
    reportId: row.report_id as string,
    refIndex: row.ref_index as number,
    docId: row.doc_id as string,
    pageId: row.page_id as string,
    title: row.title as string,
    level: row.level as "L0" | "L1" | "L2",
    snippet: row.snippet as string,
    highlight: row.highlight as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new report with optional references.
 * Inserts the report row and all associated reference rows in a single transaction.
 */
export function createReport(data: CreateReportData): ReportWithReferences {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  const entitiesJson = data.entities ? JSON.stringify(data.entities) : null;

  const insertReport = db.prepare(
    `INSERT INTO reports (id, session_id, message_id, title, clean_content, raw_content, entities)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertRef = db.prepare(
    `INSERT INTO report_references (report_id, ref_index, doc_id, page_id, title, level, snippet, highlight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const doInsert = db.transaction(() => {
    insertReport.run(
      id,
      data.sessionId,
      data.messageId,
      data.title,
      data.cleanContent,
      data.rawContent,
      entitiesJson,
    );

    const refs: ReportReference[] = [];

    if (data.references && data.references.length > 0) {
      for (const ref of data.references) {
        const result = insertRef.run(
          id,
          ref.refIndex,
          ref.docId,
          ref.pageId,
          ref.title,
          ref.level,
          ref.snippet,
          ref.highlight,
        );
        refs.push({
          id: result.lastInsertRowid as number,
          reportId: id,
          refIndex: ref.refIndex,
          docId: ref.docId,
          pageId: ref.pageId,
          title: ref.title,
          level: ref.level,
          snippet: ref.snippet,
          highlight: ref.highlight,
        });
      }
    }

    return refs;
  });

  const references = doInsert();

  // Fetch the created row to get the server-generated created_at
  const row = db
    .prepare("SELECT * FROM reports WHERE id = ?")
    .get(id) as Record<string, unknown>;

  const report = rowToReport(row);

  return { ...report, references };
}

/**
 * Get a single report by ID, including all its references.
 */
export function getReport(reportId: string): ReportWithReferences | undefined {
  const db = DB.getInstance().raw;

  const row = db
    .prepare("SELECT * FROM reports WHERE id = ?")
    .get(reportId) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  const report = rowToReport(row);

  const refRows = db
    .prepare("SELECT * FROM report_references WHERE report_id = ? ORDER BY ref_index")
    .all(reportId) as Record<string, unknown>[];

  const references = refRows.map(rowToReportReference);

  return { ...report, references };
}

/**
 * Look up a report by the message ID it is associated with.
 */
export function getReportByMessageId(messageId: string): ReportWithReferences | undefined {
  const db = DB.getInstance().raw;

  const row = db
    .prepare("SELECT * FROM reports WHERE message_id = ?")
    .get(messageId) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  const report = rowToReport(row);

  const refRows = db
    .prepare("SELECT * FROM report_references WHERE report_id = ? ORDER BY ref_index")
    .all(report.id) as Record<string, unknown>[];

  const references = refRows.map(rowToReportReference);

  return { ...report, references };
}

/**
 * List reports with pagination, ordered by most recent first.
 */
export function listReports(limit: number = 20, offset: number = 0): Report[] {
  const db = DB.getInstance().raw;

  const rows = db
    .prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as Record<string, unknown>[];

  return rows.map(rowToReport);
}

/**
 * Get all reports for a given session, ordered by most recent first.
 */
export function getReportsBySession(sessionId: string): Report[] {
  const db = DB.getInstance().raw;

  const rows = db
    .prepare("SELECT * FROM reports WHERE session_id = ? ORDER BY created_at DESC")
    .all(sessionId) as Record<string, unknown>[];

  return rows.map(rowToReport);
}

/**
 * Delete a report and all its associated references.
 * The CASCADE foreign key on report_references handles cleanup automatically.
 */
export function deleteReport(reportId: string): boolean {
  const db = DB.getInstance().raw;

  const result = db.prepare("DELETE FROM reports WHERE id = ?").run(reportId);
  return result.changes > 0;
}
