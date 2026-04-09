// =============================================================================
// DeepAnalyze - Fusion Retrieval Engine
// Combines vector similarity search, BM25 full-text search, and link traversal
// using Reciprocal Rank Fusion (RRF) for unified result ranking.
// =============================================================================

import { DB } from "../store/database.js";
import { getWikiPage, getPageContent } from "../store/wiki-pages.js";
import type { WikiPage } from "../types/index.js";
import type { EmbeddingManager } from "../models/embedding.js";
import type { Indexer } from "./indexer.js";
import type { Linker } from "./linker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single search result from any retrieval method. */
export interface SearchResult {
  pageId: string;
  kbId: string;
  docId: string | null;
  pageType: string;
  title: string;
  score: number;
  /** Relevant text excerpt. */
  snippet: string;
  /** Which retrieval method produced this result. */
  source: "vector" | "bm25" | "linked" | "fusion";
}

/** Options for configuring a search query. */
export interface SearchOptions {
  /** Knowledge base IDs to search within. */
  kbIds: string[];
  /** Maximum number of results to return (default 10). */
  topK?: number;
  /** Page ID to start link traversal from (adds linked results). */
  linkedFrom?: string;
  /** Filter results to specific page types. */
  pageTypes?: string[];
  /** Minimum score threshold (0-1 scale). */
  minScore?: number;
}

// ---------------------------------------------------------------------------
// Retriever
// ---------------------------------------------------------------------------

export class Retriever {
  private indexer: Indexer;
  private linker: Linker;
  private embeddingManager: EmbeddingManager;

  constructor(
    indexer: Indexer,
    linker: Linker,
    embeddingManager: EmbeddingManager,
  ) {
    this.indexer = indexer;
    this.linker = linker;
    this.embeddingManager = embeddingManager;
  }

  // -----------------------------------------------------------------------
  // Vector similarity search
  // -----------------------------------------------------------------------

