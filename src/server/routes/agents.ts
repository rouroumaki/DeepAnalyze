// =============================================================================
// DeepAnalyze - Agent API Routes
// =============================================================================
// Hono routes for agent task management. Provides endpoints for running
// single agent tasks, coordinated multi-agent workflows, querying task status,
// and cancelling running tasks.
//
// The routes receive an Orchestrator instance via the factory function
// `createAgentRoutes` to avoid circular dependencies and allow lazy
// initialization.
// =============================================================================

import { Hono } from "hono";
import type { Orchestrator } from "../../services/agent/orchestrator.js";
import type { AgentTask } from "../../services/agent/types.js";
import * as messageStore from "../../store/messages.js";
import * as sessionStore from "../../store/sessions.js";

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

interface RunRequest {
  sessionId: string;
  input: string;
  agentType?: string;
  maxTurns?: number;
}

interface RunCoordinatedRequest {
  sessionId: string;
  input: string;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Create agent API routes, receiving an Orchestrator instance.
 *
 * Routes:
 *   POST /run              - Run a single agent task
 *   POST /run-coordinated  - Run a coordinated multi-agent workflow
 *   GET  /tasks/:sessionId - List agent tasks for a session
 *   GET  /task/:taskId     - Get a single task status
 *   POST /cancel/:taskId   - Cancel a running task
 */
export function createAgentRoutes(orchestrator: Orchestrator): Hono {
  const router = new Hono();

  // -----------------------------------------------------------------------
  // POST /run - Run a single agent task
  // -----------------------------------------------------------------------
  router.post("/run", async (c) => {
    const body = await c.req.json<RunRequest>();

    if (!body.sessionId || !body.input) {
      return c.json(
        { error: "sessionId and input are required" },
        400,
      );
    }

    const session = sessionStore.getSession(body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Save user message to the chat session
    messageStore.createMessage(body.sessionId, "user", body.input);

    try {
      const result = await orchestrator.runSingle({
        input: body.input,
        agentType: body.agentType || "general",
        sessionId: body.sessionId,
        maxTurns: body.maxTurns,
      });

      // Save assistant response to the chat session
      if (result.output) {
        messageStore.createMessage(
          body.sessionId,
          "assistant",
          result.output,
        );
      }

      return c.json({
        taskId: result.taskId,
        status: "completed",
        output: result.output,
        turnsUsed: result.turnsUsed,
        usage: result.usage,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          taskId: null,
          status: "failed",
          error: errorMsg,
        },
        500,
      );
    }
  });

  // -----------------------------------------------------------------------
  // POST /run-coordinated - Run a coordinated multi-agent workflow
  // -----------------------------------------------------------------------
  router.post("/run-coordinated", async (c) => {
    const body = await c.req.json<RunCoordinatedRequest>();

    if (!body.sessionId || !body.input) {
      return c.json(
        { error: "sessionId and input are required" },
        400,
      );
    }

    const session = sessionStore.getSession(body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Save user message to the chat session
    messageStore.createMessage(body.sessionId, "user", body.input);

    // Run the coordinated workflow in the background. We return the parent
    // task ID immediately and let the client poll for results.
    const parentTaskId = await startCoordinatedRun(
      orchestrator,
      body.input,
      body.sessionId,
    );

    return c.json({
      taskId: parentTaskId,
      status: "running",
    });
  });

  // -----------------------------------------------------------------------
  // GET /tasks/:sessionId - List agent tasks for a session
  // -----------------------------------------------------------------------
  router.get("/tasks/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");

    const tasks = orchestrator.listSessionTasks(sessionId);

    return c.json(tasks.map(taskToResponse));
  });

  // -----------------------------------------------------------------------
  // GET /task/:taskId - Get a single task status
  // -----------------------------------------------------------------------
  router.get("/task/:taskId", (c) => {
    const taskId = c.req.param("taskId");

    const task = orchestrator.getTaskStatus(taskId);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json(taskToResponse(task));
  });

  // -----------------------------------------------------------------------
  // POST /cancel/:taskId - Cancel a running task
  // -----------------------------------------------------------------------
  router.post("/cancel/:taskId", (c) => {
    const taskId = c.req.param("taskId");

    const cancelled = orchestrator.cancel(taskId);
    if (!cancelled) {
      return c.json(
        { error: "Task not found or not running" },
        404,
      );
    }

    return c.json({ taskId, status: "cancelled" });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an AgentTask to a JSON-friendly response object.
 * Maps snake_case DB fields to camelCase for the API.
 */
function taskToResponse(task: AgentTask) {
  return {
    id: task.id,
    agentType: task.agentType,
    status: task.status,
    input: task.input,
    output: task.output,
    error: task.error,
    parentId: task.parentId,
    sessionId: task.sessionId,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  };
}

/**
 * Start a coordinated run in the background. Returns the parent task ID
 * immediately while the workflow continues executing.
 */
async function startCoordinatedRun(
  orchestrator: Orchestrator,
  input: string,
  sessionId: string,
): Promise<string> {
  // We need to start the run but return the ID before it completes.
  // The Orchestrator's runCoordinated creates a parent task record at the
  // start, so we use a two-phase approach:
  //   1. Start the coordinated run asynchronously (fire-and-forget)
  //   2. Give the orchestrator a moment to create the parent task record,
  //      then look it up.
  //
  // A simpler approach: start the run and let the promise run in background.
  // The client polls GET /tasks/:sessionId to see progress.

  // Fire off the coordinated run without awaiting it.
  const runPromise = orchestrator.runCoordinated(input, {
    sessionId,
  });

  // When it completes, save the synthesis as an assistant message.
  runPromise.then((result) => {
    if (result.synthesis) {
      messageStore.createMessage(sessionId, "assistant", result.synthesis);
    }
  }).catch((err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    messageStore.createMessage(
      sessionId,
      "assistant",
      `Coordinated workflow failed: ${errorMsg}`,
    );
  });

  // Give the orchestrator a tick to create the parent task in the DB.
  // The runCoordinated method creates the parent task record synchronously
  // at the start, so after one microtask tick the row should exist.
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Look up the latest coordinator task for this session.
  const tasks = orchestrator.listSessionTasks(sessionId);
  const coordinatorTask = tasks.find(
    (t) => t.agentType === "coordinator" && t.status === "running",
  );

  if (coordinatorTask) {
    return coordinatorTask.id;
  }

  // Fallback: return a placeholder. The client will see it via polling.
  return "pending";
}
