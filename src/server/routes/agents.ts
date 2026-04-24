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
import { DEFAULT_AGENT_SETTINGS } from "../../services/agent/types.js";
import { ContextManager } from "../../services/agent/context-manager.js";
import { getPluginManager, getToolRegistry } from "../../services/agent/agent-system.js";
import { getRepos } from "../../store/repos/index.js";

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

interface RunRequest {
  sessionId: string;
  input: string;
  agentType?: string;
  maxTurns?: number;
  scope?: Record<string, unknown>;
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
  /** Optional knowledge base ID to scope the skill execution. */
  kbId?: string;
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
// ---------------------------------------------------------------------------
// Context loading helper
// ---------------------------------------------------------------------------

/**
 * Load conversation context for a session using token-aware, boundary-aware loading.
 * - Finds the latest compact boundary (if any) and only loads messages after it
 * - Uses token-based budget instead of fixed message count
 * - Excludes compact boundary messages from the context
 */
async function loadContextMessages(
  orchestrator: Orchestrator,
  sessionId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const repos = await getRepos();

  // Check for compact boundary — only load messages after it
  const boundary = await repos.message.getLatestCompactBoundary(sessionId);
  const allMessages = await repos.message.list(sessionId);

  // Determine starting point: after the boundary, or skip just the current user message
  let startIndex: number;
  if (boundary) {
    const boundaryIndex = allMessages.findIndex((m) => m.id === boundary.id);
    startIndex = boundaryIndex >= 0 ? boundaryIndex + 1 : 0;
  } else {
    startIndex = 0;
  }

  // Filter to user/assistant, exclude compact boundary markers, exclude current (last) user message
  const contextCandidates = allMessages
    .slice(startIndex, -1) // Exclude last message (just-saved user input, already in `input`)
    .filter((m) =>
      (m.role === "user" || m.role === "assistant") &&
      !m.content.startsWith("[COMPACT_BOUNDARY:")
    );

  if (contextCandidates.length === 0) return [];

  // Token-aware loading: use a ContextManager to estimate tokens
  const modelRouter = orchestrator.getModelRouter();
  const contextManager = new ContextManager(modelRouter, "", []);
  const settings = { ...DEFAULT_AGENT_SETTINGS };

  // Budget: 50% of context window for loaded history
  // (remaining 50% for system prompt, tools, output, session memory)
  const maxTokens = Math.floor(settings.contextWindow * settings.contextLoadRatio);

  const { messages } = contextManager.loadContextMessages(
    contextCandidates.map((m) => ({ role: m.role, content: m.content || "" })),
    maxTokens,
  );

  return messages;
}

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

    // Load previous conversation history with token-aware, boundary-aware loading
    const contextMessages = await loadContextMessages(orchestrator, body.sessionId);

