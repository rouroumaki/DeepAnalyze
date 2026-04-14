// =============================================================================
// DeepAnalyze - workflow_run Agent Tool
// =============================================================================
// An AgentTool that allows an agent to autonomously create and execute
// multi-agent workflows. It resolves teams by name from the AgentTeamManager
// or accepts inline agent definitions, then delegates execution to the
// WorkflowEngine.
// =============================================================================

import { randomUUID } from "node:crypto";
import { AgentTeamManager } from "../agent-team-manager.js";
import { WorkflowEngine } from "../workflow-engine.js";
import type { WorkflowAgent, WorkflowMode, WorkflowEvent, WorkflowResult } from "../workflow-engine.js";
import type { AgentTool } from "../types.js";
import type { AgentRunner } from "../agent-runner.js";
import type { ToolRegistry } from "../tool-registry.js";

// ---------------------------------------------------------------------------
// Context needed by the tool
// ---------------------------------------------------------------------------

/**
 * External references that the workflow_run tool needs to operate.
 * These are typically passed in during tool registration.
 */
export interface WorkflowRunContext {
  /** The AgentRunner used to execute individual agents. */
  runner: AgentRunner;
  /** The ToolRegistry for resolving tool names. */
  toolRegistry: ToolRegistry;
  /** Optional event callback for real-time progress reporting. */
  onEvent?: (event: WorkflowEvent) => void;
}

// ---------------------------------------------------------------------------
// Inline agent schema type (what the LLM sends)
// ---------------------------------------------------------------------------

/** Shape of an inline agent as provided by the calling LLM. */
interface InlineAgent {
  /** Unique identifier within this workflow. */
  id: string;
  /** Role name (e.g. "researcher"). */
  role: string;
  /** Optional system prompt override. */
  systemPrompt?: string;
  /** Task instruction. */
  task: string;
  /** Perspective hint for council mode. */
  perspective?: string;
  /** Agent IDs this agent depends on (graph mode). */
  dependsOn?: string[];
  /** Conditional execution (graph mode). */
  condition?: {
    type: "output_contains" | "output_not_contains";
    node: string;
    text: string;
  };
  /** Tool names. Use ["*"] for all. Defaults to ["*"]. */
  tools?: string[];
}

// ---------------------------------------------------------------------------
// workflow_run tool
// ---------------------------------------------------------------------------

/**
 * Create the `workflow_run` agent tool.
 *
 * This tool lets an agent spawn a multi-agent workflow either by referencing
 * a persisted team name or by providing an inline agent array.
 *
 * @param ctx - External references (runner, toolRegistry, optional event callback).
 * @returns An AgentTool instance named "workflow_run".
 */
export function createWorkflowRunTool(ctx: WorkflowRunContext): AgentTool {
  const teamManager = new AgentTeamManager();

  return {
    name: "workflow_run",

    description:
      "Run a multi-agent workflow. Provide a teamName to use a saved team, " +
      "or provide an inline agents array. The workflow runs in the specified " +
      "mode (pipeline | graph | council | parallel) and returns aggregated results.",

    inputSchema: {
      type: "object",
      properties: {
        teamName: {
          type: "string",
          description:
            "Name of a saved team to load. If provided, the agents field is ignored.",
        },
        mode: {
          type: "string",
          enum: ["pipeline", "graph", "council", "parallel"],
          description: "Workflow scheduling mode.",
        },
        goal: {
          type: "string",
          description: "High-level goal or question for the workflow.",
        },
        crossReview: {
          type: "boolean",
          description:
            "Whether to run a cross-review round (council mode only). Default: false.",
        },
        agents: {
          type: "array",
          description:
            "Inline agent definitions. Ignored when teamName is provided.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique agent identifier within the workflow." },
              role: { type: "string", description: "Role name." },
              systemPrompt: { type: "string", description: "Optional system prompt override." },
              task: { type: "string", description: "Task instruction." },
              perspective: { type: "string", description: "Perspective hint (council mode)." },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description: "IDs of agents this one depends on (graph mode).",
              },
              condition: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["output_contains", "output_not_contains"] },
                  node: { type: "string" },
                  text: { type: "string" },
                },
                description: "Conditional execution (graph mode).",
              },
              tools: {
                type: "array",
                items: { type: "string" },
                description: "Tool names. Use ['*'] for all tools.",
              },
            },
            required: ["id", "role", "task"],
          },
        },
      },
      required: ["mode", "goal"],
    },

    async execute(input: Record<string, unknown>): Promise<WorkflowResult> {
      const mode = input.mode as WorkflowMode;
      const goal = input.goal as string;
      const teamName = input.teamName as string | undefined;
      const crossReview = (input.crossReview as boolean) ?? false;
      const inlineAgents = input.agents as InlineAgent[] | undefined;

      // -------------------------------------------------------------------
      // Resolve agents: from team name or inline definitions
      // -------------------------------------------------------------------
      let workflowAgents: WorkflowAgent[];
      let resolvedTeamName: string;
      let resolvedCrossReview = crossReview;

      if (teamName) {
        // Load team from the store
        const team = teamManager.getTeamByName(teamName);
        if (!team) {
          throw new Error(`Team not found: "${teamName}"`);
        }

        resolvedTeamName = team.name;
        resolvedCrossReview = crossReview || team.crossReview;

        // Map stored members to WorkflowAgent shape
        workflowAgents = team.members.map((member) => ({
          id: member.id,
          role: member.role,
          systemPrompt: member.systemPrompt,
          task: member.task,
          perspective: member.perspective,
          dependsOn: member.dependsOn,
          condition: member.condition as WorkflowAgent["condition"],
          tools: member.tools,
        }));
      } else if (inlineAgents && inlineAgents.length > 0) {
        // Use inline definitions
        resolvedTeamName = "inline";

        workflowAgents = inlineAgents.map((a) => ({
          id: a.id,
          role: a.role,
          systemPrompt: a.systemPrompt,
          task: a.task,
          perspective: a.perspective,
          dependsOn: a.dependsOn,
          condition: a.condition,
          tools: a.tools ?? ["*"],
        }));
      } else {
        throw new Error(
          "Either 'teamName' or 'agents' must be provided to workflow_run.",
        );
      }

      // -------------------------------------------------------------------
      // Determine effective mode
      // -------------------------------------------------------------------
      const effectiveMode: WorkflowMode = mode;

      // -------------------------------------------------------------------
      // Build and execute the workflow
      // -------------------------------------------------------------------
      const workflowId = randomUUID();

      const engine = new WorkflowEngine(
        {
          workflowId,
          teamName: resolvedTeamName,
          mode: effectiveMode,
          goal,
          agents: workflowAgents,
          crossReview: resolvedCrossReview,
        },
        ctx.runner,
        ctx.toolRegistry,
        ctx.onEvent,
      );

      const result = await engine.execute();

      return result;
    },
  };
}
