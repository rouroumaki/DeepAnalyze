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
  | { type: "text_delta"; taskId: string; turn: number; delta: string }
  | { type: "turn"; taskId: string; turn: number; content: string }
  | { type: "turn_usage"; taskId: string; turn: number; usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } }
  | { type: "tool_call"; taskId: string; turn: number; toolName: string; input: Record<string, unknown> }
  | { type: "tool_result"; taskId: string; turn: number; toolName: string; result: unknown }
  | { type: "progress"; taskId: string; progress: AgentProgressEntry }
  | { type: "complete"; taskId: string; output: string }
  | { type: "error"; taskId: string; error: string }
  | { type: "cancelled"; taskId: string }
  | { type: "compaction"; taskId: string; turn: number; method: string; tokensSaved: number }
  | { type: "advisory_limit_reached"; taskId: string; turn: number };

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
  usage: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  compactionEvents?: Array<{ turn: number; method: string; tokensSaved: number }>;
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
  /** Whether this run is a skill invocation (allows workflow_run and agent_todo access). */
  isSkillInvocation?: boolean;
  /** Enable continuous running mode (default: true). When true, uses while(true) loop. */
  continuous?: boolean;
  /** Knowledge base ID for auto-compounding results after task completion. */
  kbId?: string;
  /** Analysis scope to constrain agent to specific knowledge bases or documents. */
  scope?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Re-export provider types needed by the agent system
// ---------------------------------------------------------------------------

// These are imported from our provider module but also re-exported here
// for convenience of agent consumers.

export type { ToolCall } from "../../models/provider.js";
export type { ChatMessage, ChatResponse } from "../../models/provider.js";

// ---------------------------------------------------------------------------
// Compact Boundary
// ---------------------------------------------------------------------------

/**
 * Metadata stored in a compact boundary message.
 * Compact boundaries mark where context was compressed, allowing the
 * context loader to skip pre-boundary messages on subsequent requests.
 */
export interface CompactBoundaryMeta {
  type: "compact_boundary";
  method: "sm-compact" | "legacy-compact" | "emergency-sm-compact" | "emergency-legacy-compact";
  preCompactTokens: number;
  turnNumber: number;
  timestamp: string;
}

/** SM-compact token budget configuration */
export interface SMCompactConfig {
  /** Minimum tokens of recent context to keep. Default: 10_000 */
  minTokens: number;
  /** Maximum tokens of recent context to keep. Default: 40_000 */
  maxTokens: number;
}

// ---------------------------------------------------------------------------
// Session Memory
// ---------------------------------------------------------------------------

/**
 * A structured memory note extracted from a conversation session.
 * Stored in the session_memory table and injected into the system prompt.
 */
export interface SessionMemoryNote {
  id: string;
  sessionId: string;
  content: string;
  tokenCount: number;
  lastTokenPosition: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Agent Settings (configurable via frontend)
// ---------------------------------------------------------------------------

/**
 * Runtime-configurable agent parameters.
 * Stored in the settings table under the 'agent_settings' key.
 */
export interface AgentSettings {
  /** Maximum turns per agent task. -1 = unlimited (default). */
  maxTurns: number;
  /** Context window size in tokens. Default: 200000 */
  contextWindow: number;
  /** Compaction buffer in tokens. Default: 13000 */
  compactionBuffer: number;
  /** Token threshold to initialize session memory. Default: 10000 */
  sessionMemoryInitThreshold: number;
  /** Token increment between session memory updates. Default: 5000 */
  sessionMemoryUpdateInterval: number;
  /** Number of recent assistant turns to keep tool results for. Default: 10 */
  microcompactKeepTurns: number;
  /** Minimum hours between auto-dream runs. Default: 24 */
  autoDreamIntervalHours: number;
  /** Minimum sessions before auto-dream triggers. Default: 5 */
  autoDreamSessionThreshold: number;
  /** Maximum fraction of context window usable for loaded history. Default: 0.5 */
  contextLoadRatio: number;
  /** Maximum tokens per individual tool result in context. Default: 8000 */
  toolResultMaxTokens: number;
  /** Number of recent tool results to keep at full size. Default: 10 */
  toolResultKeepRecent: number;
  /** SM-compact minimum tokens of recent context to keep. Default: 10000 */
  smCompactMinTokens: number;
  /** SM-compact maximum tokens of recent context to keep. Default: 40000 */
  smCompactMaxTokens: number;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  maxTurns: -1,
  contextWindow: 200_000,
  compactionBuffer: 13_000,
  sessionMemoryInitThreshold: 10_000,
  sessionMemoryUpdateInterval: 5_000,
  microcompactKeepTurns: 10,
  autoDreamIntervalHours: 24,
  autoDreamSessionThreshold: 5,
  contextLoadRatio: 0.5,
  toolResultMaxTokens: 8_000,
  toolResultKeepRecent: 10,
  smCompactMinTokens: 10_000,
  smCompactMaxTokens: 40_000,
};
