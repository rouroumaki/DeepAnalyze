// =============================================================================
// DeepAnalyze - Unified Search API Routes
// Multi-level (L0/L1/L2) search with keyword highlighting and entity discovery.
// =============================================================================

import { Hono } from "hono";
import type { Retriever } from "../../wiki/retriever.js";

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createSearchRoutes(
  getRetriever: () => Promise<Retriever>,
): Hono {
  const app = new Hono();

  // =====================================================================
  // GET / - Search API root (API discoverability)
  // =====================================================================

  app.get("/", (c) => {
    return c.json({
      status: "ok",
      message: "Unified Search API",
      endpoints: [
        "GET /knowledge/:kbId/search?query=...&topK=...&levels=L0,L1,L2&includeEntities=true&docId=...",
      ],
    });
  });

  // =====================================================================
  // GET /knowledge/:kbId/search - Multi-level search with highlighting
  // =====================================================================

  app.get("/knowledge/:kbId/search", async (c) => {
    const kbId = c.req.param("kbId");
    const query = decodeURIComponent(
      c.req.query("query") || c.req.query("q") || "",
    );
    const topK = parseInt(c.req.query("topK") || "10", 10);
    const levelsParam = c.req.query("levels"); // e.g. "L0,L1" or "L0"
    const includeEntities = c.req.query("includeEntities") === "true";
    const docId = c.req.query("docId") || undefined;

    if (!query.trim()) {
      return c.json(
        { error: "query parameter is required (use ?query=... or ?q=...)" },
        400,
      );
    }

    try {
      const retriever = await getRetriever();

      const requestedLevels = levelsParam
        ? levelsParam.split(",").map((l) => l.trim())
        : ["L0", "L1", "L2"];

      const result = await retriever.searchByLevels(query, kbId, {
        topK,
        includeEntities,
        docId,
        levels: requestedLevels,
      });

      // Filter by requested levels if specified

      const filtered: Record<string, unknown> = {};
      if (requestedLevels.includes("L0")) filtered.L0 = result.L0;
      if (requestedLevels.includes("L1")) filtered.L1 = result.L1;
      if (requestedLevels.includes("L2")) filtered.L2 = result.L2;

      // Only include entities if requested
      if (includeEntities) {
        filtered.entities = result.entities;
      }

      return c.json({
        query,
        kbId,
        results: filtered,
        totalFound:
          (requestedLevels.includes("L0") ? (result.L0?.length ?? 0) : 0) +
          (requestedLevels.includes("L1") ? (result.L1?.length ?? 0) : 0) +
          (requestedLevels.includes("L2") ? (result.L2?.length ?? 0) : 0),
      });
    } catch (err) {
      console.error("[Search] Multi-level search failed:", err);
      return c.json(
        {
          error: "Search failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  });

  return app;
}
