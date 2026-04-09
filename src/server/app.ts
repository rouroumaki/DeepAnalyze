// =============================================================================
// DeepAnalyze - Hono Application Assembly
// Wires together middleware, routes, static file serving, and health endpoint.
// =============================================================================

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { errorHandler, requestLogger } from "./middleware/index.js";
import { sessionRoutes } from "./routes/sessions.ts";
import { chatRoutes } from "./routes/chat.ts";
import { getOrchestrator } from "../services/agent/agent-system.js";
import { createAgentRoutes } from "./routes/agents.ts";
import { createReportRoutes } from "./routes/reports.js";
import { createPluginRoutes } from "./routes/plugins.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { createSettingsRoutes } from "./routes/settings.js";

// Frontend static files directory (built by `npm run build` in frontend/)
const FRONTEND_DIST = resolve(import.meta.dirname ?? __dirname, "../../frontend/dist");

export function createApp(): Hono {
  const app = new Hono();

  // Global error handler (must be registered before routes)
  app.onError(errorHandler);

  // Request logging and tracing
  app.use("*", requestLogger);

  // CORS
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
    return agentRoutes.fetch(c.req.raw);
  });

  // Report, timeline, and graph routes
  app.route("/api/reports", createReportRoutes());

  // Knowledge base management routes
  app.route("/api/knowledge", knowledgeRoutes);

  // Settings and provider configuration routes
  app.route("/api/settings", createSettingsRoutes());

  // Plugin and skill routes
  let pluginRoutes: Hono | null = null;

  app.use("/api/plugins/*", async (c, next) => {
    if (!pluginRoutes) {
      pluginRoutes = createPluginRoutes();
    }
    return pluginRoutes.fetch(c.req.raw);
  });

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

  // -----------------------------------------------------------------------
  // Frontend static file serving (production mode)
  // -----------------------------------------------------------------------
  // Serve built frontend assets from frontend/dist/. This is only active
  // when the frontend has been built (npm run build). In dev mode, the
  // Vite dev server handles frontend serving on a separate port.

  // Serve static assets (JS, CSS, images, etc.)
  app.use("/assets/*", serveStatic({ root: FRONTEND_DIST, rewriteRequestPath: (p) => p }));

  // SPA fallback: any non-API route that doesn't match a static file
  // should serve index.html so client-side routing works.
  app.get("*", (c) => {
    // Skip API routes
    if (c.req.path.startsWith("/api/")) {
      return c.notFound();
    }

    const indexPath = resolve(FRONTEND_DIST, "index.html");
    if (!existsSync(indexPath)) {
      return c.json(
        { error: "Frontend not built. Run: cd frontend && npm run build" },
        404,
      );
    }

    const html = readFileSync(indexPath, "utf-8");
    return c.html(html);
  });

  return app;
}
