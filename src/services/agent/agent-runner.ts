// =============================================================================
// DeepAnalyze - Agent Runner
// =============================================================================
// Core agent execution engine. Implements a TAOR (Think-Act-Observe-Reflect)
// loop that uses ModelRouter for LLM calls and ToolRegistry for tool execution.
//
// This module does NOT import anything from the broken Claude Code copy.
// It exclusively uses our own ModelRouter and ToolRegistry.
// =============================================================================

import { randomUUID } from "node:crypto";
import { ModelRouter } from "../../models/router.js";
import { ToolRegistry } from "./tool-registry.js";
import type {
  AgentDefinition,
  AgentRunOptions,
  AgentResult,
  AgentEvent,
  AgentProgressEntry,
} from "./types.js";
import type {
  ChatMessage,
  ChatResponse,
  ToolCall,
} from "../../models/provider.js";

// ---------------------------------------------------------------------------
// Default agent definition (used when no agent type is specified)
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_DEFINITION: AgentDefinition = {
  agentType: "general",
  description: "General-purpose agent for any task",
  systemPrompt:
    "You are a helpful AI assistant. Analyze the user's request carefully " +
    "and use available tools as needed to accomplish the task. " +
    "When you have completed the task, call the 'finish' tool with your final answer.",
  tools: ["*"],
  modelRole: "main",
  maxTurns: 20,
  readOnly: false,
};

// ---------------------------------------------------------------------------
// AgentRunner
// ---------------------------------------------------------------------------

/**
 * Core agent execution engine. Manages agent definitions and runs the
 * TAOR (Think-Act-Observe-Reflect) loop for each task.
 */
export class AgentRunner {
  private modelRouter: ModelRouter;
  private toolRegistry: ToolRegistry;
  private agentDefinitions = new Map<string, AgentDefinition>();

  constructor(modelRouter: ModelRouter, toolRegistry: ToolRegistry) {
    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;

    // Register the default "general" agent
    this.registerAgent(DEFAULT_AGENT_DEFINITION);
  }

  // -----------------------------------------------------------------------
  // Agent definition management
  // -----------------------------------------------------------------------

  /**
   * Register an agent definition. If one with the same agentType already
   * exists, it will be replaced.
   */
  registerAgent(definition: AgentDefinition): void {
    this.agentDefinitions.set(definition.agentType, definition);
  }

  /**
   * Register multiple agent definitions at once.
   */
  registerAgents(definitions: AgentDefinition[]): void {
    for (const definition of definitions) {
      this.agentDefinitions.set(definition.agentType, definition);
    }
  }

  /**
   * Get a registered agent definition by type. Returns undefined if not found.
   */
  getAgentDefinition(agentType: string): AgentDefinition | undefined {
    return this.agentDefinitions.get(agentType);
  }

  /**
   * Get all registered agent type names.
   */
  getAgentTypes(): string[] {
    return Array.from(this.agentDefinitions.keys());
  }

  // -----------------------------------------------------------------------
  // Main execution loop
  // -----------------------------------------------------------------------

