// =============================================================================
// DeepAnalyze - Chat Store
// Manages sessions, messages, streaming, and agent tasks
// =============================================================================

import { create } from "zustand";
import { api } from "../api/client.js";
import type { SessionInfo, MessageInfo, AgentTaskInfo, ToolCallInfo } from "../types/index.js";

interface ChatState {
  // Data
  sessions: SessionInfo[];
  currentSessionId: string | null;
  messages: MessageInfo[];
  agentTasks: AgentTaskInfo[];

  // UI state
  isLoading: boolean;
  isSending: boolean;
  isStreaming: boolean;
  error: string | null;

  // Streaming internals
  streamingMessageId: string | null;
  streamingContent: string;
  streamingToolCalls: ToolCallInfo[];

  // Actions
  loadSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<string>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearError: () => void;

  // Streaming actions (called by WebSocket handlers)
  startStreaming: (messageId: string) => void;
  appendStreamContent: (content: string) => void;
  addStreamToolCall: (toolCall: ToolCallInfo) => void;
  updateStreamToolResult: (id: string, output: string, status: "completed" | "error") => void;
  finishStreaming: (fullContent: string, toolCalls?: ToolCallInfo[]) => void;
  stopStreaming: () => void;

  // Agent task actions
  loadAgentTasks: (sessionId: string) => Promise<void>;
  addAgentTask: (task: AgentTaskInfo) => void;
  updateAgentTaskProgress: (taskId: string, progress: number) => void;
  completeAgentTask: (taskId: string, output: string) => void;
  failAgentTask: (taskId: string, error: string) => void;
  runAgent: (input: string, agentType?: string) => Promise<void>;
  cancelAgentTask: (taskId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  agentTasks: [],
  isLoading: false,
  isSending: false,
  isStreaming: false,
  error: null,
  streamingMessageId: null,
  streamingContent: "",
  streamingToolCalls: [],

  loadSessions: async () => {
    set({ isLoading: true });
    try {
      const sessions = await api.listSessions();
      set({
        sessions: sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        isLoading: false,
      });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  createSession: async (title?: string) => {
    try {
      const session = await api.createSession(title);
      set((s) => ({
        sessions: [session, ...s.sessions],
        currentSessionId: session.id,
        messages: [],
        agentTasks: [],
      }));
      return session.id;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  selectSession: async (id: string) => {
    const state = get();
    if (state.currentSessionId === id) return;
    set({
      currentSessionId: id,
      messages: [],
      agentTasks: [],
      isStreaming: false,
      streamingMessageId: null,
    });
    try {
      const [messages, tasks] = await Promise.all([
        api.getMessages(id),
        api.getAgentTasks(id).catch(() => []),
      ]);
      set({ messages, agentTasks: tasks });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  deleteSession: async (id: string) => {
    try {
      await api.deleteSession(id);
      const state = get();
      const sessions = state.sessions.filter((s) => s.id !== id);
      const currentSessionId = state.currentSessionId === id ? null : state.currentSessionId;
      set({
        sessions,
        currentSessionId,
        messages: state.currentSessionId === id ? [] : state.messages,
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  sendMessage: async (content: string) => {
    const { currentSessionId } = get();
    if (!currentSessionId) return;

    // Optimistically show user message in UI
    const userMessage: MessageInfo = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, userMessage],
      isSending: true,
    }));

    try {
      // Use runAgent which handles: saving user msg → running agent → saving assistant response
      await api.runAgent(currentSessionId, content);

      // Reload messages from server to get the real user msg + assistant response
      const messages = await api.getMessages(currentSessionId);
      set({ messages });

      // Also reload agent tasks
      const tasks = await api.getAgentTasks(currentSessionId).catch(() => []);
      set({ agentTasks: tasks });
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ isSending: false });
    }
  },

  clearError: () => set({ error: null }),

  // --- Streaming ---

  startStreaming: (messageId: string) => {
    const assistantMessage: MessageInfo = {
      id: messageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      isStreaming: true,
      toolCalls: [],
    };
    set((s) => ({
      messages: [...s.messages, assistantMessage],
      isStreaming: true,
      streamingMessageId: messageId,
      streamingContent: "",
      streamingToolCalls: [],
      isSending: false,
    }));
  },

  appendStreamContent: (content: string) => {
    set((s) => {
      const newContent = s.streamingContent + content;
      return {
        streamingContent: newContent,
        messages: s.messages.map((m) =>
          m.id === s.streamingMessageId ? { ...m, content: newContent } : m,
        ),
      };
    });
  },

  addStreamToolCall: (toolCall: ToolCallInfo) => {
    set((s) => {
      const newToolCalls = [...s.streamingToolCalls, toolCall];
      return {
        streamingToolCalls: newToolCalls,
        messages: s.messages.map((m) =>
          m.id === s.streamingMessageId ? { ...m, toolCalls: newToolCalls } : m,
        ),
      };
    });
  },

  updateStreamToolResult: (id: string, output: string, status: "completed" | "error") => {
    set((s) => {
      const newToolCalls = s.streamingToolCalls.map((tc) =>
        tc.id === id ? { ...tc, output, status } : tc,
      );
      return {
        streamingToolCalls: newToolCalls,
        messages: s.messages.map((m) =>
          m.id === s.streamingMessageId ? { ...m, toolCalls: newToolCalls } : m,
        ),
      };
    });
  },

  finishStreaming: (fullContent: string, toolCalls?: ToolCallInfo[]) => {
    set((s) => ({
      isStreaming: false,
      streamingMessageId: null,
      streamingContent: "",
      streamingToolCalls: [],
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId
          ? { ...m, content: fullContent, isStreaming: false, toolCalls: toolCalls ?? m.toolCalls }
          : m,
      ),
    }));
  },

  stopStreaming: () => {
    set((s) => ({
      isStreaming: false,
      isSending: false,
      streamingMessageId: null,
      streamingContent: "",
      streamingToolCalls: [],
      messages: s.messages.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m,
      ),
    }));
  },

  // --- Agent Tasks ---

  loadAgentTasks: async (sessionId: string) => {
    try {
      const tasks = await api.getAgentTasks(sessionId);
      set({ agentTasks: tasks });
    } catch {
      // Silently ignore
    }
  },

  addAgentTask: (task: AgentTaskInfo) => {
    set((s) => ({ agentTasks: [task, ...s.agentTasks] }));
  },

  updateAgentTaskProgress: (taskId: string, progress: number) => {
    set((s) => ({
      agentTasks: s.agentTasks.map((t) =>
        t.id === taskId ? { ...t, progress, status: "running" as const } : t,
      ),
    }));
  },

  completeAgentTask: (taskId: string, output: string) => {
    set((s) => ({
      agentTasks: s.agentTasks.map((t) =>
        t.id === taskId
          ? { ...t, status: "completed" as const, output, completedAt: new Date().toISOString() }
          : t,
      ),
    }));
  },

  failAgentTask: (taskId: string, error: string) => {
    set((s) => ({
      agentTasks: s.agentTasks.map((t) =>
        t.id === taskId
          ? { ...t, status: "failed" as const, error, completedAt: new Date().toISOString() }
          : t,
      ),
    }));
  },

  runAgent: async (input: string, agentType?: string) => {
    const { currentSessionId } = get();
    if (!currentSessionId) return;

    const userMessage: MessageInfo = {
      id: `temp-agent-${Date.now()}`,
      role: "user",
      content: input,
      createdAt: new Date().toISOString(),
    };

    set((s) => ({ messages: [...s.messages, userMessage], isSending: true }));

    try {
      const result = await api.runAgent(currentSessionId, input, agentType);
      // Poll for updates
      const poll = async (count = 0) => {
        if (count > 120) { set({ isSending: false }); return; }
        if (get().currentSessionId !== currentSessionId) { set({ isSending: false }); return; }
        try {
          const tasks = await api.getAgentTasks(currentSessionId);
          set({ agentTasks: tasks });
          const current = tasks.find((t) => t.id === result.taskId);
          if (current && !["completed", "failed", "cancelled"].includes(current.status)) {
            setTimeout(() => poll(count + 1), 1000);
          } else {
            const messages = await api.getMessages(currentSessionId);
            set({ messages, isSending: false });
          }
        } catch {
          set({ isSending: false });
        }
      };
      setTimeout(() => poll(), 1000);
    } catch (err) {
      set({ error: String(err), isSending: false });
    }
  },

  cancelAgentTask: async (taskId: string) => {
    try {
      await api.cancelAgentTask(taskId);
      set((s) => ({
        agentTasks: s.agentTasks.map((t) =>
          t.id === taskId ? { ...t, status: "cancelled" as const } : t,
        ),
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },
}));
