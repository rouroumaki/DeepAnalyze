// =============================================================================
// DeepAnalyze - Session Management API Routes
// =============================================================================

import { Hono } from "hono";
import * as sessionStore from "../../store/sessions.ts";
import * as messageStore from "../../store/messages.ts";

export const sessionRoutes = new Hono();

// GET / - List all sessions
sessionRoutes.get("/", (c) => {
  const sessions = sessionStore.listSessions();
  return c.json(sessions);
});

// POST / - Create a new session
sessionRoutes.post("/", async (c) => {
  const body = await c.req.json<{ title?: string; kbScope?: Record<string, unknown> }>();
  const session = sessionStore.createSession(body.title, body.kbScope);
  return c.json(session, 201);
});

// GET /:id - Get session by id
sessionRoutes.get("/:id", (c) => {
  const id = c.req.param("id");
  const session = sessionStore.getSession(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(session);
});

// GET /:id/messages - Get messages for a session
sessionRoutes.get("/:id/messages", (c) => {
  const id = c.req.param("id");
  const session = sessionStore.getSession(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  const messages = messageStore.getMessages(id);
  return c.json(messages);
});

// DELETE /:id - Delete a session
sessionRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const deleted = sessionStore.deleteSession(id);
  if (!deleted) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json({ success: true }, 200);
});
