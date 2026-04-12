// =============================================================================
// DeepAnalyze - Agent Orchestrator
// =============================================================================
// Manages parallel agent dispatch, task tracking in the database, result
// collection, coordinated workflows (coordinator pattern), and auto-dream
// triggering after completed runs.
// =============================================================================

import { randomUUID } from "node:crypto";
import { ModelRouter } from "../../models/router.js";
import { AgentRunner } from "./agent-runner.js";
import { AutoDreamManager } from "./auto-dream.js";
import type {
  AgentEvent,
  AgentResult,
  AgentRunOptions,
  AgentStatus,
  AgentTask,
} from "./types.js";
import type { KnowledgeCompounder } from "../../wiki/knowledge-compound.js";
import type { Linker } from "../../wiki/linker.js";
import { DB } from "../../store/database.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single subtask within an orchestrated run. */
export interface SubTask {
  id: string;
  agentType: string;
  input: string;
  status: AgentStatus;
  result: AgentResult | null;
  error: string | null;
}

/** The result of an orchestrated multi-agent run. */
export interface OrchestratorResult {
  /** The parent task ID. */
  taskId: string;
  /** All subtasks that were dispatched. */
  subTasks: SubTask[];
  /** Synthesized summary of all subtask results. */
  synthesis: string;
  /** Overall status: "completed" = all succeeded, "partial" = some failed, "failed" = all failed. */
  status: "completed" | "partial" | "failed";
  /** Aggregated token usage across all subtasks. */
  totalUsage: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Manages multi-agent orchestration: single runs, parallel dispatch, and
 * coordinator-driven workflows. Tracks all tasks in the agent_tasks DB table.
 * Triggers auto-dream after successful runs when gating conditions are met.
 */
export class Orchestrator {
  private runner: AgentRunner;
  private modelRouter: ModelRouter;
  private autoDream: AutoDreamManager | null;
  private activeControllers: Map<string, AbortController> = new Map();

  constructor(
    runner: AgentRunner,
    modelRouter: ModelRouter,
    compounder?: KnowledgeCompounder,
    linker?: Linker,
  ) {
    this.runner = runner;
    this.modelRouter = modelRouter;

    // Initialize AutoDreamManager if both compounder and linker are provided
    if (compounder && linker) {
      this.autoDream = new AutoDreamManager(modelRouter, compounder, linker);
    } else {
      this.autoDream = null;
    }
  }

  // -----------------------------------------------------------------------
  // Single task execution
  // -----------------------------------------------------------------------

