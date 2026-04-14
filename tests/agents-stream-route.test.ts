import { describe, expect, test } from "bun:test";
import { createAgentRoutes } from "../src/server/routes/agents.js";
import { DB } from "../src/store/database.js";
import * as sessionStore from "../src/store/sessions.js";

function createMockOrchestrator() {
  return {
    async runSingle(options: any) {
      const onEvent = options?.onEvent;
      onEvent?.({ type: "start", taskId: "evt-task", agentType: "general" });
      onEvent?.({
        type: "error",
        taskId: "evt-task",
        error: 'OpenAI-compatible provider "default" returned HTTP 404',
      });
      onEvent?.({
        type: "complete",
        taskId: "evt-task",
        output: 'Agent failed: OpenAI-compatible provider "default" returned HTTP 404',
      });

      return {
        taskId: "orchestrator-task",
        output: 'Agent failed: OpenAI-compatible provider "default" returned HTTP 404',
        turnsUsed: 1,
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCallsCount: 0,
      };
    },
    listSessionTasks() {
      return [];
    },
    getTaskStatus() {
      return null;
    },
    cancel() {
      return false;
    },
    async runCoordinated() {
      return {
        taskId: "coord-task",
        subTasks: [],
        synthesis: "",
        status: "completed",
        totalUsage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    async runParallel() {
      return {
        taskId: "parallel-task",
        subTasks: [],
        synthesis: "",
        status: "completed",
        totalUsage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

describe("agents /run-stream route", () => {
  test("emits done status=failed when error event happened during stream", async () => {
    DB.resetInstance();
    const db = DB.getInstance("data/test-agents-stream-route.db");
    db.migrate();

    const session = sessionStore.createSession("stream-route-test");
    const router = createAgentRoutes(createMockOrchestrator() as any);

    const req = new Request("http://localhost/run-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, input: "hello" }),
    });

    const resp = await router.fetch(req);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/event-stream");

    const body = await resp.text();
    expect(body).toContain("event: error");
    expect(body).toContain("event: done");
    expect(body).toContain('"status":"failed"');
    expect(body).toContain('OpenAI-compatible provider \\"default\\" returned HTTP 404');

    DB.resetInstance();
  });
});
