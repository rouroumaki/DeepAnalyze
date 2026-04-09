// =============================================================================
// DeepAnalyze - Request Logger Middleware
// =============================================================================
// Logs every incoming request (method + path) and the corresponding response
// (status code + duration). Attaches a unique X-Request-Id header to every
// request for distributed tracing and debugging.
// =============================================================================

import type { MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const requestId = randomUUID();
  const start = Date.now();

  c.header("X-Request-Id", requestId);
  c.set("requestId", requestId);

  console.log(`[Request] ${c.req.method} ${c.req.path}`);

  await next();

  const duration = Date.now() - start;
  console.log(
    `[Response] ${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`,
  );
};
