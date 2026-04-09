// =============================================================================
// DeepAnalyze - Agent Type Definitions
// =============================================================================
// Core types for the standalone agent execution system.
// =============================================================================

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

/**
 * Defines a type of agent with its capabilities, system prompt, and tool access.
 */
export interface AgentDefinition {
  /** Unique identifier for this agent type */
  agentType: string;
  /** Human-readable description of when to use this agent */
  description: string;
  /** System prompt for this agent */
  systemPrompt: string;
  /** Tools this agent can use (tool names). Use ["*"] for all tools. */
  tools: string[];
  /** Model role to use (defaults to "main") */
  modelRole?: "main" | "summarizer" | "embedding" | "vlm";
  /** Maximum turns before stopping (default 20) */
  maxTurns?: number;
  /** Whether this agent runs in read-only mode */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Tool interface
// ---------------------------------------------------------------------------

/**
 * A tool that can be used by an agent.
 * Follows the same pattern as the existing DeepAnalyze tools (KBSearchTool, etc.).
 */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  execute(input: Record<string, unknown>): Promise<unknown>;
  /** Optional JSON schema for input validation */
  inputSchema?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Execution status
// ---------------------------------------------------------------------------

/** Status of an agent task */
export type AgentStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// ---------------------------------------------------------------------------
// Task tracking
// ---------------------------------------------------------------------------

/**
 * An instance of an agent execution. Tracks the full lifecycle of a task
 * from creation through completion.
 */
export interface AgentTask {
  id: string;
  agentType: string;
  status: AgentStatus;
  /** The original prompt/task input */
  input: string;
  /** Final result text */
  output: string | null;
  /** Error message if failed */
  error: string | null;
  /** Parent task ID for sub-agents */
  parentId: string | null;
  /** Associated chat session */
  sessionId: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Turn-by-turn progress messages */
  progress: AgentProgressEntry[];
}

/**
 * A single progress entry recording activity during an agent turn.
 */
export interface AgentProgressEntry {
  turn: number;
  timestamp: string;
  type: "thinking" | "tool_call" | "tool_result" | "text" | "error";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Events emitted during agent execution. Used for real-time progress
 * reporting via callbacks and WebSocket.
 */
export type AgentEvent =
  | { type: "start"; taskId: string; agentType: string }
  | { type: "turn"; taskId: string; turn: number; content: string }
  | { type: "tool_call"; taskId: string; turn: number; toolName: string; input: Record<string, unknown> }
  | { type: "tool_result"; taskId: string; turn: number; toolName: string; result: unknown }
  | { type: "progress"; taskId: string; progress: AgentProgressEntry }
  | { type: "complete"; taskId: string; output: string }
  | { type: "error"; taskId: string; error: string }
  | { type: "cancelled"; taskId: string };

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * The result of a completed agent execution.
 */
export interface AgentResult {
  taskId: string;
  output: string;
  toolCallsCount: number;
  turnsUsed: number;
  usage: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Run options
// ---------------------------------------------------------------------------

/**
 * Options for running an agent task.
 */
export interface AgentRunOptions {
  /** The task/prompt for the agent */
  input: string;
  /** Agent type to use (default: "general") */
  agentType?: string;
  /** Parent task ID for sub-agents */
  parentTaskId?: string;
  /** Session ID for context */
  sessionId?: string;
  /** Maximum turns override */
  maxTurns?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Event callback for real-time progress */
  onEvent?: (event: AgentEvent) => void;
  /** Additional context messages to prepend before the user input */
  contextMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Model role override */
  modelRole?: "main" | "summarizer" | "embedding" | "vlm";
  /** Optional system prompt override (used for skill execution). */
  systemPromptOverride?: string;
  /** Optional tool override (used for skill execution). */
  toolsOverride?: string[];
}

// ---------------------------------------------------------------------------
// Re-export provider types needed by the agent system
// ---------------------------------------------------------------------------

// These are imported from our provider module but also re-exported here
// for convenience of agent consumers.

export type { ToolCall } from "../../models/provider.js";
export type { ChatMessage, ChatResponse } from "../../models/provider.js";
