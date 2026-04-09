// =============================================================================
// DeepAnalyze - Report Generation Tool
// =============================================================================
// Generates structured analysis reports by searching the knowledge base,
// gathering relevant content, and saving the result as a wiki page.
// =============================================================================

import { join } from "node:path";
import { createWikiPage, getWikiPage, getPageContent } from "../../store/wiki-pages.js";
import type { AgentTool } from "../../services/agent/types.js";
import type { Retriever } from "../../wiki/retriever.js";
import type { SearchResult } from "../../wiki/retriever.js";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReportToolDeps {
  retriever: Retriever;
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

type ReportType = "analysis" | "summary" | "comparison" | "investigation";

interface ReportResult {
  reportId: string;
  title: string;
  content: string;
  sourceCount: number;
  reportType: ReportType;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createReportTool(deps: ReportToolDeps): AgentTool {
  return {
    name: "report_generate",
    description:
      "Generate a structured analysis report. Searches the knowledge base " +
      "for relevant information, compiles findings into a report, and saves " +
      "it as a wiki page. Returns the report content and page ID.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Report title",
        },
        query: {
          type: "string",
          description: "Topic/query to analyze for the report",
        },
        kbId: {
          type: "string",
          description: "Knowledge base ID to search within",
        },
        reportType: {
          type: "string",
          enum: ["analysis", "summary", "comparison", "investigation"],
          description: "Type of report to generate (default: analysis)",
        },
        sections: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of section titles to include in the report",
        },
      },
      required: ["title", "query", "kbId"],
    },
    async execute(input: Record<string, unknown>): Promise<ReportResult | { error: string }> {
      try {
        const title = input.title as string;
        const query = input.query as string;
        const kbId = input.kbId as string;
        const reportType = (input.reportType as ReportType) || "analysis";
        const sections = input.sections as string[] | undefined;

        // -------------------------------------------------------------------
        // 1. Search for relevant content
        // -------------------------------------------------------------------

        const results: SearchResult[] = await deps.retriever.search(query, {
          kbIds: [kbId],
          topK: 15,
          pageTypes: ["overview", "abstract"],
        });

        if (results.length === 0) {
          // Broaden the search if no overview/abstract pages are found
          const broadResults: SearchResult[] = await deps.retriever.search(query, {
            kbIds: [kbId],
            topK: 15,
          });

          if (broadResults.length === 0) {
            return {
              error: `No relevant content found for query "${query}" in knowledge base ${kbId}`,
            };
          }

          results.push(...broadResults);
        }

        // -------------------------------------------------------------------
        // 2. Gather content from top results
        // -------------------------------------------------------------------

        const topResults = results.slice(0, 10);
        const sources: Array<{
          pageId: string;
          title: string;
          pageType: string;
          snippet: string;
          content: string;
        }> = [];

        for (const result of topResults) {
          let content = result.snippet;
          try {
            const page = getWikiPage(result.pageId);
            if (page) {
              content = getPageContent(page.filePath);
            }
          } catch {
            // Fall back to snippet if file read fails
          }

          sources.push({
            pageId: result.pageId,
            title: result.title,
            pageType: result.pageType,
            snippet: result.snippet,
            content,
          });
        }

        // -------------------------------------------------------------------
        // 3. Build report markdown
        // -------------------------------------------------------------------

        const reportLines: string[] = [];

        // Title header
        reportLines.push(`# ${title}`);
        reportLines.push("");
        reportLines.push(`> Report Type: ${reportType} | Generated: ${new Date().toISOString()}`);
        reportLines.push("");
        reportLines.push("---");
        reportLines.push("");

        // Table of Contents (if sections are provided)
        if (sections && sections.length > 0) {
          reportLines.push("## Table of Contents");
          reportLines.push("");
          for (let i = 0; i < sections.length; i++) {
            reportLines.push(`${i + 1}. ${sections[i]}`);
          }
          reportLines.push("");
        }

        // Sources Consulted
        reportLines.push("## Sources Consulted");
        reportLines.push("");
        for (const source of sources) {
          reportLines.push(
            `- **${source.title}** (${source.pageType}) - Page ID: ${source.pageId}`,
          );
        }
        reportLines.push("");

        // Analysis sections
        if (sections && sections.length > 0) {
          // Use user-specified sections
          for (const section of sections) {
            reportLines.push(`## ${section}`);
            reportLines.push("");
            reportLines.push(`_Content for "${section}" based on analysis of ${sources.length} sources._`);
            reportLines.push("");

            // Include relevant excerpts for this section
            for (const source of sources) {
              const excerpt = extractRelevantExcerpt(source.content, query, 300);
              if (excerpt) {
                reportLines.push(`### From: ${source.title}`);
                reportLines.push("");
                reportLines.push(excerpt);
                reportLines.push("");
              }
            }
          }
        } else {
          // Default section structure
          reportLines.push("## Background");
          reportLines.push("");
          reportLines.push(
            `This report analyzes information related to "${query}" from the knowledge base.`,
          );
          reportLines.push(
            `A total of ${results.length} relevant pages were found across ${sources.length} sources.`,
          );
          reportLines.push("");

          reportLines.push("## Analysis");
          reportLines.push("");
          for (const source of sources) {
            const excerpt = extractRelevantExcerpt(source.content, query, 400);
            if (excerpt) {
              reportLines.push(`### ${source.title}`);
              reportLines.push("");
              reportLines.push(excerpt);
              reportLines.push("");
            }
          }

          reportLines.push("## Key Findings");
          reportLines.push("");
          reportLines.push("_(To be filled in by the agent based on analysis)_");
          reportLines.push("");

          reportLines.push("## Open Questions");
          reportLines.push("");
          reportLines.push("_(To be filled in by the agent)_");
          reportLines.push("");

          reportLines.push("## Recommendations");
          reportLines.push("");
          reportLines.push("_(To be filled in by the agent)_");
          reportLines.push("");
        }

        // Footer
        reportLines.push("---");
        reportLines.push("");
        reportLines.push(
          `_Report generated from ${sources.length} sources across knowledge base ${kbId}._`,
        );
        reportLines.push("");

        const reportContent = reportLines.join("\n");

        // -------------------------------------------------------------------
        // 4. Save as wiki page
        // -------------------------------------------------------------------

        const wikiDir = join(deps.dataDir, "wiki");
        const page = createWikiPage(
          kbId,
          null, // reports are not tied to a specific document
          "report",
          title,
          reportContent,
          wikiDir,
        );

        // -------------------------------------------------------------------
        // 5. Return result
        // -------------------------------------------------------------------

        return {
          reportId: page.id,
          title,
          content: reportContent,
          sourceCount: results.length,
          reportType,
        };
      } catch (err) {
        return {
          error: `Report generation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a relevant excerpt from content that contains the query terms.
 * Falls back to the beginning of the content if no match is found.
 */
function extractRelevantExcerpt(
  content: string,
  query: string,
  maxLen: number = 300,
): string {
  if (!content) return "";

  // Try to find a relevant portion containing query keywords
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  for (const keyword of keywords) {
    const idx = content.toLowerCase().indexOf(keyword);
    if (idx !== -1) {
      const start = Math.max(0, idx - 50);
      const end = Math.min(content.length, start + maxLen);
      let excerpt = content.substring(start, end);
      if (start > 0) excerpt = "..." + excerpt;
      if (end < content.length) excerpt = excerpt + "...";
      return excerpt;
    }
  }

  // No keyword match - return the first paragraph
  const lines = content.split("\n");
  const firstParagraph = lines.find(
    (line) => line.trim().length > 0 && !line.startsWith("#"),
  );

  if (firstParagraph) {
    return firstParagraph.length > maxLen
      ? firstParagraph.substring(0, maxLen) + "..."
      : firstParagraph;
  }

  return content.length > maxLen ? content.substring(0, maxLen) + "..." : content;
}
