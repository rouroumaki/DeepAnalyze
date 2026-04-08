// =============================================================================
// Migration 001: Initial schema
// Creates all core tables, indexes, and FTS5 virtual table.
// =============================================================================

import type Database from 'better-sqlite3';

export const migration = {
  version: 1,
  name: 'init',

  up(db: Database.Database): void {
    db.exec(`
      -- Migration tracking is handled by the Database class via _migrations table.

      -- ============================================================
      -- Knowledge Bases
      -- ============================================================
      CREATE TABLE IF NOT EXISTS knowledge_bases (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        owner_id    TEXT NOT NULL,
        visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'public')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Documents
      -- ============================================================
      CREATE TABLE IF NOT EXISTS documents (
        id          TEXT PRIMARY KEY,
        kb_id       TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        filename    TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        file_hash   TEXT NOT NULL,
        file_size   INTEGER NOT NULL DEFAULT 0,
        file_type   TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'compiling', 'ready', 'error')),
        metadata    TEXT, -- JSON blob
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Wiki Pages
      -- ============================================================
      CREATE TABLE IF NOT EXISTS wiki_pages (
        id            TEXT PRIMARY KEY,
        kb_id         TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        doc_id        TEXT REFERENCES documents(id) ON DELETE SET NULL,
        page_type     TEXT NOT NULL CHECK (page_type IN ('abstract', 'overview', 'fulltext', 'entity', 'concept', 'report')),
        title         TEXT NOT NULL,
        file_path     TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        token_count   INTEGER NOT NULL DEFAULT 0,
        metadata      TEXT, -- JSON blob
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Wiki Links
      -- ============================================================
      CREATE TABLE IF NOT EXISTS wiki_links (
        id              TEXT PRIMARY KEY,
        source_page_id  TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        target_page_id  TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        link_type       TEXT NOT NULL CHECK (link_type IN ('forward', 'backward', 'entity_ref', 'concept_ref')),
        entity_name     TEXT,
        context         TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Tags
      -- ============================================================
      CREATE TABLE IF NOT EXISTS tags (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color TEXT
      );

      CREATE TABLE IF NOT EXISTS document_tags (
        document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag_id       TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (document_id, tag_id)
      );

      -- ============================================================
      -- Full-Text Search (FTS5)
      -- ============================================================
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
        title,
        content,
        content='wiki_pages',
        content_rowid='rowid',
        tokenize='unicode61'
      );

      -- ============================================================
      -- Sessions (Chat)
      -- ============================================================
      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        title       TEXT,
        kb_scope    TEXT, -- JSON array of knowledge base IDs
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Messages
      -- ============================================================
      CREATE TABLE IF NOT EXISTS messages (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        content     TEXT NOT NULL DEFAULT '',
        metadata    TEXT, -- JSON blob
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Users
      -- ============================================================
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Audit Log
      -- ============================================================
      CREATE TABLE IF NOT EXISTS audit_log (
        id          TEXT PRIMARY KEY,
        user_id     TEXT,
        action      TEXT NOT NULL,
        resource    TEXT,
        details     TEXT, -- JSON blob
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Agent Tasks
      -- ============================================================
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id              TEXT PRIMARY KEY,
        parent_task_id  TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
        session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        agent_type      TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        input           TEXT, -- JSON blob
        output          TEXT, -- JSON blob
        error           TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at    TEXT
      );

      -- ============================================================
      -- Plugins
      -- ============================================================
      CREATE TABLE IF NOT EXISTS plugins (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        version     TEXT NOT NULL DEFAULT '0.0.1',
        enabled     INTEGER NOT NULL DEFAULT 1,
        config      TEXT, -- JSON blob
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Skills
      -- ============================================================
      CREATE TABLE IF NOT EXISTS skills (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        plugin_id   TEXT REFERENCES plugins(id) ON DELETE CASCADE,
        description TEXT,
        config      TEXT, -- JSON blob
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ============================================================
      -- Settings (key-value store)
      -- ============================================================
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- ============================================================
      -- Indexes
      -- ============================================================
      CREATE INDEX IF NOT EXISTS idx_documents_kb_id     ON documents(kb_id);
      CREATE INDEX IF NOT EXISTS idx_documents_status    ON documents(status);
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_kb_id    ON wiki_pages(kb_id);
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_page_type ON wiki_pages(page_type);
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_doc_id   ON wiki_pages(doc_id);
      CREATE INDEX IF NOT EXISTS idx_wiki_links_source   ON wiki_links(source_page_id);
      CREATE INDEX IF NOT EXISTS idx_wiki_links_target   ON wiki_links(target_page_id);
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_status  ON agent_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id);
    `);
  },
};
