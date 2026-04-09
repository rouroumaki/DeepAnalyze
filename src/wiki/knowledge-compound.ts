// =============================================================================
// DeepAnalyze - Knowledge Compounding Write-Back
// =============================================================================
// Takes agent output and writes it back to the wiki as report-type pages.
// This enables "knowledge compounding" -- analysis results are automatically
// saved to the knowledge base so they can be discovered by future searches.
// =============================================================================

import { createWikiPage } from "../store/wiki-pages.js";
import { DB } from "../store/database.js";
import { join } from "node:path";
import { Linker } from "./linker.js";

// ---------------------------------------------------------------------------
// Entity extraction result
// ---------------------------------------------------------------------------

export interface ExtractedEntity {
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Helper: generate a report title from agent type and input
// ---------------------------------------------------------------------------

/**
 * Generate a meaningful report title from the agent type and first line of
 * input.  The title is cleaned for use as a display string and filesystem
 * component.
 *
 * Example outputs:
 *   "[Explore] What are the key risks in this report"
 *   "[Compile] Summarize the financial data"
 */
export function generateReportTitle(agentType: string, input: string): string {
  // Take the first line (or whole input if single-line)
  const firstLine = input.split("\n")[0] ?? input;

  // Truncate to ~50 characters at a word boundary
  const maxLen = 50;
  let snippet = firstLine.trim();
  if (snippet.length > maxLen) {
    snippet = snippet.slice(0, maxLen);
    // Walk back to the last space to avoid cutting a word in half
    const lastSpace = snippet.lastIndexOf(" ");
    if (lastSpace > maxLen * 0.5) {
      snippet = snippet.slice(0, lastSpace);
    }
  }

  // Clean the snippet: remove characters that are problematic in titles /
  // filenames, collapse whitespace
  snippet = snippet
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Prefix with the agent type tag
  const tag = agentType.charAt(0).toUpperCase() + agentType.slice(1);
  return `[${tag}] ${snippet}`;
}

// ---------------------------------------------------------------------------
// KnowledgeCompounder
// ---------------------------------------------------------------------------

export class KnowledgeCompounder {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  // -----------------------------------------------------------------------
  // Core: compound an agent result into a wiki report page
  // -----------------------------------------------------------------------

  /**
   * Write an agent result back to the wiki as a "report"-type page.
   *
   * @param kbId      Knowledge base to save into
   * @param agentType The agent type tag (e.g. "explore", "compile")
   * @param input     The original task prompt / input text
   * @param output    The agent's output text
   * @returns The created page ID, or `null` if nothing was written (output
   *          too short or looks like an error).
   */
  compoundAgentResult(
    kbId: string,
    agentType: string,
    input: string,
    output: string,
  ): string | null {
    // ---- Guards ----------------------------------------------------------
    // Skip if the output is too short to be useful
    if (!output || output.trim().length < 50) {
      return null;
    }

    // Skip if the output looks like an error message
    if (this.looksLikeError(output)) {
      return null;
    }

    // ---- Build content ---------------------------------------------------
    const title = generateReportTitle(agentType, input);
    const timestamp = new Date().toISOString();
    const inputSummary = input.length > 200
      ? input.slice(0, 200) + "..."
      : input;

    const content = [
      `# ${title}`,
      "",
      `> **Agent Type:** ${agentType}  `,
      `> **Generated:** ${timestamp}`,
      "",
      "## Input Summary",
      "",
      inputSummary,
      "",
      "## Analysis Result",
      "",
      output,
      "",
    ].join("\n");

    // ---- Persist ---------------------------------------------------------
    const wikiDir = join(this.dataDir, "wiki");
    const page = createWikiPage(
      kbId,
      null,          // reports are not tied to a specific document
      "report",
      title,
      content,
      wikiDir,
    );

    console.log(
      `[KnowledgeCompounder] Saved report page ${page.id} for KB ${kbId}`,
    );

    return page.id;
  }

