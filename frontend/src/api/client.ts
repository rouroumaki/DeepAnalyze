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
};
