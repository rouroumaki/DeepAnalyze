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
  AgentSettings,
  CronJob,
  CreateCronJobRequest,
  UpdateCronJobRequest,
  CronValidateResult,
  ChannelInfo,
  ChannelId,
  ChannelTestResult,
  ChannelsConfig,
  ChannelStatus,
  AnalysisScope,
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
  runAgentStream: (
    sessionId: string,
    input: string,
    agentType?: string,
    callbacks?: {
      onStart?: (taskId: string, agentType: string) => void;
      onContent?: (content: string, accumulated: string) => void;
      onToolCall?: (tc: { id: string; toolName: string; input: Record<string, unknown>; status: string }) => void;
      onToolResult?: (data: { id: string; toolName: string; output: string }) => void;
      onProgress?: (progress: { turn: number; type: string; content: string }) => void;
      onComplete?: (data: { taskId: string; output: string; toolCalls: unknown[] }) => void;
      onError?: (data: { taskId: string; error: string }) => void;
      onDone?: (data: { taskId: string; status: string; turnsUsed?: number }) => void;
      onAdvisoryLimit?: (data: { taskId: string; turn: number }) => void;
      onCompaction?: (data: { taskId: string; turn: number; method: string; tokensSaved: number }) => void;
    },
    scope?: AnalysisScope,
  ) => {
    const controller = new AbortController();
    const fetchPromise = fetch(`${BASE_URL}/api/agents/run-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, input, agentType, scope }),
      signal: controller.signal,
    }).then(async (resp) => {
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`API error: ${resp.status} ${text}`);
      }
      if (!resp.body) throw new Error("No response body for stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || "";

        let currentEvent = "";
        let currentData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6);
          } else if (line === "" && currentEvent && currentData) {
            // Empty line = end of event
            try {
              const data = JSON.parse(currentData);
              switch (currentEvent) {
                case "start":
                  callbacks?.onStart?.(data.taskId, data.agentType);
                  break;
                case "content":
                  callbacks?.onContent?.(data.content, data.accumulated);
                  break;
                case "tool_call":
                  callbacks?.onToolCall?.(data);
                  break;
                case "tool_result":
                  callbacks?.onToolResult?.(data);
                  break;
                case "progress":
                  callbacks?.onProgress?.(data);
                  break;
                case "complete":
                  callbacks?.onComplete?.(data);
                  break;
                case "error":
                  callbacks?.onError?.(data);
                  break;
                case "done":
                  callbacks?.onDone?.(data);
                  break;
                case "advisory_limit_reached":
                  callbacks?.onAdvisoryLimit?.(data);
                  break;
                case "compaction":
                  callbacks?.onCompaction?.(data);
                  break;
              }
            } catch {
              // Ignore parse errors for individual events
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }
    });

    return { abort: () => controller.abort(), promise: fetchPromise };
  },
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
    request<{ knowledgeBases: KnowledgeBase[] }>("/api/knowledge/kbs").then(
      (res) => Array.isArray(res.knowledgeBases) ? res.knowledgeBases : [],
    ),
  createKnowledgeBase: (name: string, description?: string) =>
    request<KnowledgeBase>("/api/knowledge/kbs", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  deleteKnowledgeBase: (id: string) =>
    request<void>(`/api/knowledge/kbs/${id}`, { method: "DELETE" }),

  triggerProcessing: (kbId: string) =>
    request<{ enqueued: number }>(`/api/knowledge/kbs/${kbId}/trigger-processing`, { method: "POST" }),

  // --- Documents ---
  listDocuments: (kbId: string) =>
    request<{ documents: DocumentInfo[] }>(`/api/knowledge/kbs/${kbId}/documents`).then(
      (res) => Array.isArray(res.documents) ? res.documents : [],
    ),
  uploadDocument: (kbId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetch(`${BASE_URL}/api/knowledge/kbs/${kbId}/upload`, {
      method: "POST",
      body: formData,
    }).then((r) => {
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
      return r.json() as Promise<{ documentId: string; status: string }>;
    });
  },
  deleteDocument: (kbId: string, docId: string) =>
    request<void>(`/api/knowledge/kbs/${kbId}/documents/${docId}`, {
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

  // --- Entities ---
  getEntities: (kbId: string) =>
    request<Array<{ name: string; type: string; mentions: number; docCount: number }>>(
      `/api/knowledge/kbs/${kbId}/entities`,
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
    request<{ plugins: PluginInfo[] }>("/api/plugins/plugins").then(
      (res) => Array.isArray(res.plugins) ? res.plugins : [],
    ),
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
    request<{ skills: SkillInfo[] }>("/api/plugins/skills").then(
      (res) => Array.isArray(res.skills) ? res.skills : [],
    ),
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

  // --- Agent Settings ---
  getAgentSettings: () =>
    request<AgentSettings>("/api/settings/agent"),
  saveAgentSettings: (settings: Partial<AgentSettings>) =>
    request<{ success: boolean; settings: AgentSettings }>("/api/settings/agent", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  // --- Key-Value Settings ---
  getSetting: (key: string) =>
    request<{ key: string; value: string }>(`/api/settings/key/${key}`),
  setSetting: (key: string, value: string) =>
    request<{ key: string; value: string }>(`/api/settings/key/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),

  // --- Enhanced Models ---
  getEnhancedModels: () =>
    request<import("../types/index.js").EnhancedModelEntry[]>("/api/settings/enhanced-models"),
  saveEnhancedModels: (models: import("../types/index.js").EnhancedModelEntry[]) =>
    request<{ success: boolean; count: number }>("/api/settings/enhanced-models", {
      method: "PUT",
      body: JSON.stringify(models),
    }),

  // --- Cron Jobs ---
  listCronJobs: () =>
    request<CronJob[]>("/api/cron/jobs"),
  getCronJob: (id: string) =>
    request<CronJob>(`/api/cron/jobs/${id}`),
  createCronJob: (data: CreateCronJobRequest) =>
    request<CronJob>("/api/cron/jobs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCronJob: (id: string, data: UpdateCronJobRequest) =>
    request<CronJob>(`/api/cron/jobs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteCronJob: (id: string) =>
    request<{ success: boolean }>(`/api/cron/jobs/${id}`, { method: "DELETE" }),
  runCronJob: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/cron/jobs/${id}/run`, {
      method: "POST",
    }),
  validateCron: (schedule: string) =>
    request<CronValidateResult>("/api/cron/validate", {
      method: "POST",
      body: JSON.stringify({ schedule }),
    }),

  // --- Channels ---
  listChannels: () =>
    request<{ channels: ChannelInfo[] }>("/api/channels/list").then(
      (res) => Array.isArray(res.channels) ? res.channels : [],
    ),
  getChannelConfigs: () =>
    request<{ configs: ChannelsConfig }>("/api/channels/configs").then(
      (res) => res.configs,
    ),
  getChannelConfig: (id: ChannelId) =>
    request<{ config: Record<string, unknown> }>(`/api/channels/${id}/config`).then(
      (res) => res.config,
    ),
  updateChannel: (id: ChannelId, config: Record<string, unknown>) =>
    request<{ success: boolean; config: Record<string, unknown> }>("/api/channels/update", {
      method: "POST",
      body: JSON.stringify({ id, config }),
    }),
  testChannel: (id: ChannelId, config?: Record<string, unknown>) =>
    request<ChannelTestResult>("/api/channels/test", {
      method: "POST",
      body: JSON.stringify({ id, config }),
    }),
  startChannel: (id: ChannelId) =>
    request<{ success: boolean; message: string }>(`/api/channels/${id}/start`, {
      method: "POST",
    }),
  stopChannel: (id: ChannelId) =>
    request<{ success: boolean; message: string }>(`/api/channels/${id}/stop`, {
      method: "POST",
    }),
  getChannelsStatus: () =>
    request<{ status: Record<string, ChannelStatus> }>("/api/channels/status").then(
      (res) => res.status,
    ),

  // --- Health ---
  health: () => request<{ status: string; version: string }>("/api/health"),
};
