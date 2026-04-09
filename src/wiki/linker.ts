// =============================================================================
// DeepAnalyze - Wiki Linker
// Manages forward/backward links between wiki pages, including entity
// references and concept references. Supports BFS-based link traversal.
// =============================================================================

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { DB } from "../store/database.js";
import type { WikiLink, WikiPage, LinkType } from "../types/index.js";
import { getWikiPage, getPageContent, updateWikiPage } from "../store/wiki-pages.js";

// ---------------------------------------------------------------------------
// Row-to-object mapping
// ---------------------------------------------------------------------------

function rowToWikiLink(row: Record<string, unknown>): WikiLink {
  return {
    id: row.id as string,
    sourcePageId: row.source_page_id as string,
    targetPageId: row.target_page_id as string,
    linkType: row.link_type as LinkType,
    entityName: row.entity_name as string | null,
    context: row.context as string | null,
    createdAt: row.created_at as string,
  };
}

function rowToWikiPage(row: Record<string, unknown>): WikiPage {
  return {
    id: row.id as string,
    kbId: row.kb_id as string,
    docId: row.doc_id as string | null,
    pageType: row.page_type as WikiPage["pageType"],
    title: row.title as string,
    filePath: row.file_path as string,
    contentHash: row.content_hash as string,
    tokenCount: row.token_count as number,
    metadata: row.metadata as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Linked page result (includes distance from start)
// ---------------------------------------------------------------------------

export interface LinkedPageResult {
  page: WikiPage;
  distance: number;
  linkType: LinkType;
}

// ---------------------------------------------------------------------------
// Linker
// ---------------------------------------------------------------------------

export class Linker {
  // -----------------------------------------------------------------------
  // Link creation
  // -----------------------------------------------------------------------

  /**
   * Create a link between two pages.
   */
  createLink(
    sourcePageId: string,
    targetPageId: string,
    linkType: LinkType,
    entityName?: string,
    context?: string,
  ): WikiLink {
    const db = DB.getInstance().raw;

    // Check for duplicate link
    const existing = db
      .prepare(
        "SELECT id FROM wiki_links WHERE source_page_id = ? AND target_page_id = ? AND link_type = ?",
      )
      .get(sourcePageId, targetPageId, linkType) as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      // Return the existing link
      const row = db
        .prepare("SELECT * FROM wiki_links WHERE id = ?")
        .get(existing.id) as Record<string, unknown>;
      return rowToWikiLink(row);
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO wiki_links (id, source_page_id, target_page_id, link_type, entity_name, context)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      sourcePageId,
      targetPageId,
      linkType,
      entityName ?? null,
      context ?? null,
    );

    return {
      id,
      sourcePageId,
      targetPageId,
      linkType,
      entityName: entityName ?? null,
      context: context ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create bidirectional forward/backward links between two pages.
   * Returns a tuple of [forwardLink, backwardLink].
   */
  createBidirectionalLinks(
    pageA: string,
    pageB: string,
    entityName?: string,
    context?: string,
  ): [WikiLink, WikiLink] {
    const forward = this.createLink(pageA, pageB, "forward", entityName, context);
    const backward = this.createLink(pageB, pageA, "backward", entityName, context);
    return [forward, backward];
  }

  // -----------------------------------------------------------------------
  // Link retrieval
  // -----------------------------------------------------------------------

  /**
   * Get all outgoing links from a page.
   */
  getOutgoingLinks(pageId: string): WikiLink[] {
    const db = DB.getInstance().raw;
    const rows = db
      .prepare("SELECT * FROM wiki_links WHERE source_page_id = ?")
      .all(pageId) as Record<string, unknown>[];
    return rows.map(rowToWikiLink);
  }

  /**
   * Get all incoming links to a page.
   */
  getIncomingLinks(pageId: string): WikiLink[] {
    const db = DB.getInstance().raw;
    const rows = db
      .prepare("SELECT * FROM wiki_links WHERE target_page_id = ?")
      .all(pageId) as Record<string, unknown>[];
    return rows.map(rowToWikiLink);
  }

  /**
   * Get all linked pages within N hops using BFS traversal.
   * Returns pages with their distance from the start page and the link type.
   */
  getLinkedPages(
    startPageId: string,
    depth: number,
  ): LinkedPageResult[] {
    if (depth <= 0) return [];

    const db = DB.getInstance().raw;
    const visited = new Set<string>([startPageId]);
    const results: LinkedPageResult[] = [];
    const queue: Array<{ pageId: string; distance: number }> = [
      { pageId: startPageId, distance: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.distance >= depth) continue;

      // Get all links from the current page
      const links = db
        .prepare("SELECT * FROM wiki_links WHERE source_page_id = ?")
        .all(current.pageId) as Record<string, unknown>[];

      for (const linkRow of links) {
        const targetId = linkRow.target_page_id as string;
        const linkType = linkRow.link_type as LinkType;

        if (visited.has(targetId)) continue;
        visited.add(targetId);

        // Look up the target page
        const pageRow = db
          .prepare("SELECT * FROM wiki_pages WHERE id = ?")
          .get(targetId) as Record<string, unknown> | undefined;

        if (pageRow) {
          const page = rowToWikiPage(pageRow);
          results.push({
            page,
            distance: current.distance + 1,
            linkType,
          });

          // Enqueue for further traversal
          queue.push({
            pageId: targetId,
            distance: current.distance + 1,
          });
        }
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Link removal
  // -----------------------------------------------------------------------

  /**
   * Remove all links for a page (both incoming and outgoing).
   */
  removePageLinks(pageId: string): void {
    const db = DB.getInstance().raw;
    db.prepare(
      "DELETE FROM wiki_links WHERE source_page_id = ? OR target_page_id = ?",
    ).run(pageId, pageId);
  }

  // -----------------------------------------------------------------------
  // Entity-based discovery
  // -----------------------------------------------------------------------

  /**
   * Find all pages that reference a specific entity within a knowledge base.
   */
  findRelatedByEntity(kbId: string, entityName: string): WikiPage[] {
    const db = DB.getInstance().raw;

    // Find links with the given entity name, where the source page belongs to the kb
    const rows = db
      .prepare(
        `SELECT DISTINCT wp.*
         FROM wiki_pages wp
         JOIN wiki_links wl ON wl.source_page_id = wp.id
         WHERE wp.kb_id = ? AND wl.entity_name = ?`,
      )
      .all(kbId, entityName) as Record<string, unknown>[];

    return rows.map(rowToWikiPage);
  }

  // -----------------------------------------------------------------------
  // Forward link building
  // -----------------------------------------------------------------------

  /**
   * Build forward links between documents in a knowledge base based on
   * entity co-occurrence. Documents that share entities get linked.
   */
  buildForwardLinks(kbId: string): void {
    const db = DB.getInstance().raw;

    // Get all pages in the KB that have entity references
    const entityPages = db
      .prepare(
        `SELECT DISTINCT wl.source_page_id, wl.entity_name
         FROM wiki_links wl
         JOIN wiki_pages wp ON wp.id = wl.source_page_id
         WHERE wp.kb_id = ? AND wl.link_type = 'entity_ref'`,
      )
      .all(kbId) as Array<{ source_page_id: string; entity_name: string }>;

    // Group pages by shared entities
    const entityToPages = new Map<string, string[]>();
    for (const row of entityPages) {
      const pages = entityToPages.get(row.entity_name) ?? [];
      pages.push(row.source_page_id);
      entityToPages.set(row.entity_name, pages);
    }

    // For each entity shared by multiple pages, create forward links
    for (const [_entity, pages] of entityToPages) {
      if (pages.length < 2) continue;

      for (let i = 0; i < pages.length; i++) {
        for (let j = i + 1; j < pages.length; j++) {
          this.createBidirectionalLinks(pages[i], pages[j]);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // L1 Overview link updating
  // -----------------------------------------------------------------------

  /**
   * Update the L1 overview page for a document by appending a
   * "## Related Pages" section that lists outgoing and incoming links.
   * This keeps the overview page in sync with the link graph.
   */
  updateOverviewLinks(docId: string): void {
    // Find the overview page for this document
    const db = DB.getInstance().raw;
    const overviewRow = db
      .prepare(
        "SELECT * FROM wiki_pages WHERE doc_id = ? AND page_type = 'overview' LIMIT 1",
      )
      .get(docId) as Record<string, unknown> | undefined;

    if (!overviewRow) return;

    const overviewPage = rowToWikiPage(overviewRow);
    const pageId = overviewPage.id;

    // Get outgoing and incoming links
    const outgoing = this.getOutgoingLinks(pageId);
    const incoming = this.getIncomingLinks(pageId);

    if (outgoing.length === 0 && incoming.length === 0) return;

    // Read current overview content
    let content: string;
    try {
      content = getPageContent(overviewPage.filePath);
    } catch {
      return;
    }

    // Remove any existing "## Related Pages" section
    const marker = "## Related Pages";
    const markerIdx = content.indexOf(marker);
    if (markerIdx !== -1) {
      content = content.slice(0, markerIdx).trimEnd();
    }

    // Build the related pages section
    const lines: string[] = ["", "", marker, ""];

    if (outgoing.length > 0) {
      lines.push("### Outgoing References");
      for (const link of outgoing) {
        const targetPage = db
          .prepare("SELECT title, page_type FROM wiki_pages WHERE id = ?")
          .get(link.targetPageId) as { title: string; page_type: string } | undefined;
        if (targetPage) {
          const entityLabel = link.entityName ? ` (${link.entityName})` : "";
          lines.push(
            `- → [[${targetPage.title}]] (${targetPage.page_type})${entityLabel}`,
          );
        }
      }
      lines.push("");
    }

    if (incoming.length > 0) {
      lines.push("### Incoming References");
      for (const link of incoming) {
        const sourcePage = db
          .prepare("SELECT title, page_type FROM wiki_pages WHERE id = ?")
          .get(link.sourcePageId) as { title: string; page_type: string } | undefined;
        if (sourcePage) {
          const entityLabel = link.entityName ? ` (${link.entityName})` : "";
          lines.push(
            `- ← [[${sourcePage.title}]] (${sourcePage.page_type})${entityLabel}`,
          );
        }
      }
      lines.push("");
    }

    // Append the related pages section to the overview
    const updatedContent = content + lines.join("\n") + "\n";

    // Update the page content (filesystem + DB)
    updateWikiPage(pageId, updatedContent);
  }
}
