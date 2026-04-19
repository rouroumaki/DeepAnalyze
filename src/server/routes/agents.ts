// =============================================================================
// DeepAnalyze - Agent API Routes
// =============================================================================
// Hono routes for agent task management. Provides endpoints for running
// single agent tasks, coordinated multi-agent workflows, querying task status,
// and cancelling running tasks.
//
// Context management (session memory, auto-compaction) is now handled
// internally by AgentRunner — no external context loading needed here.
// =============================================================================

import { Hono } from "hono";
import { stream } from "hono/streaming";
import type { Orchestrator } from "../../services/agent/orchestrator.js";
import type { AgentEvent, AgentTask } from "../../services/agent/types.js";
import { getPluginManager } from "../../services/agent/agent-system.js";
import { getRepos } from "../../store/repos/index.js";

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

interface RunSkillRequest {
  sessionId: string;
  skillId: string;
  variables: Record<string, string>;
  /** Optional user input to append to the resolved prompt. */
  input?: string;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Create agent API routes, receiving an Orchestrator instance.
 *
 * Routes:
 *   POST /run              - Run a single agent task
 *   POST /run-stream       - Run agent with SSE streaming
 *   POST /run-coordinated  - Run a coordinated multi-agent workflow
 *   POST /run-skill        - Run a skill as an agent task
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

