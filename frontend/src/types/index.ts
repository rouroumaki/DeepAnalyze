// =============================================================================
// DeepAnalyze - TypeScript Type Definitions
// =============================================================================

// --- Session & Messages ---

export interface SessionInfo {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface MessageInfo {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
}

export interface ToolCallInfo {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "completed" | "error";
  startedAt?: string;
  completedAt?: string;
}

// --- Agent Tasks ---

export interface AgentTaskInfo {
  id: string;
  agentType: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  input: string;
  output: string | null;
  error: string | null;
  parentId: string | null;
  sessionId: string | null;
  createdAt: string;
  completedAt: string | null;
  progress?: number;
}

export interface RunAgentResponse {
  taskId: string;
  status: string;
  output?: string;
  error?: string;
  turnsUsed?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface RunCoordinatedResponse {
  taskId: string;
  status: string;
}

// --- Provider / Settings ---

export interface ProviderConfig {
  id: string;
  name: string;
  type: "openai-compatible" | "anthropic" | "ollama";
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  supportsToolUse: boolean;
  enabled: boolean;
}

export interface ProviderDefaults {
  main: string;
  summarizer: string;
  embedding: string;
  vlm: string;
}

export interface ProviderSettings {
  providers: ProviderConfig[];
  defaults: ProviderDefaults;
}

export interface ProviderTestResult {
  success: boolean;
  status?: number;
  models?: string[];
  error?: string;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  defaultApiBase: string;
  defaultModel: string;
  isLocal: boolean;
}

// --- Knowledge Base ---

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  createdAt: string;
}

export interface DocumentInfo {
  id: string;
  kbId: string;
  filename: string;
  fileType: string;
  fileSize: number;
  status: "uploaded" | "parsing" | "compiling" | "ready" | "error";
  createdAt: string;
}

// --- Wiki ---

export interface WikiPage {
  id: string;
  kbId: string;
  docId?: string;
  pageType: "abstract" | "overview" | "fulltext" | "entity" | "concept" | "report";
  title: string;
  content: string;
  tokenCount?: number;
  links?: WikiLink[];
  metadata?: Record<string, unknown>;
}

export interface WikiLink {
  sourcePageId: string;
  targetPageId: string;
  linkType: "forward" | "backward" | "entity_ref" | "concept_ref";
  entityName?: string;
}

// --- Reports ---

export interface ReportInfo {
  id: string;
  kbId: string;
  title: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDetail extends ReportInfo {
  content: string;
}

export interface TimelineEvent {
  date: string;
  title: string;
  description: string;
  sourcePageId: string;
  sourceTitle: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  group?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  type: string;
}

// --- Plugins / Skills ---

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  config: Record<string, unknown>;
  toolNames: string[];
  agentTypes: string[];
  loadedAt: string;
  error?: string;
}

export interface SkillVariableInfo {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  pluginId: string | null;
  description: string;
  systemPrompt: string;
  tools: string[];
  variables?: SkillVariableInfo[];
  modelRole?: string;
  maxTurns?: number;
  config: Record<string, unknown>;
}

// --- WebSocket Events ---

export type WsEventType =
  | "message_chunk"
  | "message_complete"
  | "tool_call"
  | "tool_result"
  | "subtask_start"
  | "subtask_progress"
  | "subtask_complete"
  | "task_created"
  | "task_progress"
  | "task_complete"
  | "task_failed"
  | "error"
  | "pong";

export interface WsEvent {
  type: WsEventType;
  [key: string]: unknown;
}

export interface WsMessageChunk {
  type: "message_chunk";
  sessionId: string;
  messageId: string;
  content: string;
}

export interface WsMessageComplete {
  type: "message_complete";
  sessionId: string;
  messageId: string;
  content: string;
  toolCalls?: ToolCallInfo[];
}

export interface WsToolCall {
  type: "tool_call";
  id: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface WsToolResult {
  type: "tool_result";
  id: string;
  output: string;
  status: "completed" | "error";
}

export interface WsSubtaskStart {
  type: "subtask_start";
  taskId: string;
  agent: string;
  parentTaskId?: string;
}

export interface WsSubtaskProgress {
  type: "subtask_progress";
  taskId: string;
  progress: number;
  message?: string;
}

export interface WsSubtaskComplete {
  type: "subtask_complete";
  taskId: string;
  result: unknown;
}

export interface WsTaskEvent {
  type: "task_created" | "task_progress" | "task_complete" | "task_failed";
  taskId: string;
  [key: string]: unknown;
}

export interface WsError {
  type: "error";
  error: string;
  code?: string;
}

// --- UI State ---

export type TabId = "chat" | "knowledge" | "reports" | "tasks" | "settings";
export type RightPanelId =
  | "sessions"
  | "knowledge"
  | "tasks"
  | "settings"
  | null;
