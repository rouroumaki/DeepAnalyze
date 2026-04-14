// =============================================================================
// DeepAnalyze - Workflow Engine
// =============================================================================
// Multi-agent workflow execution engine supporting 4 scheduling modes:
//   - Pipeline: sequential with accumulated context
//   - Graph (DAG): dependency-based with parallel ready nodes
//   - Council: parallel analysis + optional cross-review
//   - Parallel: all agents run concurrently
// =============================================================================

import type { AgentRunner } from "./agent-runner.js";
import type { AgentResult as RunnerAgentResult } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";

// ---------------------------------------------------------------------------
// Workflow types
// ---------------------------------------------------------------------------

/** Supported workflow scheduling modes. */
export type WorkflowMode = "pipeline" | "graph" | "council" | "parallel";

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
  status: "completed" | "partial" | "failed";
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
}

export interface WorkflowAgentToolCallEvent {
  type: "workflow_agent_tool_call";
  workflowId: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface WorkflowAgentToolResultEvent {
  type: "workflow_agent_tool_result";
  workflowId: string;
  agentId: string;
  toolName: string;
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
    });

    let agentResults: WorkflowAgentResult[];

    switch (this.input.mode) {
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

    return {
      workflowId: this.input.workflowId,
      status,
      agentResults,
      synthesis,
      totalDuration,
    };
  }

  // -----------------------------------------------------------------------
  // Pipeline mode
  // -----------------------------------------------------------------------

  /**
   * Sequential execution with accumulated context. Each agent receives all
   * prior outputs. Stops on the first failure.
   */
  private async executePipeline(): Promise<WorkflowAgentResult[]> {
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
    const agents = this.input.agents;

    // Cycle detection
    this.detectCycles(agents);

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

      // Run ready nodes in parallel
      const runPromises = readyNodes.map((agent) => {
        const deps = agent.dependsOn ?? [];
        const contextMessages = this.buildDepContextMessages(deps, stateMap);
        return this.runAgent(agent, contextMessages);
      });

      const settled = await Promise.allSettled(runPromises);

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
    const agents = this.input.agents;

    // Round 1: parallel analysis
    const round1Promises = agents.map((agent) => {
      const perspective = agent.perspective
        ? `\n\nYour perspective: ${agent.perspective}`
        : "";
      const augmentedTask = `${agent.task}${perspective}\n\nOverall goal: ${this.input.goal}`;

      return this.runAgent(agent, [], augmentedTask);
    });

    const round1Settled = await Promise.allSettled(round1Promises);
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

    // Round 2: cross-review
    const round2Results: WorkflowAgentResult[] = [];

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const round1Result = round1Results[i];

      // Skip agents that failed in round 1
      if (round1Result.status !== "completed") {
        round2Results.push(round1Result);
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
        round2Results.push(round1Result);
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

      const result = await this.runAgent(agent, contextMessages);
      round2Results.push(result);
    }

    return round2Results;
  }

  // -----------------------------------------------------------------------
  // Parallel mode
  // -----------------------------------------------------------------------

  /**
   * All agents run in parallel. Results are synthesized.
   */
  private async executeParallel(): Promise<WorkflowAgentResult[]> {
    const agents = this.input.agents;

    const runPromises = agents.map((agent) => this.runAgent(agent));
    const settled = await Promise.allSettled(runPromises);

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
   * events and timing.
   */
  private async runAgent(
    agent: WorkflowAgent,
    contextMessages?: Array<{ role: "user" | "assistant"; content: string }>,
    taskOverride?: string,
  ): Promise<WorkflowAgentResult> {
    const startTime = Date.now();

    this.emit({
      type: "workflow_agent_start",
      workflowId: this.input.workflowId,
      agentId: agent.id,
      role: agent.role,
    });

    try {
      const runnerResult: RunnerAgentResult = await this.runner.run({
        input: taskOverride ?? agent.task,
        agentType: "general",
        systemPromptOverride: agent.systemPrompt,
        toolsOverride: agent.tools,
        contextMessages,
        onEvent: (event) => this.forwardAgentEvent(agent.id, event),
      });

      const duration = Date.now() - startTime;
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
      const errorMsg = err instanceof Error ? err.message : String(err);

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
        });
        break;

      case "tool_call":
        this.emit({
          type: "workflow_agent_tool_call",
          workflowId: this.input.workflowId,
          agentId,
          toolName: event.toolName,
          input: event.input,
        });
        break;

      case "tool_result":
        this.emit({
          type: "workflow_agent_tool_result",
          workflowId: this.input.workflowId,
          agentId,
          toolName: event.toolName,
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
          content: `[Output from ${state.agent.role} (${depId})]:\n${state.result.output}`,
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
          `Here is the context from previous agents in this workflow:\n\n` +
          accumulated.join("\n\n"),
      },
    ];
  }

  // -----------------------------------------------------------------------
  // Result helpers
  // -----------------------------------------------------------------------

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
