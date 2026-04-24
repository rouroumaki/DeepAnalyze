// =============================================================================
// DeepAnalyze - Session Management API Routes
// =============================================================================

import { Hono } from "hono";
import { getRepos } from "../../store/repos/index.js";

export const sessionRoutes = new Hono();

// GET / - List all sessions
sessionRoutes.get("/", async (c) => {
  const repos = await getRepos();
  const sessions = await repos.session.list();
  return c.json(sessions);
});

// POST / - Create a new session
sessionRoutes.post("/", async (c) => {
  const body = await c.req.json<{ title?: string; kbScope?: Record<string, unknown> }>();
  const repos = await getRepos();
  const session = await repos.session.create(body.title, body.kbScope);
  return c.json(session, 201);
});

// GET /:id - Get session by id
sessionRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const repos = await getRepos();
  const session = await repos.session.get(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(session);
});

// GET /:id/messages - Get messages for a session
sessionRoutes.get("/:id/messages", async (c) => {
  const id = c.req.param("id");
  const repos = await getRepos();
  const session = await repos.session.get(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  const messages = await repos.message.list(id);

  // Enrich assistant messages with report data and tool calls from metadata
  const enriched = await Promise.all(messages.map(async (msg) => {
    if (msg.role !== "assistant" || !msg.metadata) return msg;
    try {
      const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
      const result: Record<string, unknown> = {};

      // Report enrichment
      if (meta?.reportId) {
        const page = await repos.wikiPage.getById(meta.reportId);
        if (page && page.page_type === "report") {
          result.report = {
            id: page.id,
            title: page.title,
            content: page.content,
            summary: page.content.slice(0, 200),
            references: [],
            entities: [],
            createdAt: page.created_at,
          };
        }
      }

      // Tool call enrichment
      if (meta?.toolCalls && Array.isArray(meta.toolCalls)) {
        result.toolCalls = meta.toolCalls;
      }

      // Pushed contents enrichment
      if (meta?.pushedContents && Array.isArray(meta.pushedContents)) {
        result.pushedContents = meta.pushedContents;
      }

      return Object.keys(result).length > 0 ? { ...msg, ...result } : msg;
    } catch {
      return msg;
    }
  }));

  return c.json(enriched);
});

// DELETE /:id - Delete a session
sessionRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const repos = await getRepos();
  const deleted = await repos.session.delete(id);
  if (!deleted) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json({ success: true }, 200);
});
