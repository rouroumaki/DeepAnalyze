// =============================================================================
// DeepAnalyze - Tool Registry
// =============================================================================
// Manages available tools for the agent system. Provides registration,
// lookup, filtering, and tool definition building for LLM function calling.
// =============================================================================

import type { AgentTool } from "./types.js";
import type { ToolDefinition } from "../../models/provider.js";

// ---------------------------------------------------------------------------
// Deferred tool configuration
// ---------------------------------------------------------------------------

/**
 * Tools that are loaded lazily to save input tokens.
 * These tools are registered but not included in the initial tool definitions
 * sent to the model. The model can discover them via the tool_discover tool.
 */
export const DEFERRED_TOOLS = new Set([
  "tts_generate",
  "image_generate",
  "video_generate",
  "music_generate",
  "browser",
  "timeline_build",
]);

/** Tools that are always included in the initial tool definitions (core tools). */
export const CORE_TOOLS: Set<string> | null = null; // null means "all non-deferred"

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
    "Signal that you have FULLY completed the task. Provide your final answer " +
    "or summary. This tells the orchestrator that no further action is needed. " +
    "IMPORTANT: Only call finish when you have thoroughly completed all aspects of the task. " +
    "If you have only done partial analysis, found some but not all documents, or " +
    "haven't yet synthesized a complete answer, continue working instead of calling finish. " +
    "Premature finish is worse than taking more turns to do thorough work.",
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
  /** Shared context that tools can read at execution time. Set per-request by the route handler. */
  private _executionContext: Record<string, unknown> = {};

  constructor() {
    // Pre-register the built-in tools
    this.tools.set(thinkTool.name, thinkTool);
    this.tools.set(finishTool.name, finishTool);
  }

  /** Set execution context for the current request (taskId, sendEvent, etc.) */
  setExecutionContext(ctx: Record<string, unknown>): void {
    this._executionContext = ctx;
  }

  /** Get the current execution context */
  getExecutionContext(): Record<string, unknown> {
    return this._executionContext;
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
   * If names is provided, only include those tools. Otherwise include all
   * non-deferred tools (deferred tools can be discovered via tool_discover).
   * Returns ToolDefinition[] compatible with ChatOptions.tools.
   *
   * @param names - Optional array of tool names to include. Use ["*"] for all.
   * @param includeDeferred - If true, include deferred tools. Default: false.
   * @returns Array of tool definitions for the model's tool use parameter.
   */
  buildToolDefinitions(names?: string[], includeDeferred = false): ToolDefinition[] {
    let tools: AgentTool[];

    if (names && names.includes("*")) {
      // Wildcard: return all tools (respecting deferred flag)
      tools = this.getAll().filter(t => includeDeferred || !DEFERRED_TOOLS.has(t.name));
    } else if (names) {
      tools = this.filterByNames(names);
    } else {
      // No names specified: return all non-deferred tools
      tools = this.getAll().filter(t => includeDeferred || !DEFERRED_TOOLS.has(t.name));
    }

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
