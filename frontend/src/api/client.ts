const BASE_URL = ""; // Same origin in production, proxy in dev

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`API error: ${resp.status} ${text}`);
  }
  // Handle 204 No Content
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

export interface SessionInfo {
  id: string;
  title: string | null;
  createdAt: string;
}

export interface MessageInfo {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Agent task types
// ---------------------------------------------------------------------------

export interface AgentTaskInfo {
  id: string;
  agentType: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  parentId: string | null;
  sessionId: string | null;
  createdAt: string;
  completedAt: string | null;
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

// ---------------------------------------------------------------------------
// Plugin / Skill types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Provider / Settings types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Report / Timeline / Graph types
// ---------------------------------------------------------------------------

export interface ReportInfo {
  id: string;
  kbId: string;
  title: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDetail {
  id: string;
  kbId: string;
  title: string;
  content: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
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

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const api = {
  listSessions: () => request<SessionInfo[]>("/api/sessions"),

  createSession: (title?: string) =>
    request<SessionInfo>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  getSession: (id: string) => request<SessionInfo>(`/api/sessions/${id}`),

  deleteSession: (id: string) =>
    request<void>(`/api/sessions/${id}`, { method: "DELETE" }),

  sendMessage: (sessionId: string, content: string) =>
    request<{ messageId: string; status: string }>("/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ sessionId, content }),
    }),

  getMessages: (sessionId: string) =>
    request<MessageInfo[]>(`/api/sessions/${sessionId}/messages`),

  // --- Agent API ---

  runAgent: (sessionId: string, input: string, agentType?: string) =>
    request<RunAgentResponse>("/api/agents/run", {
      method: "POST",
      body: JSON.stringify({ sessionId, input, agentType }),
    }),

  runCoordinated: (sessionId: string, input: string) =>
    request<RunCoordinatedResponse>("/api/agents/run-coordinated", {
      method: "POST",
      body: JSON.stringify({ sessionId, input }),
    }),

  getAgentTasks: (sessionId: string) =>
    request<AgentTaskInfo[]>(`/api/agents/tasks/${sessionId}`),

  getAgentTask: (taskId: string) =>
    request<AgentTaskInfo>(`/api/agents/task/${taskId}`),

  cancelAgentTask: (taskId: string) =>
    request<{ taskId: string; status: string }>(
      `/api/agents/cancel/${taskId}`,
      { method: "POST" },
    ),

  // --- Report / Timeline / Graph API ---

  listReports: (kbId: string) =>
    request<{ kbId: string; reports: ReportInfo[] }>(
      `/api/reports/reports/${kbId}`,
    ),

  getReport: (reportId: string) =>
    request<ReportDetail>(`/api/reports/report/${reportId}`),

  generateReport: (
    kbId: string,
    query: string,
    title: string,
    reportType?: string,
    sessionId?: string,
  ) =>
    request<{ taskId: string; status: string }>("/api/reports/generate", {
      method: "POST",
      body: JSON.stringify({ kbId, query, title, reportType, sessionId }),
    }),

  getTimeline: (kbId: string, query?: string, maxEvents?: number) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (maxEvents) params.set("maxEvents", String(maxEvents));
    const qs = params.toString();
    return request<{ events: TimelineEvent[]; totalCount: number }>(
      `/api/reports/timeline/${kbId}${qs ? `?${qs}` : ""}`,
    );
  },

  getGraph: (kbId: string, query?: string, maxNodes?: number) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (maxNodes) params.set("maxNodes", String(maxNodes));
    const qs = params.toString();
    return request<{
      nodes: GraphNode[];
      edges: GraphEdge[];
      stats: { nodeCount: number; edgeCount: number };
    }>(`/api/reports/graph/${kbId}${qs ? `?${qs}` : ""}`);
  },

  // --- Plugin API ---

  listPlugins: () =>
    request<{ plugins: PluginInfo[] }>("/api/plugins/plugins"),

  getPlugin: (id: string) =>
    request<PluginInfo>(`/api/plugins/plugins/${id}`),

  enablePlugin: (id: string) =>
    request<{ pluginId: string; enabled: boolean }>(
      `/api/plugins/plugins/${id}/enable`,
      { method: "POST" },
    ),

  disablePlugin: (id: string) =>
    request<{ pluginId: string; enabled: boolean }>(
      `/api/plugins/plugins/${id}/disable`,
      { method: "POST" },
    ),

  deletePlugin: (id: string) =>
    request<{ pluginId: string; deleted: boolean }>(
      `/api/plugins/plugins/${id}`,
      { method: "DELETE" },
    ),

  // --- Skill API ---

  listSkills: () =>
    request<{ skills: SkillInfo[] }>("/api/plugins/skills"),

  getSkill: (id: string) =>
    request<SkillInfo>(`/api/plugins/skills/${id}`),

  createSkill: (skill: {
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[];
    variables?: SkillVariableInfo[];
    maxTurns?: number;
  }) =>
    request<SkillInfo>("/api/plugins/skills", {
      method: "POST",
      body: JSON.stringify(skill),
    }),

  deleteSkill: (id: string) =>
    request<{ skillId: string; deleted: boolean }>(
      `/api/plugins/skills/${id}`,
      { method: "DELETE" },
    ),

  runSkill: (
    sessionId: string,
    skillId: string,
    variables: Record<string, string>,
    kbId?: string,
  ) =>
    request<{ taskId: string; output: string; skillName: string }>(
      "/api/agents/run-skill",
      {
        method: "POST",
        body: JSON.stringify({ sessionId, skillId, variables, kbId }),
      },
    ),

  // --- Settings / Provider API ---

  getProviders: () =>
    request<ProviderSettings>("/api/settings/providers"),

  getProvider: (id: string) =>
    request<ProviderConfig>(`/api/settings/providers/${id}`),

  saveProvider: (provider: ProviderConfig) =>
    request<{ success: boolean; provider: ProviderConfig }>(
      `/api/settings/providers/${provider.id}`,
      {
        method: "PUT",
        body: JSON.stringify(provider),
      },
    ),

  deleteProvider: (id: string) =>
    request<{ success: boolean }>(`/api/settings/providers/${id}`, {
      method: "DELETE",
    }),

  testProvider: (id: string) =>
    request<ProviderTestResult>(`/api/settings/providers/${id}/test`, {
      method: "POST",
    }),

  getDefaults: () =>
    request<ProviderDefaults>("/api/settings/defaults"),

  saveDefaults: (defaults: Partial<ProviderDefaults>) =>
    request<{ success: boolean; defaults: ProviderDefaults }>(
      "/api/settings/defaults",
      {
        method: "PUT",
        body: JSON.stringify(defaults),
      },
    ),
};
