// =============================================================================
// DeepAnalyze - API Client
// =============================================================================

import type {
  SessionInfo,
  MessageInfo,
  AgentTaskInfo,
  RunAgentResponse,
  RunCoordinatedResponse,
  ProviderConfig,
  ProviderDefaults,
  ProviderSettings,
  ProviderTestResult,
  ReportInfo,
  ReportDetail,
  TimelineEvent,
  GraphNode,
  GraphEdge,
  PluginInfo,
  SkillInfo,
  SkillVariableInfo,
  KnowledgeBase,
  DocumentInfo,
  WikiPage,
} from "../types/index.js";

const BASE_URL = "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`API error: ${resp.status} ${text}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

// =============================================================================
// API Methods
// =============================================================================

export const api = {
  // --- Sessions ---
  listSessions: () => request<SessionInfo[]>("/api/sessions"),
  createSession: (title?: string) =>
    request<SessionInfo>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  getSession: (id: string) => request<SessionInfo>(`/api/sessions/${id}`),
  deleteSession: (id: string) =>
    request<void>(`/api/sessions/${id}`, { method: "DELETE" }),

  // --- Chat ---
  sendMessage: (sessionId: string, content: string) =>
    request<{ messageId: string; status: string }>("/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ sessionId, content }),
    }),
  getMessages: (sessionId: string) =>
    request<MessageInfo[]>(`/api/sessions/${sessionId}/messages`),

  // --- Agent ---
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
    request<{ taskId: string; status: string }>(`/api/agents/cancel/${taskId}`, {
      method: "POST",
    }),

  // --- Knowledge Base ---
  listKnowledgeBases: () =>
    request<KnowledgeBase[]>("/api/knowledge/bases"),
  createKnowledgeBase: (name: string, description?: string) =>
    request<KnowledgeBase>("/api/knowledge/bases", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  deleteKnowledgeBase: (id: string) =>
    request<void>(`/api/knowledge/bases/${id}`, { method: "DELETE" }),

  // --- Documents ---
  listDocuments: (kbId: string) =>
    request<DocumentInfo[]>(`/api/knowledge/${kbId}/documents`),
  uploadDocument: (kbId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetch(`${BASE_URL}/api/knowledge/${kbId}/documents/upload`, {
      method: "POST",
      body: formData,
    }).then((r) => {
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
      return r.json() as Promise<{ documentId: string; status: string }>;
    });
  },
  deleteDocument: (kbId: string, docId: string) =>
    request<void>(`/api/knowledge/${kbId}/documents/${docId}`, {
      method: "DELETE",
    }),

  // --- Wiki ---
  searchWiki: (kbId: string, query: string, mode?: string, topK?: number) => {
    const params = new URLSearchParams();
    params.set("query", query);
    if (mode) params.set("mode", mode);
    if (topK) params.set("topK", String(topK));
    return request<{
      results: Array<{
        docId: string;
        level: string;
        content: string;
        score: number;
        metadata: Record<string, unknown>;
      }>;
      totalFound: number;
    }>(`/api/knowledge/${kbId}/search?${params}`);
  },
  browseWiki: (kbId: string, path: string) =>
    request<WikiPage>(`/api/knowledge/${kbId}/wiki/${encodeURIComponent(path)}`),
  expandWiki: (kbId: string, docId: string, level: string, section?: string) =>
    request<{ content: string; level: string; expandable: boolean }>(
      `/api/knowledge/${kbId}/expand`,
      {
        method: "POST",
        body: JSON.stringify({ docId, level, section }),
      },
    ),

  // --- Reports ---
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

  // --- Plugins ---
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

  // --- Skills ---
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
    request<{ skillId: string; deleted: boolean }>(`/api/plugins/skills/${id}`, {
      method: "DELETE",
    }),
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

  // --- Settings / Providers ---
  getProviderRegistry: () =>
    request<import("../types/index.js").ProviderMetadata[]>(
      "/api/settings/registry",
    ),
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

  // --- Health ---
  health: () => request<{ status: string; version: string }>("/api/health"),
};