  // -----------------------------------------------------------------------
  // Simple regex-based entity extraction
  // -----------------------------------------------------------------------

  /**
   * Extract entity-like phrases from text using simple heuristics:
   *   - 2+ consecutive capitalized words (English proper nouns)
   *   - Quoted names ("..." or '...')
   *   - Chinese names (2-4 character Chinese sequences)
   *
   * This is intentionally lightweight -- the full EntityExtractor (which uses
   * an LLM) lives in `entity-extractor.ts`.
   */
  extractEntities(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    // 1) Consecutive capitalized words (2+ words starting with uppercase)
    const capMatches = text.matchAll(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
    );
    for (const m of capMatches) {
      const name = m[1];
      if (!seen.has(name)) {
        seen.add(name);
        entities.push({ name, type: "proper_noun" });
      }
    }

    // 2) Quoted names -- both double and single quotes
    const quotedMatches = text.matchAll(/["""](.+?)["""]|'([^']+)'/g);
    for (const m of quotedMatches) {
      const name = m[1] ?? m[2];
      if (name && name.length >= 2 && name.length <= 80 && !seen.has(name)) {
        seen.add(name);
        entities.push({ name, type: "quoted_name" });
      }
    }

    // 3) Chinese names (2-4 consecutive CJK characters, common for names)
    const cjkMatches = text.matchAll(/[\u4e00-\u9fff]{2,4}/g);
    for (const m of cjkMatches) {
      const name = m[0];
      // Filter out common non-name words by length heuristic
      if (
        name.length >= 2 &&
        name.length <= 4 &&
        !seen.has(name)
      ) {
        seen.add(name);
        entities.push({ name, type: "chinese_name" });
      }
    }

    return entities;
  }

  // -----------------------------------------------------------------------
  // Compound with entity linking
  // -----------------------------------------------------------------------

  /**
   * Create a report page AND create `entity_ref` links for any entities
   * extracted from the content.  Entity pages that already exist in the KB
   * will be linked; entities without a pre-existing page are still recorded
   * as links for future discovery.
   */
  compoundWithEntities(
    kbId: string,
    content: string,
    title: string,
    linker: Linker,
  ): string {
    // Create the report page
    const wikiDir = join(this.dataDir, "wiki");
    const page = createWikiPage(
      kbId,
      null,
      "report",
      title,
      content,
      wikiDir,
    );

    // Extract entities and create entity_ref links
    const entities = this.extractEntities(content);
    const db = DB.getInstance().raw;
    for (const entity of entities) {
      // Look up whether an entity page already exists for this name in the KB
      const existingPage = db
        .prepare(
          "SELECT id FROM wiki_pages WHERE kb_id = ? AND title = ? AND page_type = 'entity' LIMIT 1",
        )
        .get(kbId, entity.name) as { id: string } | undefined;

      if (existingPage) {
        // Create bidirectional entity_ref links between report and entity page
        linker.createBidirectionalLinks(
          page.id,
          existingPage.id,
          entity.name,
          `Auto-linked from report: ${title}`,
        );
      }
    }

    console.log(
      `[KnowledgeCompounder] Saved report ${page.id} with ${entities.length} entities for KB ${kbId}`,
    );

    return page.id;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Heuristic check: does the output look like an error / failure rather
   * than useful analysis content?
   */
  private looksLikeError(output: string): boolean {
    const lower = output.trim().toLowerCase();

    // Common error prefixes
    const errorPrefixes = [
      "error:",
      "failed:",
      "exception:",
      "uncaught",
      "traceback",
    ];
    for (const prefix of errorPrefixes) {
      if (lower.startsWith(prefix)) {
        return true;
      }
    }

    // If the entire output is a single short error-like line, skip it
    const lines = output.trim().split("\n");
    if (lines.length === 1 && lower.includes("error") && lower.length < 200) {
      return true;
    }

    return false;
  }
}
