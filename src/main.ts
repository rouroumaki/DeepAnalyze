// =============================================================================
// DeepAnalyze - Server Entry Point
// =============================================================================

import { createApp } from "./server/app.ts";
import {
  handleOpen,
  handleMessage,
  handleClose,
  type WsServerMessage,
} from "./server/ws.ts";

// ---------------------------------------------------------------------------
// PostgreSQL initialization
// ---------------------------------------------------------------------------
console.log("[PG] Initializing PostgreSQL...");

(async () => {
  try {
    const { getPool, migratePG } = await import("./store/pg.ts");
    const m001 = await import("./store/pg-migrations/001_init.ts");
    const m002 = await import("./store/pg-migrations/002_anchors_structure.ts");
    const m003 = await import("./store/pg-migrations/003_minimax_providers.ts");
    const m004 = await import("./store/pg-migrations/004_reports_and_teams.ts");
    const m005 = await import("./store/pg-migrations/005_embedding_stale.ts");
    const m006 = await import("./store/pg-migrations/006_document_status_expand.ts");
    const m007 = await import("./store/pg-migrations/007_provider_defaults_main.ts");
    await getPool();
    await migratePG([m001.migration, m002.migration, m003.migration, m004.migration, m005.migration, m006.migration, m007.migration]);
    console.log("[PG] PostgreSQL ready with pgvector + zhparser");
  } catch (err) {
    console.error(
      "[PG] Initialization failed:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
})();

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------
const app = createApp();

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------
const port = parseInt(process.env.PORT || "21000");

async function shutdown() {
  console.log("\n[Server] Shutting down...");
  try {
    const { closePool } = await import("./store/pg.ts");
    await closePool();
  } catch { /* PG not initialized */ }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (typeof Bun !== "undefined") {
  Bun.serve({
    port,
    fetch(req, server) {
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
    idleTimeout: 0,
  });
  console.log(`DeepAnalyze server running on http://localhost:${port}`);
  console.log("[WS] WebSocket endpoint available at ws://localhost:${port}/ws");
  console.log("[AgentSystem] Agent routes will initialize on first request to /api/agents/*");
} else {
  import("@hono/node-server").then(({ serve }) => {
    const server = serve({ fetch: app.fetch, port });
    server.setTimeout(0);
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.keepAliveTimeout = 0;

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
          wssPromise = null;
          socket.destroy();
        });
      }
    });

    console.log(`DeepAnalyze server running on http://localhost:${port}`);
    console.log("[WS] WebSocket endpoint available at ws://localhost:${port}/ws");
    console.log("[AgentSystem] Agent routes will initialize on first request to /api/agents/*");
  });
}
