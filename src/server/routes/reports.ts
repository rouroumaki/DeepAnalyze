// =============================================================================
// DeepAnalyze - Report, Timeline, and Graph API Routes
// =============================================================================
// Hono routes for report management, timeline extraction, and knowledge graph
// visualization. Uses wiki-pages store directly for reads and the agent system
// (via getOrchestrator) for asynchronous report generation.
// =============================================================================

import { Hono } from "hono";
import { DB } from "../../store/database.js";
import {
  getWikiPage,
  getWikiPagesByKb,
  getPageContent,
} from "../../store/wiki-pages.js";
import { getOrchestrator } from "../../services/agent/agent-system.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

interface GenerateReportRequest {
  kbId: string;
  query: string;
  title: string;
  reportType?: "analysis" | "summary" | "comparison" | "investigation";
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Create report API routes.
 *
 * Routes:
 *   GET  /reports/:kbId       - List all reports for a knowledge base
 *   GET  /report/:reportId    - Get full report content
 *   POST /generate            - Generate a new report via the agent system
 *   GET  /timeline/:kbId      - Get timeline data for a knowledge base
 *   GET  /graph/:kbId         - Get graph data for a knowledge base
 */
export function createReportRoutes(): Hono {
  const router = new Hono();

  // =====================================================================
  // GET / - Report API root (API discoverability)
  // =====================================================================

  router.get("/", (c) => {
    return c.json({
      status: "ok",
      message: "Reports API",
      endpoints: [
        "GET  /reports/:kbId",
        "GET  /report/:reportId",
        "POST /generate",
        "GET  /timeline/:kbId",
        "GET  /graph/:kbId",
      ],
    });
  });

  // =====================================================================
  // GET /reports/:kbId - List all reports for a knowledge base
  // =====================================================================

  router.get("/reports/:kbId", (c) => {
    const kbId = c.req.param("kbId");

    // Verify the knowledge base exists
    const db = DB.getInstance().raw;
    const kbRow = db
      .prepare("SELECT id FROM knowledge_bases WHERE id = ?")
      .get(kbId) as Record<string, unknown> | undefined;

    if (!kbRow) {
      return c.json({ error: "Knowledge base not found" }, 404);
    }

    const pages = getWikiPagesByKb(kbId, "report");

    const reports = pages.map((page) => ({
      id: page.id,
      title: page.title,
      tokenCount: page.tokenCount,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    }));

    return c.json({ kbId, reports });
  });

  // =====================================================================
  // GET /report/:reportId - Get full report content
  // =====================================================================

  router.get("/report/:reportId", (c) => {
    const reportId = c.req.param("reportId");

    const page = getWikiPage(reportId);
    if (!page) {
      return c.json({ error: "Report not found" }, 404);
    }

    if (page.pageType !== "report") {
      return c.json({ error: "Page is not a report" }, 400);
    }

    let content: string;
    try {
      content = getPageContent(page.filePath);
    } catch {
      return c.json({ error: "Failed to read report content" }, 500);
    }

    return c.json({
      id: page.id,
      kbId: page.kbId,
      title: page.title,
      content,
      tokenCount: page.tokenCount,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    });
  });

  // =====================================================================
  // POST /generate - Generate a new report via the agent system
  // =====================================================================

  router.post("/generate", async (c) => {
    const body = await c.req.json<GenerateReportRequest>();

    if (!body.kbId || !body.query || !body.title) {
      return c.json(
        { error: "kbId, query, and title are required" },
        400,
      );
    }

    // Verify the knowledge base exists
    const db = DB.getInstance().raw;
    const kbRow = db
      .prepare("SELECT id, name FROM knowledge_bases WHERE id = ?")
      .get(body.kbId) as Record<string, unknown> | undefined;

    if (!kbRow) {
      return c.json({ error: "Knowledge base not found" }, 404);
    }

    // Build the agent input with context about what to generate
    const reportType = body.reportType || "analysis";
    const agentInput = [
      `Generate a ${reportType} report titled "${body.title}".`,
      `Knowledge Base: ${body.kbId}`,
      `Query/Topic: ${body.query}`,
      "",
      "Use the report_generate tool to create this report. Search the knowledge base",
      "thoroughly before generating. Make sure the report is comprehensive and cites sources.",
    ].join("\n");

    // Generate a task ID for tracking
    const taskId = randomUUID();

    // Fire off the agent run in the background so we can return immediately.
    // The result will be saved as a wiki page by the report_generate tool.
    const runPromise = (async () => {
      try {
        const orchestrator = await getOrchestrator();
        const result = await orchestrator.runSingle({
          input: agentInput,
          agentType: "report",
          sessionId: body.sessionId,
          maxTurns: 20,
        });
        return { taskId, status: "completed" as const, result };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Reports] Generation failed:", errorMsg);
        return { taskId, status: "failed" as const, error: errorMsg };
      }
    })();

    // Store the promise so the client can poll for results later if needed.
    // For now we use a simple in-memory map.
    pendingTasks.set(taskId, runPromise);

    // Give the agent a tick to start, then return the task ID
    setImmediate(() => {
      // The promise runs in the background; errors are caught above.
      runPromise.catch(() => { /* already handled */ });
    });

    return c.json({ taskId, status: "running" });
  });

