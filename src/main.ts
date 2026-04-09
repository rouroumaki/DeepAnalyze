// =============================================================================
// DeepAnalyze - Server Entry Point
// =============================================================================

import { DB } from "./store/database.ts";
import { createApp } from "./server/app.ts";

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------
const db = DB.getInstance();
db.migrate();
console.log("[DB] Database initialized and migrations applied");

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------
// The agent system (Orchestrator, AgentRunner, ToolRegistry, etc.) is
// initialized lazily on the first request to /api/agents/*. This keeps
// server startup fast and avoids errors when model config is missing.
const app = createApp();

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------
const port = parseInt(process.env.PORT || "21000");

// Graceful shutdown handler
function shutdown() {
  console.log("\n[Server] Shutting down...");
  DB.getInstance().close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Bun runtime (primary)
if (typeof Bun !== "undefined") {
  Bun.serve({
    port,
    fetch: app.fetch,
  });
  console.log(`DeepAnalyze server running on http://localhost:${port}`);
  console.log("[AgentSystem] Agent routes will initialize on first request to /api/agents/*");
} else {
  // Node.js runtime (fallback)
  import("@hono/node-server").then(({ serve }) => {
    serve({ fetch: app.fetch, port });
    console.log(`DeepAnalyze server running on http://localhost:${port}`);
    console.log("[AgentSystem] Agent routes will initialize on first request to /api/agents/*");
  });
}
