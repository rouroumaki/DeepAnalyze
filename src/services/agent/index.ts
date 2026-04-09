// =============================================================================
// DeepAnalyze - Agent Module
// =============================================================================
// Public API for the standalone agent execution system.
// =============================================================================

export { AgentRunner } from "./agent-runner.js";
export { ToolRegistry } from "./tool-registry.js";
export { Orchestrator } from "./orchestrator.js";
export { createConfiguredToolRegistry } from "./tool-setup.js";
export type { ToolSetupDeps } from "./tool-setup.js";
export {
  BUILT_IN_AGENTS,
  GENERAL_AGENT,
  EXPLORE_AGENT,
  COMPILE_AGENT,
  VERIFY_AGENT,
  REPORT_AGENT,
  COORDINATOR_AGENT,
} from "./agent-definitions.js";
export type {
  AgentDefinition,
  AgentTool,
  AgentStatus,
  AgentTask,
  AgentProgressEntry,
  AgentEvent,
  AgentResult,
  AgentRunOptions,
} from "./types.js";
export type { SubTask, OrchestratorResult } from "./orchestrator.js";