  /**
   * Run an agent task. This is the main entry point.
   *
   * Executes the TAOR loop:
   *   1. Build initial messages from the agent definition and user input
   *   2. Send messages to the LLM via ModelRouter
   *   3. If the response contains tool calls, execute them
   *   4. Add assistant message + tool results to the conversation
   *   5. Repeat until done or max turns reached
   *
   * @param options - Execution options including the input prompt.
   * @returns The result of the agent execution.
   */
  async run(options: AgentRunOptions): Promise<AgentResult> {
    const taskId = randomUUID();
    const agentType = options.agentType ?? "general";

    // Resolve the agent definition
    let definition = this.agentDefinitions.get(agentType);
    if (!definition) {
      definition = DEFAULT_AGENT_DEFINITION;
    }

    // Resolve effective settings
    const maxTurns = options.maxTurns ?? definition.maxTurns ?? 20;
    const modelRole =
      options.modelRole ?? definition.modelRole ?? "main";
    const modelId = this.modelRouter.getDefaultModel(modelRole);

    // Build initial messages
    const messages = this.buildMessages(
      definition,
      options.input,
      options.contextMessages,
    );

    // Get the tools available to this agent
    const availableTools = this.toolRegistry.filterByNames(definition.tools);
    const toolDefs = this.toolRegistry.buildToolDefinitions(definition.tools);

    // Track execution state
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastAssistantContent = "";

    // Emit start event
    this.emitEvent(options.onEvent, {
      type: "start",
      taskId,
      agentType,
    });

    // -------------------------------------------------------------------
    // TAOR Loop
    // -------------------------------------------------------------------
    for (let turn = 0; turn < maxTurns; turn++) {
      // Check for cancellation
      if (options.signal?.aborted) {
        this.emitEvent(options.onEvent, { type: "cancelled", taskId });
        return {
          taskId,
          output: lastAssistantContent || "Task was cancelled.",
          toolCallsCount: totalToolCalls,
          turnsUsed: turn,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      // Call the model
      let response: ChatResponse;
      try {
        response = await this.modelRouter.chat(messages, {
          model: modelId,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          signal: options.signal,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Record error progress
        this.recordProgress(
          options.onEvent, taskId, turn, "error",
          `Model call failed: ${errorMsg}`,
        );

        this.emitEvent(options.onEvent, {
          type: "error",
          taskId,
          error: errorMsg,
        });

        return {
          taskId,
          output: lastAssistantContent || `Agent failed: ${errorMsg}`,
          toolCallsCount: totalToolCalls,
          turnsUsed: turn,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      // Track token usage
      if (response.usage) {
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      // Capture assistant content
      const assistantContent = response.content ?? "";
      if (assistantContent) {
        lastAssistantContent = assistantContent;
      }

      // Record text progress if there is content
      if (assistantContent) {
        this.recordProgress(
          options.onEvent, taskId, turn, "text", assistantContent,
        );
      }

      // Emit turn event
      this.emitEvent(options.onEvent, {
        type: "turn",
        taskId,
        turn,
        content: assistantContent,
      });

      // Build the assistant message for the conversation history
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantContent,
      };

      // Process tool calls if present
      const toolCalls = response.toolCalls;
      let agentCalledFinish = false;

      if (toolCalls && toolCalls.length > 0) {
        // Include tool calls in the assistant message
        assistantMessage.toolCalls = toolCalls;

        // Add assistant message to conversation
        messages.push(assistantMessage);

        // Execute each tool call
        for (const toolCall of toolCalls) {
          totalToolCalls++;

          // Check if this is a "finish" call
          if (toolCall.function.name === "finish") {
            agentCalledFinish = true;
          }

          // Execute the tool and get the result message
          const toolResultMessage = await this.executeToolCall(
            toolCall,
            taskId,
            turn,
            options.onEvent,
          );

          // Add tool result to conversation
          messages.push(toolResultMessage);
        }
      } else {
        // No tool calls - add assistant message and check if done
        messages.push(assistantMessage);
      }

      // Check if the agent is done
      if (this.isDone(assistantContent, toolCalls, response.finishReason, agentCalledFinish)) {
        break;
      }
    }

    // -------------------------------------------------------------------
    // Build final result
    // -------------------------------------------------------------------

    // Extract the final output
    // If the agent called "finish", try to parse the summary from the last tool result
    let finalOutput = lastAssistantContent;

    if (!finalOutput && messages.length > 0) {
      // Fall back to the last user message if we somehow have no assistant content
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant" && messages[i].content) {
          finalOutput = messages[i].content;
          break;
        }
      }
    }

    this.emitEvent(options.onEvent, {
      type: "complete",
      taskId,
      output: finalOutput || "Task completed with no output.",
    });

    return {
      taskId,
      output: finalOutput || "Task completed with no output.",
      toolCallsCount: totalToolCalls,
      turnsUsed: maxTurns,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }

  // -----------------------------------------------------------------------
  // Message building
  // -----------------------------------------------------------------------

  /**
   * Build the initial messages array for an agent run.
   * Consists of: system prompt + context messages + user input.
   */
  private buildMessages(
    definition: AgentDefinition,
    input: string,
    contextMessages?: Array<{ role: "user" | "assistant"; content: string }>,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // System prompt
    messages.push({
      role: "system",
      content: definition.systemPrompt,
    });

    // Context messages (prior conversation history, etc.)
    if (contextMessages && contextMessages.length > 0) {
      for (const msg of contextMessages) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // User input (the actual task)
    messages.push({
      role: "user",
      content: input,
    });

    return messages;
  }

  // -----------------------------------------------------------------------
  // Tool execution
  // -----------------------------------------------------------------------

  /**
   * Execute a single tool call from the LLM response.
   *
   * @returns A tool result message to append to the conversation.
   */
  private async executeToolCall(
    toolCall: ToolCall,
    taskId: string,
    turn: number,
    onEvent?: (event: AgentEvent) => void,
  ): Promise<ChatMessage> {
    const toolName = toolCall.function.name;
    let toolInput: Record<string, unknown>;

    // Parse the tool input arguments
    try {
      toolInput = JSON.parse(toolCall.function.arguments);
    } catch {
      const errorMsg = `Failed to parse tool arguments for "${toolName}"`;
      this.recordProgress(onEvent, taskId, turn, "error", errorMsg);

      return {
        role: "tool",
        content: JSON.stringify({ error: errorMsg }),
        toolCallId: toolCall.id,
      };
    }

    // Emit tool_call event
    this.emitEvent(onEvent, {
      type: "tool_call",
      taskId,
      turn,
      toolName,
      input: toolInput,
    });

    // Record tool_call progress
    this.recordProgress(onEvent, taskId, turn, "tool_call", `Calling tool: ${toolName}`, toolName, toolInput);

    // Look up and execute the tool
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      const errorMsg = `Tool "${toolName}" not found in registry.`;
      const errorResult = { error: errorMsg };

      this.emitEvent(onEvent, {
        type: "tool_result",
        taskId,
        turn,
        toolName,
        result: errorResult,
      });

      this.recordProgress(onEvent, taskId, turn, "error", errorMsg, toolName);

      return {
        role: "tool",
        content: JSON.stringify(errorResult),
        toolCallId: toolCall.id,
      };
    }

    // Execute the tool
    let result: unknown;
    try {
      result = await tool.execute(toolInput);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result = { error: `Tool "${toolName}" execution failed: ${errorMsg}` };

      this.recordProgress(onEvent, taskId, turn, "error", String(result), toolName);
    }

    // Emit tool_result event
    this.emitEvent(onEvent, {
      type: "tool_result",
      taskId,
      turn,
      toolName,
      result,
    });

    // Record tool_result progress
    this.recordProgress(onEvent, taskId, turn, "tool_result", `Tool ${toolName} completed`, toolName, undefined, result);

    // Build the result message content.
    // Serialize the result to JSON, handling large outputs by truncating.
    let resultContent: string;
    try {
      resultContent = JSON.stringify(result);
      // Truncate if the result is very large (>100KB)
      if (resultContent.length > 100_000) {
        resultContent = resultContent.substring(0, 100_000) + "\n...[truncated]";
      }
    } catch {
      resultContent = String(result);
    }

    return {
      role: "tool",
      content: resultContent,
      toolCallId: toolCall.id,
    };
  }

  // -----------------------------------------------------------------------
  // Completion detection
  // -----------------------------------------------------------------------

  /**
   * Determine if the agent is done based on the response.
   *
   * The agent is considered done when:
   * - The finishReason is "stop" (model decided to stop)
   * - No tool calls were made AND there is text content (natural response)
   * - The "finish" tool was called (agent explicitly signalled completion)
   */
  private isDone(
    content: string,
    toolCalls: ToolCall[] | undefined,
    finishReason?: string,
    agentCalledFinish?: boolean,
  ): boolean {
    // Agent explicitly called the finish tool
    if (agentCalledFinish) {
      return true;
    }

    // Model's finish reason indicates it stopped naturally
    if (finishReason === "stop") {
      return true;
    }

    // No tool calls and there is content - the model just gave a text answer
    if (!toolCalls || toolCalls.length === 0) {
      if (content && content.trim().length > 0) {
        return true;
      }
    }

    return false;
  }

  // -----------------------------------------------------------------------
  // Event helpers
  // -----------------------------------------------------------------------

  /**
   * Emit an event to the callback if provided.
   */
  private emitEvent(
    onEvent: ((event: AgentEvent) => void) | undefined,
    event: AgentEvent,
  ): void {
    if (onEvent) {
      try {
        onEvent(event);
      } catch {
        // Event callback errors should not crash the agent loop.
        // Swallow silently to maintain stability.
      }
    }
  }

  /**
   * Record a progress entry and emit a progress event.
   */
  private recordProgress(
    onEvent: ((event: AgentEvent) => void) | undefined,
    taskId: string,
    turn: number,
    type: AgentProgressEntry["type"],
    content: string,
    toolName?: string,
    toolInput?: Record<string, unknown>,
    toolOutput?: unknown,
  ): void {
    const entry: AgentProgressEntry = {
      turn,
      timestamp: new Date().toISOString(),
      type,
      content,
      toolName,
      toolInput,
      toolOutput,
    };

    this.emitEvent(onEvent, {
      type: "progress",
      taskId,
      progress: entry,
    });
  }
}