  /**
   * Search using vector embedding similarity.
   * Embeds the query, loads all relevant embeddings from the DB,
   * computes cosine similarity, and returns topK results.
   */
  async vectorSearch(
    query: string,
    kbIds: string[],
    topK: number,
  ): Promise<SearchResult[]> {
    if (kbIds.length === 0) return [];

    // Embed the query
    const queryResult = await this.embeddingManager.embed(query);
    const queryVec = queryResult.embedding;

    const db = DB.getInstance().raw;

    // Build query to get all embeddings for pages in the specified KBs
    const placeholders = kbIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT e.id, e.page_id, e.model_name, e.vector, e.text_chunk,
                wp.kb_id, wp.doc_id, wp.page_type, wp.title, wp.file_path
         FROM embeddings e
         JOIN wiki_pages wp ON wp.id = e.page_id
         WHERE wp.kb_id IN (${placeholders})
         ORDER BY e.page_id, e.chunk_index`,
      )
      .all(...kbIds) as Record<string, unknown>[];

    if (rows.length === 0) return [];

    // Compute similarity for each embedding
    const scored: Array<{
      pageId: string;
      kbId: string;
      docId: string | null;
      pageType: string;
      title: string;
      score: number;
      textChunk: string;
    }> = [];

    for (const row of rows) {
      const blob = row.vector as Buffer;
      const vec = new Float32Array(
        blob.buffer,
        blob.byteOffset,
        blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );

      const similarity = this.indexer.cosineSimilarity(queryVec, vec);

      scored.push({
        pageId: row.page_id as string,
        kbId: row.kb_id as string,
        docId: row.doc_id as string | null,
        pageType: row.page_type as string,
        title: row.title as string,
        score: similarity,
        textChunk: row.text_chunk as string,
      });
    }

    // Sort by score descending and take topK
    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK);

    return topResults.map((r) => ({
      pageId: r.pageId,
      kbId: r.kbId,
      docId: r.docId,
      pageType: r.pageType,
      title: r.title,
      score: r.score,
      snippet: this.extractSnippet(r.textChunk, query),
      source: "vector" as const,
    }));
  }

  // -----------------------------------------------------------------------
  // BM25 full-text search (FTS5)
  // -----------------------------------------------------------------------

  /**
   * Search using BM25 ranking via SQLite FTS5.
   * Falls back to LIKE-based matching when FTS5 is unavailable.
   */
  async bm25Search(
    query: string,
    kbIds: string[],
    topK: number,
  ): Promise<SearchResult[]> {
    if (kbIds.length === 0) return [];

    const db = DB.getInstance().raw;

    try {
      return await this.fts5Search(db, query, kbIds, topK);
    } catch {
      // FTS5 may not be properly configured or the query syntax may be invalid.
      // Fall back to simple LIKE-based search.
      return this.likeSearch(db, query, kbIds, topK);
    }
  }

  /**
   * FTS5-based BM25 search.
   */
  private async fts5Search(
    db: import("better-sqlite3").Database,
    query: string,
    kbIds: string[],
    topK: number,
  ): Promise<SearchResult[]> {
    // Sanitize query for FTS5 MATCH (remove special operators)
    const ftsQuery = query
      .replace(/[*"'():^|]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .join(" OR ");

    if (!ftsQuery) return [];

    const placeholders = kbIds.map(() => "?").join(", ");

    const rows = db
      .prepare(
        `SELECT wp.id, wp.kb_id, wp.doc_id, wp.page_type, wp.title, wp.file_path,
                fts.rank as bm25_score
         FROM wiki_pages wp
         JOIN fts_content fts ON wp.rowid = fts.rowid
         WHERE fts MATCH ?
           AND wp.kb_id IN (${placeholders})
         ORDER BY bm25_score
         LIMIT ?`,
      )
      .all(ftsQuery, ...kbIds, topK) as Record<string, unknown>[];

    return rows.map((row) => {
      const bm25Score = row.bm25_score as number;
      // Normalize BM25 score to 0-1 range (BM25 scores are negative in FTS5)
      const normalizedScore = Math.max(0, Math.min(1, 1 / (1 + Math.exp(bm25Score))));

      let snippet = "";
      try {
        const content = getPageContent(row.file_path as string);
        snippet = this.extractSnippet(content, query);
      } catch {
        snippet = "";
      }

      return {
        pageId: row.id as string,
        kbId: row.kb_id as string,
        docId: row.doc_id as string | null,
        pageType: row.page_type as string,
        title: row.title as string,
        score: normalizedScore,
        snippet,
        source: "bm25" as const,
      };
    });
  }

  /**
   * LIKE-based fallback when FTS5 is unavailable.
   */
  private async likeSearch(
    db: import("better-sqlite3").Database,
    query: string,
    kbIds: string[],
    topK: number,
  ): Promise<SearchResult[]> {
    const placeholders = kbIds.map(() => "?").join(", ");
    const likePattern = `%${query}%`;

    const rows = db
      .prepare(
        `SELECT id, kb_id, doc_id, page_type, title, file_path
         FROM wiki_pages
         WHERE kb_id IN (${placeholders})
           AND (title LIKE ? OR file_path LIKE ?)
         LIMIT ?`,
      )
      .all(...kbIds, likePattern, likePattern, topK) as Record<string, unknown>[];

    // Also try to match page content by reading files and checking
    const allPages = db
      .prepare(
        `SELECT id, kb_id, doc_id, page_type, title, file_path
         FROM wiki_pages
         WHERE kb_id IN (${placeholders})`,
      )
      .all(...kbIds) as Record<string, unknown>[];

    const matchedPages: Array<{
      row: Record<string, unknown>;
      score: number;
      snippet: string;
    }> = [];

    // First add title matches from the initial query
    for (const row of rows) {
      matchedPages.push({
        row,
        score: 0.8,
        snippet: (row.title as string).substring(0, 200),
      });
    }

    // Check content for matches (limit to avoid excessive I/O)
    const existingIds = new Set(rows.map((r) => r.id as string));
    for (const row of allPages) {
      if (existingIds.has(row.id as string)) continue;

      try {
        const content = getPageContent(row.file_path as string);
        if (content.toLowerCase().includes(query.toLowerCase())) {
          matchedPages.push({
            row,
            score: 0.5,
            snippet: this.extractSnippet(content, query),
          });
        }
      } catch {
        // Skip pages whose files can't be read
      }

      if (matchedPages.length >= topK * 2) break;
    }

    // Sort by score and take topK
    matchedPages.sort((a, b) => b.score - a.score);
    const topResults = matchedPages.slice(0, topK);

    return topResults.map((m) => ({
      pageId: m.row.id as string,
      kbId: m.row.kb_id as string,
      docId: m.row.doc_id as string | null,
      pageType: m.row.page_type as string,
      title: m.row.title as string,
      score: m.score,
      snippet: m.snippet,
      source: "bm25" as const,
    }));
  }

  // -----------------------------------------------------------------------
  // Link-based traversal search
  // -----------------------------------------------------------------------

  /**
   * Search by traversing links from a starting page.
   * Returns pages reachable within the given depth, scored by distance.
   */
  async linkedSearch(
    startPageId: string,
    depth: number = 2,
  ): Promise<SearchResult[]> {
    const linkedPages = this.linker.getLinkedPages(startPageId, depth);

    return linkedPages.map((lp) => {
      // Score decreases with distance (1/distance)
      const score = 1 / lp.distance;

      let snippet = "";
      try {
        const content = getPageContent(lp.page.filePath);
        snippet = content.substring(0, 200);
      } catch {
        snippet = "";
      }

      return {
        pageId: lp.page.id,
        kbId: lp.page.kbId,
        docId: lp.page.docId,
        pageType: lp.page.pageType,
        title: lp.page.title,
        score,
        snippet,
        source: "linked" as const,
      };
    });
  }

  // -----------------------------------------------------------------------
  // Reciprocal Rank Fusion (RRF)
  // -----------------------------------------------------------------------

  /**
   * Merge multiple result sets using Reciprocal Rank Fusion.
   *
   * RRF score for a document = sum over all result sets of:
   *   1 / (k + rank_in_set)
   *
   * @param resultSets - Array of ranked result arrays
   * @param k - RRF constant (default 60)
   */
  rrfMerge(resultSets: SearchResult[][], k: number = 60): SearchResult[] {
    // Map pageId -> accumulated RRF score and best metadata
    const pageScores = new Map<
      string,
      {
        score: number;
        result: SearchResult;
      }
    >();

    for (const results of resultSets) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const rrfContribution = 1 / (k + rank + 1);

        const existing = pageScores.get(result.pageId);
        if (existing) {
          existing.score += rrfContribution;
          // Keep the better snippet
          if (result.snippet.length > existing.result.snippet.length) {
            existing.result = {
              ...existing.result,
              snippet: result.snippet,
            };
          }
        } else {
          pageScores.set(result.pageId, {
            score: rrfContribution,
            result: { ...result },
          });
        }
      }
    }

    // Convert to array, set fusion source and score, sort
    const merged = Array.from(pageScores.entries()).map(
      ([_pageId, { score, result }]) => ({
        ...result,
        score,
        source: "fusion" as const,
      }),
    );

    merged.sort((a, b) => b.score - a.score);
    return merged;
  }

  // -----------------------------------------------------------------------
  // Unified search entry point
  // -----------------------------------------------------------------------

  /**
   * Main search method combining all retrieval strategies.
   *
   * 1. Runs vector similarity search
   * 2. Runs BM25 full-text search
   * 3. Optionally runs link traversal from a starting page
   * 4. Merges all results using RRF
   * 5. Applies filters and returns top results
   */
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const { kbIds, topK = 10, linkedFrom, pageTypes, minScore } = options;

    const resultSets: SearchResult[][] = [];

    // Run vector search
    try {
      const vectorResults = await this.vectorSearch(query, kbIds, topK);
      if (vectorResults.length > 0) {
        resultSets.push(vectorResults);
      }
    } catch (err) {
      console.warn(
        `[Retriever] Vector search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Run BM25 search
    try {
      const bm25Results = await this.bm25Search(query, kbIds, topK);
      if (bm25Results.length > 0) {
        resultSets.push(bm25Results);
      }
    } catch (err) {
      console.warn(
        `[Retriever] BM25 search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Run linked search if a starting page is specified
    if (linkedFrom) {
      try {
        const linkedResults = await this.linkedSearch(linkedFrom, 2);
        if (linkedResults.length > 0) {
          resultSets.push(linkedResults);
        }
      } catch (err) {
        console.warn(
          `[Retriever] Linked search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // If only one result set, return it directly (no need for RRF)
    let finalResults: SearchResult[];
    if (resultSets.length === 0) {
      finalResults = [];
    } else if (resultSets.length === 1) {
      finalResults = resultSets[0];
    } else {
      // Merge with RRF
      finalResults = this.rrfMerge(resultSets);
    }

    // Apply page type filter
    if (pageTypes && pageTypes.length > 0) {
      finalResults = finalResults.filter((r) =>
        pageTypes.includes(r.pageType),
      );
    }

    // Apply minimum score filter
    if (minScore !== undefined) {
      finalResults = finalResults.filter((r) => r.score >= minScore);
    }

    // Limit to topK
    return finalResults.slice(0, topK);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Extract a short snippet from text around the query match.
   */
  private extractSnippet(text: string, query: string, maxLen: number = 200): string {
    if (!text) return "";
    if (!query) return text.substring(0, maxLen);

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery.split(/\s+/)[0] ?? lowerQuery);

    if (idx === -1) {
      return text.substring(0, maxLen);
    }

    // Extract context around the match
    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + query.length + 100);
    let snippet = text.substring(start, end);

    if (start > 0) snippet = "..." + snippet;
    if (end < text.length) snippet = snippet + "...";

    return snippet;
  }
}
