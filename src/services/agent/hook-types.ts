// =============================================================================
// DeepAnalyze - Hook Type Definitions
// =============================================================================
// Expanded hook types for the agent hooks system. Supports 8 hook types
// covering the full agent lifecycle: session, agent, tool, and compaction.
// =============================================================================

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

/**
 * The 8 supported hook types covering the full agent lifecycle.
 *
 * **Lifecycle order:**
 * 1. SessionStart  — fired when a session begins (before any agent runs)
 * 2. AgentStart    — fired at the beginning of an agent run()
 * 3. PreToolUse    — fired before each tool execution (can block)
 * 4. PostToolUse   — fired after each tool execution (fire-and-forget)
 * 5. PreCompact    — fired before context compaction (can block / inject instructions)
 * 6. PostCompact   — fired after context compaction (fire-and-forget)
 * 7. AgentComplete — fired at the end of an agent run (before return)
 * 8. SessionEnd    — fired when a session ends
 */
export type HookType =
  | "PreToolUse"
  | "PostToolUse"
  | "PreCompact"
  | "PostCompact"
  | "SessionStart"
  | "SessionEnd"
  | "AgentStart"
  | "AgentComplete";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Context passed to hook handlers.
 * Fields vary by hook type — only relevant fields are populated.
 */
export interface HookContext {
  hookType: HookType;
  /** Tool name (PreToolUse, PostToolUse) */
  toolName?: string;
  /** Tool input parameters (PreToolUse, PostToolUse) */
  toolInput?: Record<string, unknown>;
  /** Current task ID */
  taskId?: string;
  /** PreCompact hook can inject custom instructions into the compaction process */
  customInstructions?: string;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Result returned by a hook handler.
 *
 * For **blocking** hooks (PreToolUse, PreCompact):
 *   - `allowed: false` prevents the action from proceeding.
 *   - `error` provides a reason shown to the agent / user.
 *
 * For **fire-and-forget** hooks (all others):
 *   - The result is logged but does not affect execution flow.
 *
 * For **PreToolUse** additionally:
 *   - `modifiedInput` allows hooks to transform the tool input before execution.
 */
export interface HookResult {
  /** false = block the action (PreToolUse / PreCompact only) */
  allowed: boolean;
  error?: string;
  /** Modified tool input (PreToolUse only). Merged with original input. */
  modifiedInput?: Record<string, unknown>;
}
