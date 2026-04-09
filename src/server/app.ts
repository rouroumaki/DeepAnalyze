// =============================================================================
// DeepAnalyze - Hono Application Assembly
// Wires together middleware, routes, and the health endpoint.
// =============================================================================

import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionRoutes } from "./routes/sessions.ts";
import { chatRoutes } from "./routes/chat.ts";
import { getOrchestrator } from "../services/agent/agent-system.js";
import { createAgentRoutes } from "./routes/agents.ts";
import { createReportRoutes } from "./routes/reports.js";
import { createPluginRoutes } from "./routes/plugins.js";
import { knowledgeRoutes } from "./routes/knowledge.js";

export function createApp(): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", cors());

  // API routes
  app.route("/api/sessions", sessionRoutes);
  app.route("/api/chat", chatRoutes);

  // Agent routes - lazily initialized on first request to avoid blocking
  // server startup while the agent pipeline (ModelRouter, embeddings, etc.)
  // initializes. Subsequent requests reuse the cached Hono sub-app.
  let agentRoutes: Hono | null = null;

  app.use("/api/agents/*", async (c, next) => {
    if (!agentRoutes) {
      const orchestrator = await getOrchestrator();
      agentRoutes = createAgentRoutes(orchestrator);
    }
    // Strip the /api/agents prefix and forward to the agent router.
    // The agent router defines its own paths relative to its mount point.
    return agentRoutes.fetch(c.req.raw);
  });

  // Report, timeline, and graph routes - mounted directly since the route
  // factory handles lazy orchestrator access internally in the handlers that
  // need it. Read-only endpoints (list, get, timeline, graph) use the wiki
  // store and database directly without requiring the agent pipeline.
  app.route("/api/reports", createReportRoutes());

  // Knowledge base management routes - document upload, KB CRUD, and processing pipeline
  app.route("/api/knowledge", knowledgeRoutes);

  // Plugin and skill routes - lazily initialized on first request, similar
  // to agent routes. The createPluginRoutes factory calls getPluginManager()
  // lazily inside each handler so mounting is cheap.
  let pluginRoutes: Hono | null = null;

  app.use("/api/plugins/*", async (c, next) => {
    if (!pluginRoutes) {
      pluginRoutes = createPluginRoutes();
    }
    return pluginRoutes.fetch(c.req.raw);
  });

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

  return app;
}
