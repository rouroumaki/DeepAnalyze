// =============================================================================
// DeepAnalyze - Hono Application Assembly
// Wires together middleware, routes, and the health endpoint.
// =============================================================================

import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionRoutes } from "./routes/sessions.ts";
import { chatRoutes } from "./routes/chat.ts";

export function createApp(): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", cors());

  // API routes
  app.route("/api/sessions", sessionRoutes);
  app.route("/api/chat", chatRoutes);

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

  return app;
}