    const repos = await getRepos();
    const session = await repos.session.get(body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Save user message to the chat session
    await repos.message.create(body.sessionId, "user", body.input);

    try {
      const result = await orchestrator.runSingle({
        input: body.input,
        agentType: body.agentType || "general",
        sessionId: body.sessionId,
        maxTurns: body.maxTurns,
      });

      // Save assistant response to the chat session
      if (result.output) {
        await repos.message.create(
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
        compactionEvents: result.compactionEvents,
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
  // POST /run-stream - Run agent with SSE streaming
  // -----------------------------------------------------------------------
  router.post("/run-stream", async (c) => {
    const body = await c.req.json<RunRequest>();

    if (!body.sessionId || !body.input) {
      return c.json({ error: "sessionId and input are required" }, 400);
    }

    const repos = await getRepos();
    const session = await repos.session.get(body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Save user message
    await repos.message.create(body.sessionId, "user", body.input);

    // Set up SSE response
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    return stream(c, async (s) => {
      // Helper to send SSE events
      const sendEvent = (event: string, data: unknown) => {
        s.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Keepalive heartbeat to prevent proxy/server timeout on long-running agents.
      let keepaliveTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
        s.write(": keepalive\n\n");
      }, 15_000);

      // Collect tool calls for the final message
      const toolCalls: Array<{
        id: string;
        toolName: string;
        input: Record<string, unknown>;
        output?: string;
        status: "running" | "completed" | "error";
      }> = [];

      let fullContent = "";
      let taskId = "";

      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case "start":
            taskId = event.taskId;
            sendEvent("start", { taskId: event.taskId, agentType: event.agentType });
            break;

          case "turn":
            sendEvent("turn", { turn: event.turn, taskId: event.taskId });
            break;

          case "tool_call": {
            const tcId = `${event.taskId}-tc-${event.turn}-${event.toolName}`;
            const tc = {
              id: tcId,
              toolName: event.toolName,
              input: event.input,
              status: "running" as const,
            };
            toolCalls.push(tc);
            sendEvent("tool_call", tc);
            break;
          }

          case "tool_result": {
            const tcId = `${event.taskId}-tc-${event.turn}-${event.toolName}`;
            const existingTc = toolCalls.find((tc) => tc.id === tcId);
            const outputStr = typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
            if (existingTc) {
              existingTc.status = "completed";
              existingTc.output = outputStr;
            }
            sendEvent("tool_result", { id: tcId, toolName: event.toolName, output: outputStr });
            break;
          }

          case "progress":
            if (event.progress.type === "text" && event.progress.content) {
              fullContent += event.progress.content;
              sendEvent("content", { content: event.progress.content, accumulated: fullContent });
            }
            sendEvent("progress", event.progress);
            break;

          case "compaction":
            sendEvent("compaction", {
              taskId: event.taskId,
              turn: event.turn,
              method: event.method,
              tokensSaved: event.tokensSaved,
            });
            break;

          case "advisory_limit_reached":
            sendEvent("advisory_limit_reached", {
              taskId: event.taskId,
              turn: event.turn,
            });
            break;

          case "complete":
            sendEvent("complete", { taskId: event.taskId, output: event.output, toolCalls });
            break;

          case "error":
            sendEvent("error", { taskId: event.taskId, error: event.error });
            break;

          case "cancelled":
            sendEvent("cancelled", { taskId: event.taskId });
            break;
        }
      };

      try {
        const result = await orchestrator.runSingle({
          input: body.input,
          agentType: body.agentType || "general",
          sessionId: body.sessionId,
          maxTurns: body.maxTurns,
          onEvent,
        });

        // Determine if the agent actually failed (orchestrator catches errors
        // and returns a result with error output, so we check the output text)
        const agentFailed = result.output?.startsWith("Agent failed:") ?? false;

        // Save assistant response
        const savedContent = fullContent || result.output;
        if (savedContent) {
          await repos.message.create(body.sessionId, "assistant", savedContent);
        }

        // Send done event with final metadata
        // If agent failed, include the error output so the frontend can display it
        sendEvent("done", {
          taskId: result.taskId,
          status: agentFailed ? "failed" : "completed",
          output: agentFailed ? result.output : undefined,
          turnsUsed: result.turnsUsed,
          usage: result.usage,
          compactionEvents: result.compactionEvents,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        sendEvent("error", { taskId: taskId || "unknown", error: errorMsg });
        sendEvent("done", { taskId: taskId || "unknown", status: "failed", error: errorMsg });
      } finally {
        // Stop keepalive heartbeat
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
      }
    });
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

    const repos = await getRepos();
    const session = await repos.session.get(body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Save user message to the chat session
    await repos.message.create(body.sessionId, "user", body.input);

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
  // POST /run-skill - Run a skill as an agent task
  // -----------------------------------------------------------------------
  router.post("/run-skill", async (c) => {
    const body = await c.req.json<RunSkillRequest>();

    if (!body.sessionId || !body.skillId) {
      return c.json(
        { error: "sessionId and skillId are required" },
        400,
      );
    }

    if (!body.variables || typeof body.variables !== "object") {
      return c.json(
        { error: "variables must be a non-null object" },
        400,
      );
    }

    const repos = await getRepos();
    const session = await repos.session.get(body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    try {
      // Get the plugin manager and resolve the skill
      const pluginManager = await getPluginManager();

      const skill = await pluginManager.getSkill(body.skillId);
      if (!skill) {
        return c.json({ error: `Skill "${body.skillId}" not found.` }, 404);
      }

      // Resolve the system prompt with provided variables
      const resolvedPrompt = await pluginManager.resolveSkillPrompt(
        body.skillId,
        body.variables,
      );

      // Build the full user input
      const userInput = body.input ?? "Execute the skill task.";

      // Save user message to the chat session
      await repos.message.create(
        body.sessionId,
        "user",
        `[Skill: ${skill.name}] ${userInput}`,
      );

      // Run the agent with the skill's system prompt and tools as overrides
      const result = await orchestrator.runSingle({
        input: userInput,
        agentType: "general",
        sessionId: body.sessionId,
        maxTurns: skill.maxTurns,
        systemPromptOverride: resolvedPrompt,
        toolsOverride: skill.tools,
      });

      // Save assistant response to the chat session
      if (result.output) {
        await repos.message.create(
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
        skillName: skill.name,
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
  // GET /tasks/:sessionId - List agent tasks for a session
  // -----------------------------------------------------------------------
  router.get("/tasks/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");

    const tasks = await orchestrator.listSessionTasks(sessionId);

    return c.json(tasks.map(taskToResponse));
  });

  // -----------------------------------------------------------------------
  // GET /task/:taskId - Get a single task status
  // -----------------------------------------------------------------------
  router.get("/task/:taskId", async (c) => {
    const taskId = c.req.param("taskId");

    const task = await orchestrator.getTaskStatus(taskId);
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
  // Fire off the coordinated run without awaiting it.
  const runPromise = orchestrator.runCoordinated(input, {
    sessionId,
  });

  // When it completes, save the synthesis as an assistant message.
  runPromise.then(async (result) => {
    if (result.synthesis) {
      const repos = await getRepos();
      await repos.message.create(sessionId, "assistant", result.synthesis);
    }
  }).catch(async (err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const repos = await getRepos();
    await repos.message.create(
      sessionId,
      "assistant",
      `Coordinated workflow failed: ${errorMsg}`,
    );
  });

  // Give the orchestrator a tick to create the parent task in the DB.
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Look up the latest coordinator task for this session.
  const tasks = await orchestrator.listSessionTasks(sessionId);
  const coordinatorTask = tasks.find(
    (t) => t.agentType === "coordinator" && t.status === "running",
  );

  if (coordinatorTask) {
    return coordinatorTask.id;
  }

  // Fallback: return a placeholder. The client will see it via polling.
  return "pending";
}