    try {
      const result = await orchestrator.runSingle({
        input: body.input,
        agentType: body.agentType || "general",
        sessionId: body.sessionId,
        maxTurns: body.maxTurns,
        contextMessages,
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

    // Load previous conversation history with token-aware, boundary-aware loading
    const contextMessages = await loadContextMessages(orchestrator, body.sessionId);

    // Set up SSE response
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    // Set up execution context for ask_user tool before streaming starts
    const toolRegistry = await getToolRegistry();
    let pendingTaskId = "";

    toolRegistry.setExecutionContext({
      askUserCallback: async (question: string, options?: string[]) => {
        // Send ask_user SSE event to frontend
        const eventData = { question, options: options ?? [], taskId: pendingTaskId };
        // We write directly to the SSE stream via a closure that captures `s`
        // but the stream hasn't started yet. Instead we use a deferred approach:
        // store the event to be emitted from the onEvent callback.
        // Actually, we can use the orchestrator's waitForUserAnswer which returns a Promise.
        // The route handler's onEvent will emit the SSE event when the tool_call comes in.
        // For now, emit directly via a stored sendEvent reference.
        if (toolRegistry.getExecutionContext()._sendSse) {
          (toolRegistry.getExecutionContext()._sendSse as (ev: string, d: unknown) => void)("ask_user", eventData);
        }
        return orchestrator.waitForUserAnswer(pendingTaskId);
      },
    });

    return stream(c, async (s) => {
      // Helper to send SSE events
      const sendEvent = (event: string, data: unknown) => {
        s.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Keepalive heartbeat to prevent proxy/server timeout on long-running agents.
      let keepaliveTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
        s.write(": keepalive\n\n");
      }, 15_000);

      // Store sendEvent in execution context so ask_user callback can emit SSE
      const ctx = toolRegistry.getExecutionContext();
      ctx._sendSse = sendEvent;

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
      let reportData: { id: string; title: string; content: string; sourceCount?: number; reportType?: string } | null = null;

      // Collect push_content items for persistence
      const pushedContents: Array<{ type: string; title: string; data: string; format?: string; timestamp?: string }> = [];

      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case "start":
            taskId = event.taskId;
            pendingTaskId = event.taskId;
            sendEvent("start", { taskId: event.taskId, agentType: event.agentType });
            break;

          case "turn":
            sendEvent("turn", { turn: event.turn, taskId: event.taskId });
            // Forward any text content from the turn as a content event
            if (event.content) {
              fullContent += (fullContent ? "\n\n" : "") + event.content;
              sendEvent("content", { content: event.content, accumulated: fullContent });
            }
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
            // For the "think" tool, emit the reasoning as streaming content
            // so it appears inline in the chat message between tool calls.
            if (event.toolName === "think" && event.input?.thought) {
              const thoughtText = String(event.input.thought);
              fullContent += (fullContent ? "\n\n" : "") + thoughtText;
              sendEvent("content", { content: thoughtText, accumulated: fullContent });
            }
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

            // Capture report_generate results for displaying in chat
            if (event.toolName === "report_generate" && typeof event.result === "object" && event.result !== null) {
              const r = event.result as Record<string, unknown>;
              if (r.reportId && !r.error) {
                reportData = {
                  id: String(r.reportId),
                  title: String(r.title || ""),
                  content: String(r.content || ""),
                  sourceCount: typeof r.sourceCount === "number" ? r.sourceCount : undefined,
                  reportType: String(r.reportType || "analysis"),
                };
              }
            }

            // Forward push_content results directly to frontend
            if (event.toolName === "push_content" && typeof event.result === "object" && event.result !== null) {
              const r = event.result as Record<string, unknown>;
              if (r.pushed && !r.error) {
                const pcItem = {
                  type: String(r.type || ""),
                  title: String(r.title || ""),
                  data: String(r.data || ""),
                  format: r.format ? String(r.format) : undefined,
                  timestamp: r.timestamp ? String(r.timestamp) : undefined,
                };
                sendEvent("push_content", pcItem);
                pushedContents.push(pcItem);
              }
            }

            // Forward agent_todo results to frontend for TodoPanel
            if (event.toolName === "agent_todo" && typeof event.result === "object" && event.result !== null) {
              const r = event.result as Record<string, unknown>;
              sendEvent("todo_update", r);
            }

            // Forward ask_user tool results to frontend so it can clear the question UI
            if (event.toolName === "ask_user" && typeof event.result === "object" && event.result !== null) {
              const r = event.result as Record<string, unknown>;
              sendEvent("ask_user_answered", { taskId: event.taskId, answer: r.answer });
            }

            // Forward workflow_run events to frontend for SubAgentPanel
            if (event.toolName === "workflow_run" && typeof event.result === "object" && event.result !== null) {
              const r = event.result as Record<string, unknown>;
              if (r.status === "completed" && r.results) {
                sendEvent("workflow_complete", {
                  status: r.status,
                  goal: r.goal,
                  totalAgents: (r.results as unknown[]).length,
                  results: r.results,
                });
              }
            }
            break;
          }

          case "progress":
            // Only forward progress events — content accumulation is handled
            // by the "turn" handler to avoid double-counting text that both
            // recordProgress() and emitEvent("turn") emit.
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
          contextMessages,
          onEvent,
          scope: body.scope,
        });

        // Determine if the agent actually failed (orchestrator catches errors
        // and returns a result with error output, so we check the output text)
        const agentFailed = result.output?.startsWith("Agent failed:") ?? false;

        // Build the content to save: prefer pushed content (the actual report),
        // fall back to streaming text, then agent output
        let savedContent = fullContent || result.output || "";

        // If push_content was used, append those items as the substantive output
        if (pushedContents.length > 0) {
          // For markdown push_content, use it as the primary content
          const markdownItems = pushedContents.filter(pc => pc.type === "markdown");
          if (markdownItems.length > 0) {
            // Use markdown push_content as the main content body
            savedContent = markdownItems.map(pc => pc.data).join("\n\n---\n\n");
          }
        }

        if (savedContent) {
          const metadata: Record<string, unknown> = {};
          if (reportData) {
            metadata.reportId = reportData.id;
          }
          // Persist push_content items so frontend can reconstruct them for history
          if (pushedContents.length > 0) {
            metadata.pushedContents = pushedContents;
          }
          // Persist tool call summaries (truncated to avoid large metadata)
          if (toolCalls.length > 0) {
            metadata.toolCalls = toolCalls.map((tc) => ({
              id: tc.id,
              toolName: tc.toolName,
              status: tc.status,
              inputSummary: JSON.stringify(tc.input).slice(0, 200),
              outputSummary: (tc.output || "").slice(0, 200),
            }));
          }
          await repos.message.create(body.sessionId, "assistant", savedContent,
            Object.keys(metadata).length > 0 ? metadata : undefined
          );
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
          report: reportData ?? undefined,
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
        kbId: body.kbId,
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

  // -----------------------------------------------------------------------
  // POST /message/:taskId - Send user reply to a pending ask_user question
  // -----------------------------------------------------------------------
  router.post("/message/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const body = await c.req.json<{ answer?: string }>().catch(() => ({} as { answer?: string }));

    if (!body.answer) {
      return c.json({ error: "answer is required" }, 400);
    }

    const resolved = orchestrator.resolveUserAnswer(taskId, body.answer);
    if (!resolved) {
      return c.json({ error: "No pending question for this task" }, 404);
    }

    return c.json({ taskId, status: "answered" });
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
