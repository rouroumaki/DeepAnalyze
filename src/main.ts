// =============================================================================
// DeepAnalyze - Server Entry Point
// =============================================================================

// Clear system HTTP proxy env vars before any fetch() calls.
// Bun's fetch() automatically routes through http_proxy/https_proxy,
// which can break API calls when the proxy is unreliable (e.g., VPN tools
// on WSL2).  DeepAnalyze providers have their own endpoint configuration;
// users who need a proxy should set DEEPANALYZE_HTTP_PROXY and configure
// per-provider endpoints accordingly.
if (!process.env.DEEPANALYZE_KEEP_PROXY) {
  delete process.env.http_proxy;
  delete process.env.HTTP_PROXY;
  delete process.env.https_proxy;
  delete process.env.HTTPS_PROXY;
}

import { createApp } from "./server/app.ts";
import {
  handleOpen,
  handleMessage,
  handleClose,
  type WsServerMessage,
} from "./server/ws.ts";

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------
const app = createApp();

// ---------------------------------------------------------------------------
// PostgreSQL initialization (must complete before accepting requests)
// ---------------------------------------------------------------------------
console.log("[PG] Initializing PostgreSQL...");

const port = parseInt(process.env.PORT || "21000");

async function initDatabase(): Promise<void> {
  const { getPool, migratePG } = await import("./store/pg.ts");
  const m001 = await import("./store/pg-migrations/001_init.ts");
  const m002 = await import("./store/pg-migrations/002_anchors_structure.ts");
  const m003 = await import("./store/pg-migrations/003_minimax_providers.ts");
  const m004 = await import("./store/pg-migrations/004_reports_and_teams.ts");
  const m005 = await import("./store/pg-migrations/005_embedding_stale.ts");
  const m006 = await import("./store/pg-migrations/006_document_status_expand.ts");
  const m007 = await import("./store/pg-migrations/007_provider_defaults_main.ts");
  const m008 = await import("./store/pg-migrations/008_fts_content_truncate.ts");
  const m009 = await import("./store/pg-migrations/009_dual_format_page_types.ts");
  const m010 = await import("./store/pg-migrations/010_fix_minimax_model_name.ts");
  await getPool();
  await migratePG([m001.migration, m002.migration, m003.migration, m004.migration, m005.migration, m006.migration, m007.migration, m008.migration, m009.migration, m010.migration]);
  console.log("[PG] PostgreSQL ready with pgvector + zhparser");
}

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

