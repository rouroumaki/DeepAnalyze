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
import { sessionRoutes } from "./routes/sessions.js";
import { chatRoutes } from "./routes/chat.js";
import { createReportRoutes } from "./routes/reports.js";
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

  // -----------------------------------------------------------------------
  // Core API routes (mounted with app.route — Hono's standard pattern)
  // -----------------------------------------------------------------------

  app.route("/api/sessions", sessionRoutes);
  app.route("/api/chat", chatRoutes);
  app.route("/api/reports", createReportRoutes());
  app.route("/api/knowledge", knowledgeRoutes);
  app.route("/api/settings", createSettingsRoutes());

  // -----------------------------------------------------------------------
  // Agent routes — lazily initialized via middleware
  // -----------------------------------------------------------------------
  // The agent pipeline (ModelRouter, embeddings, etc.) is expensive to
  // initialize. We defer it until the first request hits /api/agents/*
  // by using a middleware that creates the Hono sub-app on demand.

  let agentRoutes: Hono | null = null;

  app.use("/api/agents/*", async (c, next) => {
    if (!agentRoutes) {
      try {
        console.log("[AgentSystem] Initializing agent routes...");
        const { getOrchestrator } = await import("../services/agent/agent-system.js");
        const { createAgentRoutes } = await import("./routes/agents.js");
        const orchestrator = await getOrchestrator();
        agentRoutes = createAgentRoutes(orchestrator);
        console.log("[AgentSystem] Agent routes ready.");
      } catch (err) {
        console.error("[AgentSystem] Initialization failed:", err);
        // Don't cache failure — retry on next request
      }
    }
    await next();
  });

  // Agent root — endpoint discovery
  app.get("/api/agents", (c) => c.json({
    status: "ok",
    message: "Agent API",
    endpoints: [
      "POST /run",
      "POST /run-stream",
      "POST /run-coordinated",
      "POST /run-skill",
      "GET  /tasks/:sessionId",
      "GET  /task/:taskId",
      "POST /cancel/:taskId",
    ],
  }));

  // Agent sub-routes — delegate to the lazily-created sub-app
  app.all("/api/agents/*", async (c) => {
    if (!agentRoutes) {
      return c.json({ error: "Agent system not ready yet" }, 503);
    }

    const fullPath = c.req.path; // e.g. "/api/agents/run"
    const subPath = fullPath.replace("/api/agents", "") || "/";

    const url = new URL(c.req.url);
    url.pathname = subPath;

    let body: string | undefined;
    if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
      body = await c.req.raw.clone().text();
    }

    const newRequest = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body,
    });

    return agentRoutes.fetch(newRequest);
  });

  // -----------------------------------------------------------------------
  // Plugin & Skill routes — lazily initialized via middleware
  // -----------------------------------------------------------------------

  let pluginRoutes: Hono | null = null;

  app.use("/api/plugins/*", async (c, next) => {
    if (!pluginRoutes) {
      try {
        const { createPluginRoutes } = await import("./routes/plugins.js");
        pluginRoutes = createPluginRoutes();
      } catch (err) {
        console.error("[PluginSystem] Initialization failed:", err);
      }
    }
    await next();
  });

  // Plugin root — endpoint discovery
  app.get("/api/plugins", (c) => c.json({
    status: "ok",
    message: "Plugin & Skill API",
    endpoints: [
      "GET    /plugins",
      "GET    /plugins/:pluginId",
      "POST   /plugins/register",
      "POST   /plugins/:pluginId/enable",
      "POST   /plugins/:pluginId/disable",
      "DELETE /plugins/:pluginId",
      "PUT    /plugins/:pluginId/config",
      "GET    /skills",
      "POST   /skills",
      "DELETE /skills/:skillId",
    ],
  }));

  // Plugin sub-routes
  app.all("/api/plugins/*", async (c) => {
    if (!pluginRoutes) {
      return c.json({ error: "Plugin system not ready" }, 503);
    }

    const fullPath = c.req.path;
    const subPath = fullPath.replace("/api/plugins", "") || "/";

    const url = new URL(c.req.url);
    url.pathname = subPath;

    let body: string | undefined;
    if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
      body = await c.req.raw.clone().text();
    }

    const newRequest = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body,
    });

    return pluginRoutes.fetch(newRequest);
  });

  // -----------------------------------------------------------------------
  // Health check & convenience routes
  // -----------------------------------------------------------------------

  app.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

  app.get("/api/documents", (c) => c.json({
    message: "Documents are scoped to a knowledge base",
    hint: "Use GET /api/knowledge/kbs to list knowledge bases, then GET /api/knowledge/kbs/:kbId/documents",
  }));

  app.get("/api/knowledge", (c) => c.json({
    message: "Knowledge base API",
    hint: "Use GET /api/knowledge/kbs to list knowledge bases",
    endpoints: [
      "GET    /kbs — List all knowledge bases",
      "POST   /kbs — Create a knowledge base",
      "GET    /kbs/:kbId — Get knowledge base details",
      "DELETE /kbs/:kbId — Delete a knowledge base",
      "GET    /kbs/:kbId/documents — List documents",
      "POST   /kbs/:kbId/upload — Upload a document",
      "POST   /kbs/:kbId/process/:docId — Process a document",
      "GET    /:kbId/search?query=... — Search wiki",
      "GET    /:kbId/wiki/* — Browse wiki pages",
      "POST   /:kbId/expand — Expand wiki content",
    ],
  }));

  app.get("/api/skills", (c) => c.json({
    message: "Skills are managed under the plugin system",
    hint: "Use GET /api/plugins/skills to list skills, or GET /api/plugins for the full plugin API",
  }));

  app.get("/api/tasks", (c) => c.json({
    message: "Tasks are scoped to an agent session",
    hint: "Use GET /api/agents/tasks/:sessionId to list tasks for a session",
  }));

  app.get("/api/wiki", (c) => c.json({
    message: "Wiki is scoped to a knowledge base",
    hint: "Use GET /api/knowledge/:kbId/wiki to browse wiki pages",
  }));

  // -----------------------------------------------------------------------
  // Frontend static file serving (production mode)
  // -----------------------------------------------------------------------

  app.use("/assets/*", serveStatic({ root: FRONTEND_DIST, rewriteRequestPath: (p) => p }));

  // SPA fallback
  app.get("*", (c) => {
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
