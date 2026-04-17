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
  return c.json(messages);
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