// ---------------------------------------------------------------------------
// Start: init DB first, then auto-configure embedding, then start HTTP server
// ---------------------------------------------------------------------------
initDatabase().then(async () => {
  await autoConfigureEmbedding();
  startHttpServer();
}).catch((err) => {
  console.error(
    "[PG] Initialization failed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});

/**
 * Auto-configure the local BGE-M3 embedding server as a provider if:
 * 1. The embedding server is reachable (started by start.py on EMBEDDING_PORT)
 * 2. No embedding default is already configured
 *
 * If the local server is not available, tries to fall back to a configured
 * remote embedding provider (e.g. MiniMax-embedding).
 */
async function autoConfigureEmbedding(): Promise<void> {
  const embeddingPort = process.env.EMBEDDING_PORT ?? "11435";
  const embeddingEndpoint = `http://127.0.0.1:${embeddingPort}/v1`;
  const { getRepos } = await import("./store/repos/index.ts");
  const repos = await getRepos();
  const settings = await repos.settings.getProviderSettings();

  // Check if the local embedding server is reachable
  let localAvailable = false;
  try {
    const resp = await fetch(`http://127.0.0.1:${embeddingPort}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    localAvailable = resp.ok;
  } catch {
    localAvailable = false;
  }

  if (localAvailable) {
    // Local embedding server is running — configure it
    try {
      // Check if a local embedding provider already exists
      const existingLocal = settings.providers.find(
        (p) => p.id === "local-bge-m3" || (p.endpoint && p.endpoint.includes(`:${embeddingPort}`)),
      );
      if (existingLocal && existingLocal.enabled) {
        // Update the endpoint to match the currently running server
        let needsSave = false;
        if (existingLocal.endpoint !== embeddingEndpoint) {
          console.log(`[Embedding] Updating endpoint: ${existingLocal.endpoint} -> ${embeddingEndpoint}`);
          existingLocal.endpoint = embeddingEndpoint;
          needsSave = true;
        }
        // Ensure it's set as the embedding default
        if (settings.defaults?.embedding !== existingLocal.id) {
          settings.defaults.embedding = existingLocal.id;
          needsSave = true;
        }
        if (needsSave) {
          await repos.settings.saveProviderSettings(settings);
          console.log(`[Embedding] Updated local embedding config (default: ${existingLocal.id})`);
        }
        return;
      }

      // Register the local BGE-M3 embedding provider
      const localEmbeddingProvider = {
        id: "local-bge-m3",
        name: "BGE-M3 (本地嵌入)",
        type: "openai-compatible",
        endpoint: embeddingEndpoint,
        apiKey: "",
        model: "bge-m3",
        maxTokens: 8192,
        supportsToolUse: false,
        enabled: true,
        dimension: 1024,
      };

      if (existingLocal) {
        const idx = settings.providers.findIndex((p) => p.id === existingLocal.id);
        if (idx >= 0) settings.providers[idx] = localEmbeddingProvider;
      } else {
        settings.providers.push(localEmbeddingProvider);
      }

      settings.defaults.embedding = "local-bge-m3";
      await repos.settings.saveProviderSettings(settings);
      console.log("[Embedding] Auto-configured local BGE-M3 embedding (dim=1024)");
    } catch (err) {
      console.warn(
        "[Embedding] Failed to auto-configure BGE-M3:",
        err instanceof Error ? err.message : String(err),
      );
    }
    return;
  }

  // Local server not available — clean up stale local config
  if (settings.defaults?.embedding === "local-bge-m3") {
    settings.defaults.embedding = "";
    await repos.settings.saveProviderSettings(settings);
    console.log("[Embedding] Removed unavailable local-bge-m3 from defaults");
  }

  // Try to fall back to a remote embedding provider
  const remoteEmbedding = settings.providers.find(
    (p) =>
      p.enabled &&
      p.id !== "local-bge-m3" &&
      (p.id.toLowerCase().includes("embedding") || p.name.toLowerCase().includes("embedding")),
  );

  if (remoteEmbedding && settings.defaults?.embedding !== remoteEmbedding.id) {
    // Check if the remote provider is reachable before setting it as default
    try {
      const testResp = await fetch(`${remoteEmbedding.endpoint.replace(/\/+$/, "")}/models`, {
        headers: remoteEmbedding.apiKey ? { Authorization: `Bearer ${remoteEmbedding.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (testResp.ok) {
        settings.defaults.embedding = remoteEmbedding.id;
        await repos.settings.saveProviderSettings(settings);
        console.log(`[Embedding] Fell back to remote provider: ${remoteEmbedding.id} (${remoteEmbedding.model})`);
      } else {
        console.warn(`[Embedding] Remote provider ${remoteEmbedding.id} returned ${testResp.status}, not setting as default`);
      }
    } catch (err) {
      console.warn(
        `[Embedding] Remote provider ${remoteEmbedding.id} unreachable:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  if (!settings.defaults?.embedding) {
    console.warn("[Embedding] No embedding provider available. System will use hash fallback (no semantic search).");
    console.warn("[Embedding] To enable semantic search, start the local BGE-M3 service or configure a remote embedding provider in Settings.");
  }
}

function startHttpServer() {
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
    });
  }

  console.log(`DeepAnalyze server running on http://localhost:${port}`);
  console.log(`[WS] WebSocket endpoint available at ws://localhost:${port}/ws`);
  console.log("[AgentSystem] Agent routes will initialize on first request to /api/agents/*");
}