  // =====================================================================
  // GET /timeline/:kbId - Get timeline data for a knowledge base
  // =====================================================================

  router.get("/timeline/:kbId", (c) => {
    const kbId = c.req.param("kbId");
    const query = c.req.query("query") || "";
    const maxEvents = parseInt(c.req.query("maxEvents") || "50", 10);

    // Verify the knowledge base exists
    const db = DB.getInstance().raw;
    const kbRow = db
      .prepare("SELECT id FROM knowledge_bases WHERE id = ?")
      .get(kbId) as Record<string, unknown> | undefined;

    if (!kbRow) {
      return c.json({ error: "Knowledge base not found" }, 404);
    }

    // Get pages to extract dates from.
    // If a query is provided, do a simple LIKE search on titles and content.
    // Otherwise, use all pages in the KB.
    const pages = getWikiPagesByKb(kbId);

    // Filter pages by query if provided
    const targetPages = query
      ? pages.filter((page) => {
          const titleMatch = page.title.toLowerCase().includes(query.toLowerCase());
          // Also check content if title doesn't match
          if (titleMatch) return true;
          try {
            const content = getPageContent(page.filePath);
            return content.toLowerCase().includes(query.toLowerCase());
          } catch {
            return false;
          }
        })
      : pages;

    // Extract date-referenced events from page content
    const events: TimelineEventResponse[] = [];

    for (const page of targetPages) {
      let content: string;
      try {
        content = getPageContent(page.filePath);
      } catch {
        continue;
      }

      const rawEvents = extractDateEvents(content, page.id, page.title);

      for (const raw of rawEvents) {
        events.push({
          date: raw.date,
          title: generateEventTitle(raw.description),
          description: raw.description,
          sourcePageId: raw.sourcePageId,
          sourceTitle: raw.sourceTitle,
        });

        if (events.length >= maxEvents) break;
      }

      if (events.length >= maxEvents) break;
    }

    // Sort chronologically by date string
    events.sort((a, b) => a.date.localeCompare(b.date));

    return c.json({
      kbId,
      events,
      totalCount: events.length,
    });
  });

  // =====================================================================
  // GET /graph/:kbId - Get graph data for a knowledge base
  // =====================================================================

