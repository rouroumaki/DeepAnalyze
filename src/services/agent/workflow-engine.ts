// =============================================================================
// DeepAnalyze - Workflow Engine
// =============================================================================
// Multi-agent workflow execution engine supporting 4 scheduling modes:
//   - Pipeline: sequential with accumulated context
//   - Graph (DAG): dependency-based with parallel ready nodes
//   - Council: parallel analysis + optional cross-review
//   - Parallel: all agents run concurrently
// =============================================================================

// Maximum number of sub-agents that can run concurrently.
// Limits API concurrency to prevent quota exhaustion when many sub-agents
// are spawned (e.g., 6 parallel agents × 70 turns = 420 API calls).
const MAX_CONCURRENT_AGENTS = 10;

/** Truncate a string for logging (prevent oversized DB rows). */
function truncate(str: string, maxLen: number): string {
  if (!str) return str;
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

/** Truncate JSON for logging. */
function truncateJson(obj: unknown, maxLen = 2000): string {
  if (!obj) return "";
  const s = typeof obj === "string" ? obj : JSON.stringify(obj);
  return truncate(s, maxLen);
}

/**
 * Run promises with bounded concurrency. Unlike Promise.all which runs all
 * promises simultaneously, this limits how many can be in-flight at once.
 */
async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (err) {
        results[index] = { status: "rejected", reason: err };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}

import type { AgentRunner } from "./agent-runner.js";
import type { AgentResult as RunnerAgentResult } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { NewWorkflowLog } from "../../store/repos/index.js";

// ---------------------------------------------------------------------------
// Workflow types
// ---------------------------------------------------------------------------

/** Supported workflow scheduling modes. */
export type WorkflowMode = "pipeline" | "graph" | "council" | "parallel" | "single";

/** A single agent definition within a workflow. */
export interface WorkflowAgent {
  /** Unique identifier for this agent within the workflow. */
  id: string;
  /** Role name (e.g. "researcher", "analyst"). */
  role: string;
  /** Optional system prompt override. */
  systemPrompt?: string;
  /** The task instruction for this agent. */
  task: string;
  /** Perspective hint for council mode (e.g. "security", "performance"). */
  perspective?: string;
  /** IDs of agents this agent depends on (graph mode). */
  dependsOn?: string[];
  /** Conditional execution (graph mode). */
  condition?: {
    type: "output_contains" | "output_not_contains";
    node: string;
    text: string;
  };
  /** Tool names this agent may use. Use ["*"] for all. */
  tools: string[];
}

/** Input for a workflow run. */
export interface WorkflowInput {
  /** Unique identifier for this workflow run. */
  workflowId: string;
  /** Logical team name. */
  teamName: string;
  /** Scheduling mode. */
  mode: WorkflowMode;
  /** High-level goal of the workflow. */
  goal: string;
  /** Agent definitions. */
  agents: WorkflowAgent[];
  /** Whether to run a cross-review round in council mode. Default: false. */
  crossReview?: boolean;
}

/** Result from a single agent within a workflow. */
export interface WorkflowAgentResult {
  agentId: string;
  role: string;
  status: "completed" | "failed" | "skipped";
  output: string;
  duration: number;
  error?: string;
}

/** Overall workflow result. */
export interface WorkflowResult {
  workflowId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  agentResults: WorkflowAgentResult[];
  synthesis: string;
  totalDuration: number;
}

// ---------------------------------------------------------------------------
// Workflow events
// ---------------------------------------------------------------------------

export interface WorkflowStartEvent {
  type: "workflow_start";
  workflowId: string;
  mode: WorkflowMode;
  goal: string;
  teamName?: string;
  agentCount?: number;
}

export interface WorkflowCompleteEvent {
  type: "workflow_complete";
  workflowId: string;
  status: WorkflowResult["status"];
  totalDuration: number;
}

export interface WorkflowAgentStartEvent {
  type: "workflow_agent_start";
  workflowId: string;
  agentId: string;
  role: string;
  task?: string;
}

export interface WorkflowAgentCompleteEvent {
  type: "workflow_agent_complete";
  workflowId: string;
  agentId: string;
  role: string;
  status: WorkflowAgentResult["status"];
  duration: number;
}

export interface WorkflowAgentChunkEvent {
  type: "workflow_agent_chunk";
  workflowId: string;
  agentId: string;
  content: string;
  /** Alias for content — matches WsServerMessage field name */
  chunk: string;
}

export interface WorkflowAgentToolCallEvent {
  type: "workflow_agent_tool_call";
  workflowId: string;
  agentId: string;
  toolName: string;
  /** Alias for toolName — matches WsServerMessage field name */
  tool: string;
  input: Record<string, unknown>;
  /** Alias for input — matches WsServerMessage field name */
  args: Record<string, unknown>;
}

export interface WorkflowAgentToolResultEvent {
  type: "workflow_agent_tool_result";
  workflowId: string;
  agentId: string;
  toolName: string;
  /** Alias for toolName — matches WsServerMessage field name */
  tool: string;
  result: unknown;
}

/** Union of all workflow event types. */
export type WorkflowEvent =
  | WorkflowStartEvent
  | WorkflowCompleteEvent
  | WorkflowAgentStartEvent
  | WorkflowAgentCompleteEvent
  | WorkflowAgentChunkEvent
  | WorkflowAgentToolCallEvent
  | WorkflowAgentToolResultEvent;

// ---------------------------------------------------------------------------
// Internal execution context
// ---------------------------------------------------------------------------

/** Internal state tracked per agent during execution. */
interface AgentExecState {
  agent: WorkflowAgent;
  result: WorkflowAgentResult | null;
  status: "pending" | "running" | "done";
}

// ---------------------------------------------------------------------------
// WorkflowEngine
// ---------------------------------------------------------------------------

/**
 * Engine that executes multi-agent workflows using one of four scheduling
 * modes: pipeline, graph (DAG), council, or parallel.
 *
 * The engine delegates actual agent execution to {@link AgentRunner.run} and
 * uses {@link ToolRegistry} for tool resolution. It emits granular events via
 * an `onEvent` callback for real-time progress reporting.
 *
 * This module has no direct dependency on any HTTP framework (Express/Hono).
 */
export class WorkflowEngine {
  private readonly runner: AgentRunner;
  private readonly toolRegistry: ToolRegistry;
  private readonly onEvent: ((event: WorkflowEvent) => void) | undefined;
  private readonly input: WorkflowInput;
  private abortController = new AbortController();
  /** Accumulated log entries, flushed to DB on workflow completion. */
  private logBuffer: NewWorkflowLog[] = [];

  constructor(
    input: WorkflowInput,
    runner: AgentRunner,
    toolRegistry: ToolRegistry,
    onEvent?: (event: WorkflowEvent) => void,
  ) {
    this.input = input;
    this.runner = runner;
    this.toolRegistry = toolRegistry;
    this.onEvent = onEvent;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Cancel the running workflow. */
  cancel(): void {
    this.abortController.abort();
  }

  /**
   * Execute the workflow according to its mode and return the aggregated
   * result.
   */
  async execute(): Promise<WorkflowResult> {
    const startTime = Date.now();

    this.emit({
      type: "workflow_start",
      workflowId: this.input.workflowId,
      mode: this.input.mode,
      goal: this.input.goal,
      teamName: this.input.teamName,
      agentCount: this.input.agents.length,
    });

    let agentResults: WorkflowAgentResult[];

    switch (this.input.mode) {
      case "single":
        agentResults = await this.executeSingle();
        break;
      case "pipeline":
        agentResults = await this.executePipeline();
        break;
      case "graph":
        agentResults = await this.executeGraph();
        break;
      case "council":
        agentResults = await this.executeCouncil();
        break;
      case "parallel":
        agentResults = await this.executeParallel();
        break;
      default:
        agentResults = this.skipAllAgents(
          `Unknown workflow mode: ${this.input.mode}`,
        );
    }

    const totalDuration = Date.now() - startTime;
    const status = this.computeOverallStatus(agentResults);
    const synthesis = this.synthesizeResults(agentResults);

    this.emit({
      type: "workflow_complete",
      workflowId: this.input.workflowId,
      status,
      totalDuration,
    });

    const result: WorkflowResult = {
      workflowId: this.input.workflowId,
      status,
      agentResults,
      synthesis,
      totalDuration,
    };

    // Persist workflow result to agent_tasks table
    try {
      const { getRepos } = await import("../../store/repos/index.js");
      const repos = await getRepos();
      const status = result.status === "completed" ? "completed" : "failed";
      const output = typeof result.synthesis === "string" ? result.synthesis : JSON.stringify(result);
      await repos.agentTask.updateStatus(this.input.workflowId, status, output);
    } catch (err) {
      console.error("[WorkflowEngine] Failed to persist result:", err);
    }

    // Flush accumulated logs to DB (non-blocking)
    this.flushLogs();

    return result;
  }

  // -----------------------------------------------------------------------
  // Single mode
  // -----------------------------------------------------------------------

  /**
   * Single agent delegation: runs exactly one agent directly, bypassing
   * the orchestration overhead of pipeline/graph/etc. Useful when the
   * caller just needs to delegate a focused task to one sub-agent.
   */
  private async executeSingle(): Promise<WorkflowAgentResult[]> {
    if (this.abortController.signal.aborted) {
      return this.buildCancelledResult().agentResults;
    }

    const agent = this.input.agents[0];
    if (!agent) {
      return this.skipAllAgents("No agent provided for single mode.");
    }

    const result = await this.runAgent(agent);
    return [result];
  }

  // -----------------------------------------------------------------------
  // Pipeline mode
  // -----------------------------------------------------------------------

  /**
   * Sequential execution with accumulated context. Each agent receives all
   * prior outputs. Stops on the first failure.
   */
  private async executePipeline(): Promise<WorkflowAgentResult[]> {
    if (this.abortController.signal.aborted) {
      return this.buildCancelledResult().agentResults;
    }

    const results: WorkflowAgentResult[] = [];
    const accumulatedContext: string[] = [];

    for (const agent of this.input.agents) {
      // Build context from prior outputs
      const contextMessages = this.buildContextMessages(accumulatedContext);

      const result = await this.runAgent(agent, contextMessages);

      results.push(result);

      if (result.status === "completed") {
        accumulatedContext.push(
          `## ${agent.role} (${agent.id})\n${result.output}`,
        );
      } else {
        // Pipeline stops on failure
        break;
      }
    }

    // Mark remaining agents as skipped if pipeline stopped early
    this.skipRemaining(results);

    return results;
  }

  // -----------------------------------------------------------------------
  // Graph (DAG) mode
  // -----------------------------------------------------------------------

  /**
   * Dependency-based scheduling. Runs ready nodes in parallel via
   * Promise.allSettled. Includes cycle detection and condition evaluation.
   * Skips nodes whose dependencies failed.
   */
  private async executeGraph(): Promise<WorkflowAgentResult[]> {
    if (this.abortController.signal.aborted) {
      return this.buildCancelledResult().agentResults;
    }

    const agents = this.input.agents;

    // Cycle detection
    this.detectCycles(agents);

    // Validate dependsOn references point to valid node IDs
    const agentIds = new Set(agents.map((a) => a.id));
    for (const agent of agents) {
      for (const depId of agent.dependsOn ?? []) {
        if (!agentIds.has(depId)) {
          throw new Error(
            `Invalid dependsOn: agent "${agent.id}" references non-existent agent "${depId}". Valid IDs: ${[...agentIds].join(", ")}`,
          );
        }
      }
    }

    // Build execution state map
    const stateMap = new Map<string, AgentExecState>();
    for (const agent of agents) {
      stateMap.set(agent.id, { agent, result: null, status: "pending" });
    }

    // Keep running until all nodes are done or no progress is made
    let progress = true;
    while (progress) {
      progress = false;

      // Find all ready nodes
      const readyNodes: WorkflowAgent[] = [];
      for (const [id, state] of stateMap) {
        if (state.status !== "pending") continue;

        const agent = state.agent;

        // Check dependencies
        const deps = agent.dependsOn ?? [];
        const allDepsDone = deps.every((depId) => {
          const depState = stateMap.get(depId);
          return depState && depState.status === "done";
        });

        if (!allDepsDone) continue;

        // Check conditions
        if (agent.condition && !this.evaluateCondition(agent.condition, stateMap)) {
          // Condition not met — skip this node
          state.status = "done";
          state.result = {
            agentId: agent.id,
            role: agent.role,
            status: "skipped",
            output: "",
            duration: 0,
          };
          progress = true;
          continue;
        }

        // Check if any dependency failed — if so, skip
        const anyDepFailed = deps.some((depId) => {
          const depState = stateMap.get(depId);
          return (
            depState &&
            depState.result &&
            depState.result.status !== "completed"
          );
        });

        if (anyDepFailed) {
          state.status = "done";
          state.result = {
            agentId: agent.id,
            role: agent.role,
            status: "skipped",
            output: "",
            duration: 0,
            error: "Skipped because a dependency did not complete successfully.",
          };
          progress = true;
          continue;
        }

        readyNodes.push(agent);
      }

      if (readyNodes.length === 0) continue;

      // Mark ready nodes as running
      for (const agent of readyNodes) {
        stateMap.get(agent.id)!.status = "running";
      }

      // Run ready nodes in parallel (with concurrency limit)
      const runTasks = readyNodes.map((agent) => {
        const deps = agent.dependsOn ?? [];
        const contextMessages = this.buildDepContextMessages(deps, stateMap);
        return () => this.runAgent(agent, contextMessages);
      });

      const settled = await parallelLimit(runTasks, MAX_CONCURRENT_AGENTS);

      for (let i = 0; i < settled.length; i++) {
        const agent = readyNodes[i];
        const state = stateMap.get(agent.id)!;

        const outcome = settled[i];
        if (outcome.status === "fulfilled") {
          state.result = outcome.value;
        } else {
          const errorMsg =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason);
          state.result = {
            agentId: agent.id,
            role: agent.role,
            status: "failed",
            output: "",
            duration: 0,
            error: errorMsg,
          };
        }

        state.status = "done";
        progress = true;
      }
    }

    // Collect results in agent order
    const results: WorkflowAgentResult[] = [];
    for (const agent of agents) {
      const state = stateMap.get(agent.id);
      if (state && state.result) {
        results.push(state.result);
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Council mode
  // -----------------------------------------------------------------------

  /**
   * Round 1: all members analyze in parallel from their perspective.
   * Round 2 (optional crossReview): each member reviews others' outputs
   * and refines their own.
   */
  private async executeCouncil(): Promise<WorkflowAgentResult[]> {
    if (this.abortController.signal.aborted) {
      return this.buildCancelledResult().agentResults;
    }

    const agents = this.input.agents;

    // Round 1: parallel analysis (with concurrency limit)
    const round1Tasks = agents.map((agent) => {
      const perspective = agent.perspective
        ? `\n\nYour perspective: ${agent.perspective}`
        : "";
      const augmentedTask = `${agent.task}${perspective}\n\nOverall goal: ${this.input.goal}`;

      return () => this.runAgent(agent, [], augmentedTask);
    });

    const round1Settled = await parallelLimit(round1Tasks, MAX_CONCURRENT_AGENTS);
    const round1Results: WorkflowAgentResult[] = round1Settled.map(
      (outcome, i) => {
        if (outcome.status === "fulfilled") {
          return outcome.value;
        }
        const errorMsg =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        return {
          agentId: agents[i].id,
          role: agents[i].role,
          status: "failed",
          output: "",
          duration: 0,
          error: errorMsg,
        };
      },
    );

    // If no crossReview, return round 1 results
    if (!this.input.crossReview) {
      return round1Results;
    }

    // Round 2: cross-review (parallel)
    // Build per-agent inputs first, then run all reviews concurrently.
    const round2Inputs: Array<{
      agent: WorkflowAgent;
      round1Result: WorkflowAgentResult;
      contextMessages: Array<{ role: "user" | "assistant"; content: string }> | null;
    }> = [];

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const round1Result = round1Results[i];

      // Skip agents that failed in round 1
      if (round1Result.status !== "completed") {
        round2Inputs.push({ agent, round1Result, contextMessages: null });
        continue;
      }

      // Build the context from other members' outputs
      const otherOutputs = round1Results
        .filter((_, j) => j !== i && round1Results[j].status === "completed")
        .map(
          (r) =>
            `## ${r.role} (${r.agentId})\n${r.output}`,
        )
        .join("\n\n");

      if (!otherOutputs.trim()) {
        // No other outputs to review — keep round 1 result
        round2Inputs.push({ agent, round1Result, contextMessages: null });
        continue;
      }

      const reviewTask =
        `You previously analyzed the following goal:\n${this.input.goal}\n\n` +
        `Your previous analysis:\n${round1Result.output}\n\n` +
        `Other team members' analyses:\n${otherOutputs}\n\n` +
        `Review the other members' analyses and refine your own output. ` +
        `Incorporate any insights you missed, address disagreements, and ` +
        `produce a final refined analysis.`;

      const contextMessages = [
        {
          role: "user" as const,
          content: reviewTask,
        },
      ];

      round2Inputs.push({ agent, round1Result, contextMessages });
    }

    // Run all Round 2 reviews with concurrency limit
    const round2Tasks = round2Inputs.map((input) => {
      if (!input.contextMessages) {
        // No review needed — carry forward the round 1 result
        return () => Promise.resolve(input.round1Result);
      }
      return () => this.runAgent(input.agent, input.contextMessages);
    });

    const round2Settled = await parallelLimit(round2Tasks, MAX_CONCURRENT_AGENTS);
    const round2Results: WorkflowAgentResult[] = round2Settled.map(
      (outcome, i) => {
        if (outcome.status === "fulfilled") {
          return outcome.value;
        }
        const errorMsg =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        return {
          agentId: round2Inputs[i].agent.id,
          role: round2Inputs[i].agent.role,
          status: "failed",
          output: "",
          duration: 0,
          error: errorMsg,
        };
      },
    );

    return round2Results;
  }

  // -----------------------------------------------------------------------
  // Parallel mode
  // -----------------------------------------------------------------------

  /**
   * All agents run in parallel. Results are synthesized.
   */
  private async executeParallel(): Promise<WorkflowAgentResult[]> {
    if (this.abortController.signal.aborted) {
      return this.buildCancelledResult().agentResults;
    }

    const agents = this.input.agents;

    const tasks = agents.map((agent) => () => this.runAgent(agent));
    const settled = await parallelLimit(tasks, MAX_CONCURRENT_AGENTS);

    return settled.map((outcome, i) => {
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      const errorMsg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      return {
        agentId: agents[i].id,
        role: agents[i].role,
        status: "failed",
        output: "",
        duration: 0,
        error: errorMsg,
      };
    });
  }

  // -----------------------------------------------------------------------
  // Agent execution
  // -----------------------------------------------------------------------

  /**
   * Run a single agent via the AgentRunner, wrapping it with workflow-level
   * events, timing, and detailed logging.
   */
  private async runAgent(
    agent: WorkflowAgent,
    contextMessages?: Array<{ role: "user" | "assistant"; content: string }>,
    taskOverride?: string,
  ): Promise<WorkflowAgentResult> {
    const startTime = Date.now();
    const task = taskOverride ?? agent.task;

    this.emit({
      type: "workflow_agent_start",
      workflowId: this.input.workflowId,
      agentId: agent.id,
      role: agent.role,
      task,
    });

    // Log agent start
    this.log(agent.id, agent.role, null, "agent_start", {
      task: truncate(task, 2000),
      tools: agent.tools ?? ["*"],
      hasContextMessages: !!(contextMessages && contextMessages.length > 0),
      contextMessageCount: contextMessages?.length ?? 0,
    });

    // Track per-agent turn stats
    let agentTurnCount = 0;
    let agentToolCallCount = 0;
    let agentTotalTokensIn = 0;
    let agentTotalTokensOut = 0;

    // Per-agent timeout: 5 minutes. Prevents a stalled LLM stream from
    // blocking the entire workflow indefinitely.
    const agentTimeoutMs = 5 * 60 * 1000;
    const agentTimeoutController = new AbortController();
    const agentTimeoutTimer = setTimeout(
      () => agentTimeoutController.abort(),
      agentTimeoutMs,
    );

    try {
      // Combine the workflow-level signal with the per-agent timeout
      const combinedSignal = AbortSignal.any
        ? AbortSignal.any([this.abortController.signal, agentTimeoutController.signal])
        : this.abortController.signal;

      const runnerResult: RunnerAgentResult = await this.runner.run({
        input: task,
        agentType: "general",
        systemPromptOverride: agent.systemPrompt,
        toolsOverride: agent.tools,
        contextMessages,
        signal: combinedSignal,
        onEvent: (event) => {
          this.forwardAgentEvent(agent.id, event);
          this.logAgentEvent(agent.id, agent.role, event);
          // Track stats
          if (event.type === "turn") agentTurnCount++;
          if (event.type === "tool_call") agentToolCallCount++;
          if (event.type === "turn_usage") {
            agentTotalTokensIn += event.usage.inputTokens;
            agentTotalTokensOut += event.usage.outputTokens;
          }
        },
        maxTurns: 50,
      });

      const duration = Date.now() - startTime;

      // Log agent completion with summary
      this.log(agent.id, agent.role, null, "agent_complete", {
        status: "completed",
        outputLength: runnerResult.output.length,
        outputPreview: truncate(runnerResult.output, 1000),
        turnsUsed: runnerResult.turnsUsed,
        toolCallsCount: runnerResult.toolCallsCount,
        totalTokensIn: runnerResult.usage.inputTokens,
        totalTokensOut: runnerResult.usage.outputTokens,
        durationMs: duration,
      });

      const result: WorkflowAgentResult = {
        agentId: agent.id,
        role: agent.role,
        status: "completed",
        output: runnerResult.output,
        duration,
      };

      this.emit({
        type: "workflow_agent_complete",
        workflowId: this.input.workflowId,
        agentId: agent.id,
        role: agent.role,
        status: "completed",
        duration,
      });

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const isTimeout = agentTimeoutController.signal.aborted;
      const errorMsg = isTimeout
        ? `Agent timed out after ${agentTimeoutMs / 1000}s (${agentTurnCount} turns, ${agentToolCallCount} tool calls)`
        : (err instanceof Error ? err.message : String(err));

      // Log agent failure
      this.log(agent.id, agent.role, null, "agent_error", {
        status: "failed",
        error: truncate(errorMsg, 2000),
        turnsUsed: agentTurnCount,
        toolCallsCount: agentToolCallCount,
        totalTokensIn: agentTotalTokensIn,
        totalTokensOut: agentTotalTokensOut,
        durationMs: duration,
      });

      const result: WorkflowAgentResult = {
        agentId: agent.id,
        role: agent.role,
        status: "failed",
        output: "",
        duration,
        error: errorMsg,
      };

      this.emit({
        type: "workflow_agent_complete",
        workflowId: this.input.workflowId,
        agentId: agent.id,
        role: agent.role,
        status: "failed",
        duration,
      });

      return result;
    } finally {
      clearTimeout(agentTimeoutTimer);
    }
  }

  // -----------------------------------------------------------------------
  // Event forwarding
  // -----------------------------------------------------------------------

  /**
   * Forward AgentRunner events as workflow events, tagging them with the
   * agentId so the consumer can attribute events to the right agent.
   */
  private forwardAgentEvent(
    agentId: string,
    event: import("./types.js").AgentEvent,
  ): void {
    switch (event.type) {
      case "turn":
        this.emit({
          type: "workflow_agent_chunk",
          workflowId: this.input.workflowId,
          agentId,
          content: event.content,
          chunk: event.content,
        });
        break;

      case "tool_call":
        this.emit({
          type: "workflow_agent_tool_call",
          workflowId: this.input.workflowId,
          agentId,
          toolName: event.toolName,
          tool: event.toolName,
          input: event.input,
          args: event.input,
        });
        break;

      case "tool_result":
        this.emit({
          type: "workflow_agent_tool_result",
          workflowId: this.input.workflowId,
          agentId,
          toolName: event.toolName,
          tool: event.toolName,
          result: event.result,
        });
        break;

      // start, complete, progress, error, cancelled, compaction,
      // advisory_limit_reached are not forwarded as separate workflow events
      // to keep the workflow event surface minimal.
      default:
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  /** Append a structured log entry to the buffer. */
  private log(
    agentId: string,
    role: string | undefined,
    turn: number | null,
    eventType: string,
    content: Record<string, unknown>,
    options?: { toolName?: string; durationMs?: number; modelId?: string; tokensIn?: number; tokensOut?: number },
  ): void {
    this.logBuffer.push({
      workflowId: this.input.workflowId,
      agentId,
      role: role ?? undefined,
      turn: turn ?? undefined,
      eventType,
      toolName: options?.toolName,
      content,
      durationMs: options?.durationMs,
      modelId: options?.modelId,
      tokensIn: options?.tokensIn,
      tokensOut: options?.tokensOut,
    });
  }

  /** Convert an AgentEvent from AgentRunner into structured log entries. */
  private logAgentEvent(
    agentId: string,
    role: string | undefined,
    event: import("./types.js").AgentEvent,
  ): void {
    switch (event.type) {
      case "turn":
        this.log(agentId, role, event.turn, "text", {
          contentPreview: truncate(event.content || "", 1000),
          contentLength: (event.content || "").length,
        });
        break;

      case "turn_usage":
        this.log(agentId, role, event.turn, "llm_usage", {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          cachedTokens: event.usage.cachedTokens,
        }, {
          tokensIn: event.usage.inputTokens,
          tokensOut: event.usage.outputTokens,
        });
        break;

      case "tool_call":
        this.log(agentId, role, event.turn, "tool_call", {
          toolName: event.toolName,
          inputPreview: truncateJson(event.input, 2000),
        }, { toolName: event.toolName });
        console.log(`[WorkflowEngine] Agent=${agentId} Turn=${event.turn} tool_call=${event.toolName}`);
        break;

      case "tool_result": {
        const resultStr = truncateJson(event.result, 2000);
        this.log(agentId, role, event.turn, "tool_result", {
          toolName: event.toolName,
          resultPreview: resultStr,
          resultLength: typeof event.result === "string" ? event.result.length : JSON.stringify(event.result).length,
        }, { toolName: event.toolName });
        break;
      }

      case "error":
        this.log(agentId, role, null, "error", {
          error: truncate(event.error, 2000),
        });
        break;

      case "compaction":
        this.log(agentId, role, event.turn, "compaction", {
          method: event.method,
          tokensSaved: event.tokensSaved,
        });
        break;

      case "complete":
        this.log(agentId, role, null, "runner_complete", {
          outputLength: event.output.length,
          outputPreview: truncate(event.output, 500),
        });
        break;

      // start, progress, cancelled, text_delta, advisory_limit_reached
      // are too noisy or redundant to log individually.
      default:
        break;
    }
  }

  /** Flush accumulated logs to DB. Non-blocking — errors are logged but not thrown. */
  private flushLogs(): void {
    if (this.logBuffer.length === 0) return;
    const logs = [...this.logBuffer];
    this.logBuffer = [];
    const count = logs.length;
    // Fire-and-forget: don't block the workflow result return
    (async () => {
      try {
        const { getRepos } = await import("../../store/repos/index.js");
        const repos = await getRepos();
        await repos.workflowLog.insertBatch(logs);
        console.log(`[WorkflowEngine] Flushed ${count} log entries for workflow ${this.input.workflowId}`);
      } catch (err) {
        console.error(`[WorkflowEngine] Failed to flush ${count} log entries:`, err instanceof Error ? err.message : String(err));
      }
    })();
  }

  // -----------------------------------------------------------------------
  // Graph mode helpers
  // -----------------------------------------------------------------------

  /**
   * Detect cycles in the dependency graph using DFS. Throws if a cycle is
   * found.
   */
  private detectCycles(agents: WorkflowAgent[]): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const agentMap = new Map<string, WorkflowAgent>();
    for (const agent of agents) {
      agentMap.set(agent.id, agent);
    }

    const dfs = (id: string): boolean => {
      if (inStack.has(id)) return true; // cycle
      if (visited.has(id)) return false; // already fully explored

      visited.add(id);
      inStack.add(id);

      const agent = agentMap.get(id);
      if (agent) {
        const deps = agent.dependsOn ?? [];
        for (const depId of deps) {
          if (dfs(depId)) return true;
        }
      }

      inStack.delete(id);
      return false;
    };

    for (const agent of agents) {
      if (dfs(agent.id)) {
        throw new Error(
          `Workflow graph contains a cycle involving agent "${agent.id}".`,
        );
      }
    }
  }

  /**
   * Evaluate a condition on a dependency node's output.
   */
  private evaluateCondition(
    condition: WorkflowAgent["condition"] & {},
    stateMap: Map<string, AgentExecState>,
  ): boolean {
    const depState = stateMap.get(condition.node);
    if (!depState || !depState.result) return false;

    const output = depState.result.output ?? "";

    switch (condition.type) {
      case "output_contains":
        return output.includes(condition.text);
      case "output_not_contains":
        return !output.includes(condition.text);
      default:
        return true;
    }
  }

  /**
   * Build context messages from completed dependency outputs.
   */
  private buildDepContextMessages(
    depIds: string[],
    stateMap: Map<string, AgentExecState>,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const depId of depIds) {
      const state = stateMap.get(depId);
      if (state && state.result && state.result.status === "completed") {
        messages.push({
          role: "assistant",
          content: `[${state.agent.role} (${depId}) 的输出]:\n${state.result.output}`,
        });
      }
    }

    return messages;
  }

  // -----------------------------------------------------------------------
  // Context building helpers
  // -----------------------------------------------------------------------

  /**
   * Build context messages from an array of accumulated prior output strings
   * (used by pipeline mode).
   */
  private buildContextMessages(
    accumulated: string[],
  ): Array<{ role: "user" | "assistant"; content: string }> {
    if (accumulated.length === 0) return [];

    return [
      {
        role: "user" as const,
        content:
          `以下是此工作流中前置 Agent 的上下文：\n\n` +
          accumulated.join("\n\n"),
      },
    ];
  }

  // -----------------------------------------------------------------------
  // Result helpers
  // -----------------------------------------------------------------------

  private buildCancelledResult(): WorkflowResult {
    return {
      workflowId: this.input.workflowId,
      status: "cancelled",
      agentResults: [],
      synthesis: "工作流已取消。",
      totalDuration: 0,
    };
  }

  /**
   * Compute the overall workflow status from individual agent results.
   */
  private computeOverallStatus(
    results: WorkflowAgentResult[],
  ): WorkflowResult["status"] {
    const completed = results.filter((r) => r.status === "completed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const total = results.length;

    if (total === 0) return "failed";
    if (failed === 0) return "completed";
    if (completed === 0) return "failed";
    return "partial";
  }

  /**
   * Synthesize agent results into a single summary string.
   */
  private synthesizeResults(results: WorkflowAgentResult[]): string {
    const sections: string[] = [];

    const completed = results.filter((r) => r.status === "completed");
    const failed = results.filter((r) => r.status === "failed");
    const skipped = results.filter((r) => r.status === "skipped");

    // Executive summary — always visible even if the full output gets
    // truncated downstream by the agent-runner token budget.
    if (results.length > 0) {
      const statusLine = results
        .map((r) => {
          const short = r.output.length > 200
            ? r.output.substring(0, 200) + "..."
            : r.output;
          return `- ${r.role}: ${r.status}${r.error ? ` (${r.error})` : ""} — ${short.replace(/\n/g, " ")}`;
        })
        .join("\n");
      sections.push(`## 执行摘要\n${statusLine}`);
    }

    if (completed.length > 0) {
      for (const r of completed) {
        sections.push(
          `## ${r.role} (${r.agentId})\n${r.output}`,
        );
      }
    }

    if (failed.length > 0) {
      const failureSummaries = failed
        .map((r) => `- ${r.role} (${r.agentId}): ${r.error ?? "Unknown error"}`)
        .join("\n");
      sections.push(`## Failed Agents\n${failureSummaries}`);
    }

    if (skipped.length > 0) {
      const skipSummaries = skipped
        .map((r) => `- ${r.role} (${r.agentId})${r.error ? `: ${r.error}` : ""}`)
        .join("\n");
      sections.push(`## Skipped Agents\n${skipSummaries}`);
    }

    if (sections.length === 0) {
      return "No results were produced by any agent.";
    }

    return sections.join("\n\n");
  }

  /**
   * Mark all agents as skipped. Used for unknown modes.
   */
  private skipAllAgents(reason: string): WorkflowAgentResult[] {
    return this.input.agents.map((agent) => ({
      agentId: agent.id,
      role: agent.role,
      status: "skipped" as const,
      output: "",
      duration: 0,
      error: reason,
    }));
  }

  /**
   * For pipeline mode: mark any agents that come after the last result as
   * skipped.
   */
  private skipRemaining(results: WorkflowAgentResult[]): void {
    const completedIds = new Set(results.map((r) => r.agentId));
    for (const agent of this.input.agents) {
      if (!completedIds.has(agent.id)) {
        results.push({
          agentId: agent.id,
          role: agent.role,
          status: "skipped",
          output: "",
          duration: 0,
          error: "Pipeline stopped before this agent could run.",
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Event emitter
  // -----------------------------------------------------------------------

  private emit(event: WorkflowEvent): void {
    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch {
        // Swallow errors from event callbacks to avoid disrupting the workflow
      }
    }
  }
}
