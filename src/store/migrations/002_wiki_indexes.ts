// =============================================================================
// Migration 002: Wiki Indexes
// Adds additional indexes for wiki pages, wiki links, and tags to optimize
// common query patterns.
// =============================================================================

import type Database from "better-sqlite3";

export const migration = {
  version: 2,
  name: "wiki_indexes",

  up(db: Database.Database): void {
    db.exec(`
      -- Composite index for querying pages by KB and type together
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_kb_type
        ON wiki_pages(kb_id, page_type);

      -- Index for looking up links by entity name
      CREATE INDEX IF NOT EXISTS idx_wiki_links_entity
        ON wiki_links(entity_name);

      -- Index for tags by category (future use)
      CREATE INDEX IF NOT EXISTS idx_tags_name
        ON tags(name);
    `);
  },
};
