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
      "运行多 Agent 工作流。提供 teamName 使用已保存的团队，" +
      "或提供内联 Agent 数组。工作流以指定模式运行" +
      "（pipeline | graph | council | parallel）并返回汇总结果。",

    inputSchema: {
      type: "object",
      properties: {
        teamName: {
          type: "string",
          description:
            "要加载的已保存团队名称。如果提供，agents 字段将被忽略。",
        },
        mode: {
          type: "string",
          enum: ["pipeline", "graph", "council", "parallel"],
          description: "工作流调度模式。",
        },
        goal: {
          type: "string",
          description: "工作流的高层目标或问题。",
        },
        crossReview: {
          type: "boolean",
          description:
            "是否运行交叉审查轮（仅 council 模式）。默认：false。",
        },
        agents: {
          type: "array",
          description:
            "内联 Agent 定义。提供 teamName 时忽略此字段。",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "工作流内的唯一 Agent 标识符。" },
              role: { type: "string", description: "角色名称。" },
              systemPrompt: { type: "string", description: "可选的系统提示词覆盖。" },
              task: { type: "string", description: "任务指令。" },
              perspective: { type: "string", description: "视角提示（council 模式）。" },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description: "此 Agent 依赖的 Agent ID 列表（graph 模式）。",
              },
              condition: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["output_contains", "output_not_contains"] },
                  node: { type: "string" },
                  text: { type: "string" },
                },
                description: "条件执行（graph 模式）。",
              },
              tools: {
                type: "array",
                items: { type: "string" },
                description: "工具名称列表。使用 ['*'] 表示所有工具。",
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
        const team = await teamManager.getTeamByName(teamName);
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