  /**
   * Run a single agent task and track it in the database.
   * This is the simplest form of orchestration -- one agent, one task.
   * After completion, may trigger auto-dream if conditions are met.
   */
  async runSingle(options: AgentRunOptions): Promise<AgentResult> {
    const taskId = randomUUID();
    const agentType = options.agentType ?? "general";

    // Record the task as pending in the database
    this.recordTask({
      id: taskId,
      agentType,
      status: "pending",
      input: options.input,
      parentId: options.parentTaskId ?? null,
      sessionId: options.sessionId ?? null,
    });

    // Create an AbortController for this task
    const controller = new AbortController();
    this.activeControllers.set(taskId, controller);

    // Update status to running
    this.updateTaskStatus(taskId, "running");

    // Forward the abort signal through the options
    const runOptions: AgentRunOptions = {
      ...options,
      agentType,
      signal: controller.signal,
    };

    try {
      const result = await this.runner.run(runOptions);

      // Store the result
      this.updateTaskStatus(taskId, "completed", result.output);

      // Trigger auto-dream asynchronously (fire-and-forget)
      this.maybeTriggerAutoDream(options.sessionId);

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.updateTaskStatus(taskId, "failed", undefined, errorMsg);

      // Return a failed result
      return {
        taskId,
        output: `Agent failed: ${errorMsg}`,
        toolCallsCount: 0,
        turnsUsed: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    } finally {
      this.activeControllers.delete(taskId);
    }
  }

  // -----------------------------------------------------------------------
  // Parallel task execution
  // -----------------------------------------------------------------------

  /**
   * Run multiple agents in parallel and collect all results.
   * Creates a parent task record in the DB, then runs each subtask with
   * Promise.allSettled so one failure does not crash the whole batch.
   */
  async runParallel(
    tasks: Array<{ agentType: string; input: string }>,
    options?: {
      sessionId?: string;
      parentTaskId?: string;
      onEvent?: (event: AgentEvent) => void;
    },
  ): Promise<OrchestratorResult> {
    const parentTaskId = options?.parentTaskId ?? randomUUID();

    // Record the parent task
    this.recordTask({
      id: parentTaskId,
      agentType: "coordinator",
      status: "running",
      input: `Parallel run with ${tasks.length} subtasks`,
      parentId: options?.parentTaskId ?? null,
      sessionId: options?.sessionId ?? null,
    });

    // Build subtask descriptors
    const subTasks: SubTask[] = tasks.map((task) => ({
      id: randomUUID(),
      agentType: task.agentType,
      input: task.input,
      status: "pending" as AgentStatus,
      result: null,
      error: null,
    }));

    // Record each subtask in the database
    for (const st of subTasks) {
      this.recordTask({
        id: st.id,
        agentType: st.agentType,
        status: "pending",
        input: st.input,
        parentId: parentTaskId,
        sessionId: options?.sessionId ?? null,
      });
    }

    // Create AbortControllers for each subtask
    const controllers: AbortController[] = [];
    for (const st of subTasks) {
      const controller = new AbortController();
      this.activeControllers.set(st.id, controller);
      controllers.push(controller);
    }

    // Run all subtasks in parallel using Promise.allSettled
    const runPromises = subTasks.map((st, i) => {
      const controller = controllers[i];

      // Update status to running
      this.updateTaskStatus(st.id, "running");

      return this.runner.run({
        input: st.input,
        agentType: st.agentType,
        parentTaskId: parentTaskId,
        sessionId: options?.sessionId,
        signal: controller.signal,
        onEvent: options?.onEvent,
      });
    });

    const settled = await Promise.allSettled(runPromises);

    // Process results
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let completedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      const st = subTasks[i];

      // Clean up the AbortController
      this.activeControllers.delete(st.id);

      if (outcome.status === "fulfilled") {
        st.status = "completed";
        st.result = outcome.value;
        this.updateTaskStatus(st.id, "completed", outcome.value.output);

        totalInputTokens += outcome.value.usage.inputTokens;
        totalOutputTokens += outcome.value.usage.outputTokens;
        completedCount++;
      } else {
        const errorMsg =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        st.status = "failed";
        st.error = errorMsg;
        this.updateTaskStatus(st.id, "failed", undefined, errorMsg);
        failedCount++;
      }
    }

    // Determine overall status
    let overallStatus: "completed" | "partial" | "failed";
    if (failedCount === 0) {
      overallStatus = "completed";
    } else if (completedCount === 0) {
      overallStatus = "failed";
    } else {
      overallStatus = "partial";
    }

    // Synthesize results
    const synthesis = this.synthesizeResults(subTasks);

    // Update parent task
    this.updateTaskStatus(parentTaskId, overallStatus === "failed" ? "failed" : "completed", synthesis);

    // Trigger auto-dream asynchronously
    this.maybeTriggerAutoDream(options?.sessionId);

    return {
      taskId: parentTaskId,
      subTasks,
      synthesis,
      status: overallStatus,
      totalUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }

  // -----------------------------------------------------------------------
  // Coordinator-driven workflow
  // -----------------------------------------------------------------------

  /**
   * Run a coordinator-driven analysis workflow.
   * 1. The coordinator agent plans the work (breaks input into subtasks).
   * 2. Identified subtasks are dispatched (possibly in parallel).
   * 3. Results are synthesized into a final output.
   */
  async runCoordinated(
    input: string,
    options?: {
      sessionId?: string;
      onEvent?: (event: AgentEvent) => void;
    },
  ): Promise<OrchestratorResult> {
    const parentTaskId = randomUUID();

    // Record the parent task
    this.recordTask({
      id: parentTaskId,
      agentType: "coordinator",
      status: "running",
      input: input,
      parentId: null,
      sessionId: options?.sessionId ?? null,
    });

    // Step 1: Run the coordinator agent to plan the work
    const coordinatorResult = await this.runSingle({
      input,
      agentType: "coordinator",
      parentTaskId,
      sessionId: options?.sessionId,
      onEvent: options?.onEvent,
    });

    // Step 2: Parse subtasks from the coordinator's output
    const parsedTasks = this.parseSubtasks(coordinatorResult.output);

    // If no subtasks could be parsed, treat the coordinator output as the
    // final result and return a completed orchestrator result.
    if (parsedTasks.length === 0) {
      this.updateTaskStatus(parentTaskId, "completed", coordinatorResult.output);

      return {
        taskId: parentTaskId,
        subTasks: [
          {
            id: coordinatorResult.taskId,
            agentType: "coordinator",
            input: input,
            status: "completed",
            result: coordinatorResult,
            error: null,
          },
        ],
        synthesis: coordinatorResult.output,
        status: "completed",
        totalUsage: {
          inputTokens: coordinatorResult.usage.inputTokens,
          outputTokens: coordinatorResult.usage.outputTokens,
        },
      };
    }

    // Step 3: Run all parsed subtasks in parallel
    const parallelResult = await this.runParallel(parsedTasks, {
      sessionId: options?.sessionId,
      parentTaskId,
      onEvent: options?.onEvent,
    });

    // Step 4: The synthesis from runParallel is already computed.
    // Include the coordinator task in the subtask list for completeness.
    const allSubTasks: SubTask[] = [
      {
        id: coordinatorResult.taskId,
        agentType: "coordinator",
        input: input,
        status: "completed",
        result: coordinatorResult,
        error: null,
      },
      ...parallelResult.subTasks,
    ];

    // Aggregate usage including the coordinator call
    const totalUsage = {
      inputTokens:
        coordinatorResult.usage.inputTokens + parallelResult.totalUsage.inputTokens,
      outputTokens:
        coordinatorResult.usage.outputTokens + parallelResult.totalUsage.outputTokens,
    };

    // Update parent task with final synthesis
    this.updateTaskStatus(parentTaskId, parallelResult.status === "failed" ? "failed" : "completed", parallelResult.synthesis);

    return {
      taskId: parentTaskId,
      subTasks: allSubTasks,
      synthesis: parallelResult.synthesis,
      status: parallelResult.status,
      totalUsage,
    };
  }

  // -----------------------------------------------------------------------
  // Cancellation
  // -----------------------------------------------------------------------

  /**
   * Cancel a running task by ID. Aborts the associated AbortController.
   * Returns true if a controller was found and aborted, false otherwise.
   */
  cancel(taskId: string): boolean {
    const controller = this.activeControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(taskId);
      this.updateTaskStatus(taskId, "cancelled");
      return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Task status queries
  // -----------------------------------------------------------------------

  /**
   * Get the status of a task from the database.
   * Returns null if the task is not found.
   */
  getTaskStatus(taskId: string): AgentTask | null {
    const db = DB.getInstance().raw;
    const row = db
      .prepare("SELECT * FROM agent_tasks WHERE id = ?")
      .get(taskId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return this.rowToAgentTask(row);
  }

  /**
   * List all tasks for a given session, ordered by creation time (newest first).
   */
  listSessionTasks(sessionId: string): AgentTask[] {
    const db = DB.getInstance().raw;
    const rows = db
      .prepare(
        "SELECT * FROM agent_tasks WHERE session_id = ? ORDER BY created_at DESC",
      )
      .all(sessionId) as Record<string, unknown>[];

    return rows.map((row) => this.rowToAgentTask(row));
  }

  // -----------------------------------------------------------------------
  // Private helpers - Auto-dream trigger
  // -----------------------------------------------------------------------

  /**
   * Trigger auto-dream asynchronously if conditions are met.
   * Does not block the caller — runs in the background.
   */
  private maybeTriggerAutoDream(sessionId?: string | null): void {
    if (!this.autoDream) return;

    // Increment session count
    this.autoDream.incrementSessionCount();

    // Check gates asynchronously
    if (this.autoDream.shouldDream()) {
      // Fire-and-forget — don't block the API response
      this.autoDream.dream().catch((err) => {
        console.warn(
          "[Orchestrator] Auto-dream failed:",
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers - Database operations
  // -----------------------------------------------------------------------

  /**
   * Insert a new task record into the agent_tasks table.
   */
  private recordTask(task: {
    id: string;
    agentType: string;
    status: AgentStatus;
    input: string;
    parentId: string | null;
    sessionId: string | null;
  }): void {
    const db = DB.getInstance().raw;

    db.prepare(
      `INSERT INTO agent_tasks (id, parent_task_id, session_id, agent_type, status, input, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      task.id,
      task.parentId,
      task.sessionId,
      task.agentType,
      task.status,
      task.input,
    );
  }

  /**
   * Update the status, output, and error fields of an existing task.
   */
  private updateTaskStatus(
    id: string,
    status: AgentStatus,
    output?: string,
    error?: string,
  ): void {
    const db = DB.getInstance().raw;

    if (status === "completed" || status === "failed" || status === "cancelled") {
      db.prepare(
        `UPDATE agent_tasks
         SET status = ?, output = ?, error = ?, completed_at = datetime('now')
         WHERE id = ?`,
      ).run(
        status,
        output ?? null,
        error ?? null,
        id,
      );
    } else {
      db.prepare(
        `UPDATE agent_tasks SET status = ? WHERE id = ?`,
      ).run(status, id);
    }
  }

  /**
   * Convert a database row to an AgentTask object.
   */
  private rowToAgentTask(row: Record<string, unknown>): AgentTask {
    return {
      id: row.id as string,
      agentType: row.agent_type as string,
      status: (row.status as AgentStatus) ?? "pending",
      input: (row.input as string) ?? "",
      output: (row.output as string) ?? null,
      error: (row.error as string) ?? null,
      parentId: (row.parent_task_id as string) ?? null,
      sessionId: (row.session_id as string) ?? null,
      createdAt: (row.created_at as string) ?? new Date().toISOString(),
      completedAt: (row.completed_at as string) ?? null,
      progress: [],
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers - Subtask parsing
  // -----------------------------------------------------------------------

  /**
   * Parse subtask descriptions from the coordinator agent's output.
   * Tries JSON first (from a fenced code block), then falls back to a
   * numbered/bulleted list pattern.
   */
  private parseSubtasks(
    coordinatorOutput: string,
  ): Array<{ agentType: string; input: string }> {
    // Strategy 1: Try to find a JSON code block
    const jsonBlockMatch = coordinatorOutput.match(
      /```json\s*\n([\s\S]*?)\n```/,
    );
    if (jsonBlockMatch) {
      const parsed = this.tryParseJsonSubtasks(jsonBlockMatch[1]);
      if (parsed.length > 0) return parsed;
    }

    // Strategy 2: Try to find any JSON object in the output
    const jsonObjectMatch = coordinatorOutput.match(/\{[\s\S]*"subtasks"[\s\S]*\}/);
    if (jsonObjectMatch) {
      const parsed = this.tryParseJsonSubtasks(jsonObjectMatch[0]);
      if (parsed.length > 0) return parsed;
    }

    // Strategy 3: Parse numbered list with agent type in brackets
    return this.parseListSubtasks(coordinatorOutput);
  }

  /**
   * Attempt to parse a JSON string into subtask descriptors.
   */
  private tryParseJsonSubtasks(
    jsonStr: string,
  ): Array<{ agentType: string; input: string }> {
    try {
      const obj = JSON.parse(jsonStr);
      if (obj && typeof obj === "object" && Array.isArray(obj.subtasks)) {
        const tasks: Array<{ agentType: string; input: string }> = [];
        for (const item of obj.subtasks) {
          if (item && typeof item === "object" && typeof item.input === "string") {
            const agentType =
              typeof item.agentType === "string" ? item.agentType : "explore";
            tasks.push({ agentType, input: item.input });
          }
        }
        return tasks;
      }
    } catch {
      // JSON parse failed; fall through to list parsing
    }
    return [];
  }

  /**
   * Parse a numbered/bulleted list of subtasks from text.
   */
  private parseListSubtasks(
    text: string,
  ): Array<{ agentType: string; input: string }> {
    const tasks: Array<{ agentType: string; input: string }> = [];
    const knownTypes = ["explore", "compile", "verify", "report", "general"];

    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const listMatch = trimmed.match(
        /^(?:\d+[.)]\s*|[-*]\s+)(.+)$/,
      );
      if (!listMatch) continue;

      const content = listMatch[1].trim();

      // Try to extract agent type from brackets: [explore]
      const bracketMatch = content.match(
        /^\[([a-zA-Z_]+)\]\s*(.+)$/,
      );
      if (bracketMatch) {
        const rawType = bracketMatch[1].toLowerCase();
        const agentType = knownTypes.includes(rawType) ? rawType : "explore";
        const input = bracketMatch[2].trim();
        if (input) {
          tasks.push({ agentType, input });
        }
        continue;
      }

      // Try to extract agent type from prefix: "explore: ..." or "explore - ..."
      const prefixMatch = content.match(
        /^([a-zA-Z_]+)\s*[:\-]\s*(.+)$/,
      );
      if (prefixMatch) {
        const rawType = prefixMatch[1].toLowerCase();
        if (knownTypes.includes(rawType)) {
          const input = prefixMatch[2].trim();
          if (input) {
            tasks.push({ agentType: rawType, input });
          }
          continue;
        }
      }

      // If no agent type detected but the line looks like a task description,
      // default to "explore" agent type.
      if (content.length > 10) {
        tasks.push({ agentType: "explore", input: content });
      }
    }

    return tasks;
  }

  // -----------------------------------------------------------------------
  // Private helpers - Result synthesis
  // -----------------------------------------------------------------------

  /**
   * Synthesize results from multiple subtasks into a single summary string.
   */
  private synthesizeResults(subTasks: SubTask[]): string {
    const sections: string[] = [];

    const successful = subTasks.filter((st) => st.status === "completed");
    const failed = subTasks.filter((st) => st.status === "failed");

    if (successful.length > 0) {
      for (let i = 0; i < successful.length; i++) {
        const st = successful[i];
        if (st.result && st.result.output) {
          sections.push(
            `--- Subtask ${i + 1} (${st.agentType}) ---\n${st.result.output}`,
          );
        }
      }
    }

    if (failed.length > 0) {
      const failureSummaries = failed
        .map(
          (st) =>
            `- ${st.agentType}: ${st.error ?? "Unknown error"}`,
        )
        .join("\n");
      sections.push(`--- Failed Subtasks ---\n${failureSummaries}`);
    }

    if (sections.length === 0) {
      return "No results were produced by any subtask.";
    }

    return sections.join("\n\n");
  }
}
