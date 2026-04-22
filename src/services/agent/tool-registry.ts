// =============================================================================
// DeepAnalyze - Tool Registry
// =============================================================================
// Manages available tools for the agent system. Provides registration,
// lookup, filtering, and tool definition building for LLM function calling.
// =============================================================================

import type { AgentTool } from "./types.js";
import type { ToolDefinition } from "../../models/provider.js";

// ---------------------------------------------------------------------------
// Built-in tools
// ---------------------------------------------------------------------------

/**
 * A simple "think" tool that lets the agent reason without taking action.
 * Useful for planning and step-by-step reasoning before acting.
 */
const thinkTool: AgentTool = {
  name: "think",
  description:
    "逐步思考问题。在采取行动之前使用此工具来规划你的方法。" +
    "此工具不执行任何外部操作，只是记录你的推理过程供下一轮使用。",
  async execute(input: Record<string, unknown>) {
    return { thought: input.thought, recorded: true };
  },
  inputSchema: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "你的推理过程（使用与用户相同的语言）",
      },
    },
    required: ["thought"],
  },
};

/**
 * A "finish" tool that signals the agent has completed its task.
 * The agent should call this with its final answer when done.
 */
const finishTool: AgentTool = {
  name: "finish",
  description:
    "Signal that you have completed the task. Provide your final answer " +
    "or summary. This tells the orchestrator that no further action is needed.",
  async execute(input: Record<string, unknown>) {
    return { completed: true, summary: input.summary };
  },
  inputSchema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Your final answer or summary",
      },
    },
    required: ["summary"],
  },
};

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

/**
 * Registry that manages all available tools for agents. Tools can be
 * registered individually or in bulk, looked up by name, filtered, and
 * converted to LLM function calling definitions.
 */
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  constructor() {
    // Pre-register the built-in tools
    this.tools.set(thinkTool.name, thinkTool);
    this.tools.set(finishTool.name, finishTool);
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a single tool. If a tool with the same name already exists,
   * it will be replaced.
   */
  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools at once.
   */
  registerMany(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Unregister a tool by name.
   * Returns true if the tool was found and removed, false otherwise.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  // -----------------------------------------------------------------------
  // Lookup
  // -----------------------------------------------------------------------

  /**
   * Get a tool by name. Returns undefined if not found.
   */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool with the given name is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  // -----------------------------------------------------------------------
  // Filtering
  // -----------------------------------------------------------------------

  /**
   * Get tools filtered by their names. Supports wildcard "*" to return all tools.
   *
   * @param names - Array of tool names, or ["*"] for all tools.
   * @returns Array of matching tools.
   */
  filterByNames(names: string[]): AgentTool[] {
    // Wildcard returns all tools
    if (names.includes("*")) {
      return this.getAll();
    }

    const result: AgentTool[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) {
        result.push(tool);
      }
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Tool definition building for LLM function calling
  // -----------------------------------------------------------------------

  /**
   * Build tool definitions suitable for LLM function calling.
   * If names is provided, only include those tools. Otherwise include all.
   * Returns ToolDefinition[] compatible with ChatOptions.tools.
   *
   * @param names - Optional array of tool names to include.
   * @returns Array of tool definitions for the model's tool use parameter.
   */
  buildToolDefinitions(names?: string[]): ToolDefinition[] {
    const tools = names ? this.filterByNames(names) : this.getAll();

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: `Input for ${tool.name}`,
          },
        },
        required: ["query"],
      },
    }));
  }
}
