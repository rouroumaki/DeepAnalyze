// =============================================================================
// DeepAnalyze - Server Entry Point
// =============================================================================

import { DB } from "./store/database.ts";
import { createApp } from "./server/app.ts";
import {
  handleOpen,
  handleMessage,
  handleClose,
  type WsServerMessage,
} from "./server/ws.ts";

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------
const db = DB.getInstance();
db.migrate();
console.log("[DB] SQLite database initialized and migrations applied");

// ---------------------------------------------------------------------------
// PostgreSQL initialization (when PG_HOST is configured)
// ---------------------------------------------------------------------------
if (process.env.PG_HOST) {
  console.log("[PG] PG_HOST detected, initializing PostgreSQL...");
  (async () => {
    try {
      const { getPool, migratePG } = await import("./store/pg.ts");
      const m001 = await import("./store/pg-migrations/001_init.ts");
      const m002 = await import("./store/pg-migrations/002_anchors_structure.ts");
      await getPool();
      await migratePG([m001.migration, m002.migration]);
      console.log("[PG] PostgreSQL ready with pgvector + zhparser");
    } catch (err) {
      console.error(
        "[PG] Initialization failed (falling back to SQLite):",
        err instanceof Error ? err.message : String(err),
      );
    }
  })();
}

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
async function shutdown() {
  console.log("\n[Server] Shutting down...");
  DB.getInstance().close();
  try {
    const { closePool } = await import("./store/pg.ts");
    await closePool();
  } catch { /* PG not initialized */ }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Bun runtime (primary)
if (typeof Bun !== "undefined") {
  Bun.serve({
    port,
    fetch(req, server) {
      // Upgrade WebSocket connections for /ws path
      const url = new URL(req.url);
      if (url.pathname === "/ws" && server.upgrade(req)) {
        return;
      }
      return app.fetch(req, server);
    },
    websocket: {
      open(ws) { handleOpen(ws as unknown as WebSocket); },
      message(ws, message) { handleMessage(ws as unknown as WebSocket, message as string); },
      close(ws) { handleClose(ws as unknown as WebSocket); },
    },
    idleTimeout: 0,  // Disable idle timeout for SSE streaming
  });
  console.log(`DeepAnalyze server running on http://localhost:${port}`);
  console.log("[WS] WebSocket endpoint available at ws://localhost:${port}/ws");
  console.log("[AgentSystem] Agent routes will initialize on first request to /api/agents/*");
} else {
  // Node.js runtime (fallback)
  import("@hono/node-server").then(({ serve }) => {
    const server = serve({ fetch: app.fetch, port });

    // Set long timeouts for SSE streaming (agent runs can take minutes)
    // Default Node.js requestTimeout is 5min which is too short for long agent runs
    server.setTimeout(0);           // Disable socket timeout entirely
    server.requestTimeout = 0;      // Disable request timeout (Node 18.0+)
    server.headersTimeout = 0;      // Disable headers timeout (Node 18.0+)
    server.keepAliveTimeout = 0;    // Disable keep-alive timeout

    // WebSocket upgrade handler for Node.js using the 'ws' library
    // Create WSS singleton once, reuse for all upgrade requests
    let wssPromise: Promise<InstanceType<typeof import("ws").WebSocketServer>> | null = null;

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname === "/ws") {
        if (!wssPromise) {
          wssPromise = import("ws").then(({ WebSocketServer }) => new WebSocketServer({ noServer: true }));
        }
        wssPromise.then((wss) => {
          wss.handleUpgrade(req, socket, head, (ws) => {
            handleOpen(ws);
            ws.on("message", (data) => { handleMessage(ws, data as Buffer); });
            ws.on("close", () => { handleClose(ws); });
          });
        }).catch((err) => {
          console.error("[WS] Failed to initialize WebSocketServer:", err);
          wssPromise = null; // Allow retry on next upgrade request
          socket.destroy();
        });
      }
    });

    console.log(`DeepAnalyze server running on http://localhost:${port}`);
    console.log("[WS] WebSocket endpoint available at ws://localhost:${port}/ws");
    console.log("[AgentSystem] Agent routes will initialize on first request to /api/agents/*");
  });
}
