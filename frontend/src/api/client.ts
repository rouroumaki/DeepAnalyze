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
};
