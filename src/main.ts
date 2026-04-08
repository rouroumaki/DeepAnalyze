import { Hono } from "hono";
import { DB } from "./store/database.ts";

const app = new Hono();

app.get("/api/health", (c) => {
  return c.json({ status: "ok", version: "0.1.0" });
});

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------
const db = DB.getInstance();
db.migrate();
console.log("[DB] Database initialized and migrations applied");

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------
const port = 21000;

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
} else {
  // Node.js runtime (fallback for development without Bun)
  import("@hono/node-server").then(({ serve }) => {
    serve({ fetch: app.fetch, port });
    console.log(`DeepAnalyze server running on http://localhost:${port}`);
  });
}
