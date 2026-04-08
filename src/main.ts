import { Hono } from "hono";

const app = new Hono();

app.get("/api/health", (c) => {
  return c.json({ status: "ok", version: "0.1.0" });
});

const port = 21000;

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