  router.get("/graph/:kbId", (c) => {
    const kbId = c.req.param("kbId");
    const query = c.req.query("query") || "";
    const maxNodes = parseInt(c.req.query("maxNodes") || "100", 10);

    // Verify the knowledge base exists
    const db = DB.getInstance().raw;
    const kbRow = db
      .prepare("SELECT id FROM knowledge_bases WHERE id = ?")
      .get(kbId) as Record<string, unknown> | undefined;

    if (!kbRow) {
      return c.json({ error: "Knowledge base not found" }, 404);
    }

    const nodeMap = new Map<string, GraphNodeResponse>();
    const edgeList: GraphEdgeResponse[] = [];
    const edgeSet = new Set<string>();

    // Helper to add a node
    function addNode(page: { id: string; title: string; pageType: string; kbId: string }): void {
      if (!nodeMap.has(page.id)) {
        nodeMap.set(page.id, {
          id: page.id,
          label: page.title,
          type: mapPageTypeToNodeType(page.pageType),
          group: page.kbId,
        });
      }
    }

    // Helper to add a deduplicated edge
    function addEdge(source: string, target: string, linkType: string, label?: string): void {
      const key = `${source}->${target}->${linkType}`;
      if (!edgeSet.has(key) && source !== target) {
        edgeSet.add(key);
        edgeList.push({
          source,
          target,
          label: label || linkType,
          type: linkType,
        });
      }
    }

    // Get pages for the KB
    let pages = getWikiPagesByKb(kbId);

    // Filter by query if provided
    if (query) {
      const q = query.toLowerCase();
      pages = pages.filter((page) => {
        if (page.title.toLowerCase().includes(q)) return true;
        try {
          const content = getPageContent(page.filePath);
          return content.toLowerCase().includes(q);
        } catch {
          return false;
        }
      });
    }

    // Add all matching pages as nodes
    for (const page of pages) {
      addNode(page);
      if (nodeMap.size >= maxNodes) break;
    }

    // Query wiki_links directly from the database for edges
    const pageIds = Array.from(nodeMap.keys());
    if (pageIds.length > 0) {
      // Build a parameterized query to get all links involving our pages
      const placeholders = pageIds.map(() => "?").join(",");

      // Outgoing links from our pages
      const outgoingRows = db
        .prepare(
          `SELECT wl.source_page_id, wl.target_page_id, wl.link_type, wl.entity_name
           FROM wiki_links wl
           JOIN wiki_pages wp ON wp.id = wl.target_page_id
           WHERE wl.source_page_id IN (${placeholders})
             AND wp.kb_id = ?`,
        )
        .all(...pageIds, kbId) as Array<{
        source_page_id: string;
        target_page_id: string;
        link_type: string;
        entity_name: string | null;
      }>;

      for (const row of outgoingRows) {
        const targetPage = getWikiPage(row.target_page_id);
        if (!targetPage) continue;

        addNode(targetPage);
        addEdge(
          row.source_page_id,
          row.target_page_id,
          row.link_type,
          row.entity_name || undefined,
        );

        if (nodeMap.size >= maxNodes) break;
      }

      // Incoming links to our pages
      const incomingRows = db
        .prepare(
          `SELECT wl.source_page_id, wl.target_page_id, wl.link_type, wl.entity_name
           FROM wiki_links wl
           JOIN wiki_pages wp ON wp.id = wl.source_page_id
           WHERE wl.target_page_id IN (${placeholders})
             AND wp.kb_id = ?`,
        )
        .all(...pageIds, kbId) as Array<{
        source_page_id: string;
        target_page_id: string;
        link_type: string;
        entity_name: string | null;
      }>;

      for (const row of incomingRows) {
        const sourcePage = getWikiPage(row.source_page_id);
        if (!sourcePage) continue;

        addNode(sourcePage);
        addEdge(
          row.source_page_id,
          row.target_page_id,
          row.link_type,
          row.entity_name || undefined,
        );

        if (nodeMap.size >= maxNodes) break;
      }
    }

    const nodes = Array.from(nodeMap.values());

    // Filter edges to only include those between nodes that are in our set
    const validEdges = edgeList.filter(
      (e) => nodeMap.has(e.source) && nodeMap.has(e.target),
    );

    return c.json({
      kbId,
      nodes,
      edges: validEdges,
      stats: {
        nodeCount: nodes.length,
        edgeCount: validEdges.length,
      },
    });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface TimelineEventResponse {
  date: string;
  title: string;
  description: string;
  sourcePageId: string;
  sourceTitle: string;
}

interface GraphNodeResponse {
  id: string;
  label: string;
  type: string;
  group?: string;
}

interface GraphEdgeResponse {
  source: string;
  target: string;
  label?: string;
  type: string;
}

// ---------------------------------------------------------------------------
// In-memory pending task tracking
// ---------------------------------------------------------------------------

/** Map of task ID to promise for in-flight report generation tasks. */
const pendingTasks = new Map<string, Promise<{ taskId: string; status: string; result?: unknown; error?: string }>>();

// ---------------------------------------------------------------------------
// Date extraction helpers (mirrors TimelineTool logic)
// ---------------------------------------------------------------------------

/**
 * ISO date: 2024-01-15 or 2024/01/15
 */
const ISO_DATE_RE = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g;

/**
 * Chinese dates: 2024年1月15日 or 2024年1月 or 2024年
 */
const CHINESE_FULL_DATE_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;
const CHINESE_MONTH_DATE_RE = /(\d{4})年(\d{1,2})月(?!\d)/g;

/**
 * English date month name lookup
 */
const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const ENGLISH_DATE_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
const ENGLISH_DATE_ALT_RE = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{4})\b/gi;

interface RawDateEvent {
  date: string;
  description: string;
  sourcePageId: string;
  sourceTitle: string;
}

/**
 * Normalize a year, month, day to an ISO date string.
 */
function normalizeDate(year: number, month?: number, day?: number): string {
  if (day && month) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (month) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return `${year}`;
}

/**
 * Validate that a year is reasonable (between 1000 and 2100).
 */
function isValidYear(year: number): boolean {
  return year >= 1000 && year <= 2100;
}

/**
 * Validate that a month is between 1 and 12.
 */
function isValidMonth(month: number): boolean {
  return month >= 1 && month <= 12;
}

/**
 * Validate that a day is between 1 and 31.
 */
function isValidDay(day: number): boolean {
  return day >= 1 && day <= 31;
}

/**
 * Extract a sentence or paragraph around a position in text.
 */
function extractContext(text: string, matchEnd: number, maxLen: number = 200): string {
  let start = matchEnd;
  for (let i = matchEnd - 1; i >= Math.max(0, matchEnd - maxLen); i--) {
    const ch = text[i];
    if (ch === "." || ch === "\n" || ch === "!" || ch === "?") {
      start = i + 1;
      break;
    }
    if (i === Math.max(0, matchEnd - maxLen)) {
      start = i;
    }
  }

  let end = matchEnd;
  for (let i = matchEnd; i < Math.min(text.length, matchEnd + maxLen); i++) {
    const ch = text[i];
    if (ch === "." || ch === "\n" || ch === "!" || ch === "?") {
      end = i;
      break;
    }
    if (i === Math.min(text.length, matchEnd + maxLen) - 1) {
      end = i + 1;
    }
  }

  let context = text.substring(start, end).trim();
  if (context.length > maxLen) {
    context = context.substring(0, maxLen) + "...";
  }
  return context;
}

/**
 * Extract date-referenced events from text content.
 */
function extractDateEvents(
  text: string,
  sourcePageId: string,
  sourceTitle: string,
): RawDateEvent[] {
  const events: RawDateEvent[] = [];
  const seenDates = new Set<string>();

  let match: RegExpExecArray | null;

  // ISO dates: 2024-01-15
  ISO_DATE_RE.lastIndex = 0;
  while ((match = ISO_DATE_RE.exec(text)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (isValidYear(year) && isValidMonth(month) && isValidDay(day)) {
      const date = normalizeDate(year, month, day);
      if (!seenDates.has(date + ":" + match.index)) {
        seenDates.add(date + ":" + match.index);
        events.push({
          date,
          description: extractContext(text, match.index + match[0].length),
          sourcePageId,
          sourceTitle,
        });
      }
    }
  }

  // Chinese full dates: 2024年1月15日
  CHINESE_FULL_DATE_RE.lastIndex = 0;
  while ((match = CHINESE_FULL_DATE_RE.exec(text)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (isValidYear(year) && isValidMonth(month) && isValidDay(day)) {
      const date = normalizeDate(year, month, day);
      if (!seenDates.has(date + ":" + match.index)) {
        seenDates.add(date + ":" + match.index);
        events.push({
          date,
          description: extractContext(text, match.index + match[0].length),
          sourcePageId,
          sourceTitle,
        });
      }
    }
  }

  // Chinese month dates: 2024年1月
  CHINESE_MONTH_DATE_RE.lastIndex = 0;
  while ((match = CHINESE_MONTH_DATE_RE.exec(text)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    if (isValidYear(year) && isValidMonth(month)) {
      const date = normalizeDate(year, month);
      if (!seenDates.has(date + ":" + match.index)) {
        seenDates.add(date + ":" + match.index);
        events.push({
          date,
          description: extractContext(text, match.index + match[0].length),
          sourcePageId,
          sourceTitle,
        });
      }
    }
  }

  // English dates: Month Day, Year
  ENGLISH_DATE_RE.lastIndex = 0;
  while ((match = ENGLISH_DATE_RE.exec(text)) !== null) {
    const monthNum = MONTH_NAMES[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (monthNum && isValidYear(year) && isValidDay(day)) {
      const date = normalizeDate(year, monthNum, day);
      if (!seenDates.has(date + ":" + match.index)) {
        seenDates.add(date + ":" + match.index);
        events.push({
          date,
          description: extractContext(text, match.index + match[0].length),
          sourcePageId,
          sourceTitle,
        });
      }
    }
  }

  // English dates alt: Day Month Year
  ENGLISH_DATE_ALT_RE.lastIndex = 0;
  while ((match = ENGLISH_DATE_ALT_RE.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const monthNum = MONTH_NAMES[match[2].toLowerCase()];
    const year = parseInt(match[3], 10);
    if (monthNum && isValidYear(year) && isValidDay(day)) {
      const date = normalizeDate(year, monthNum, day);
      if (!seenDates.has(date + ":" + match.index)) {
        seenDates.add(date + ":" + match.index);
        events.push({
          date,
          description: extractContext(text, match.index + match[0].length),
          sourcePageId,
          sourceTitle,
        });
      }
    }
  }

  return events;
}

/**
 * Generate a short title from an event description.
 */
function generateEventTitle(description: string): string {
  const sentenceEnd = description.search(/[.!?]/);
  if (sentenceEnd !== -1 && sentenceEnd < 100) {
    return description.substring(0, sentenceEnd).trim();
  }
  if (description.length > 80) {
    return description.substring(0, 80).trim() + "...";
  }
  return description.trim();
}

/**
 * Map a wiki page type to a node type for visualization.
 */
function mapPageTypeToNodeType(pageType: string): string {
  switch (pageType) {
    case "abstract":
    case "overview":
    case "fulltext":
      return "document";
    case "entity":
      return "entity";
    case "concept":
      return "concept";
    case "report":
      return "report";
    default:
      return "document";
  }
}
