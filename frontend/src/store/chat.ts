import { create } from "zustand";
import {
  api,
  type SessionInfo,
  type MessageInfo,
  type AgentTaskInfo,
} from "../api/client";

interface ChatState {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  messages: MessageInfo[];
  agentTasks: AgentTaskInfo[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;

  // Report-related state
  activeTab: "chat" | "reports";
  selectedKbId: string | null;

  loadSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<SessionInfo | null>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearError: () => void;

  // Tab / KB actions
  setActiveTab: (tab: "chat" | "reports") => void;
  setSelectedKbId: (kbId: string | null) => void;

  // Agent task actions
  loadAgentTasks: (sessionId: string) => Promise<void>;
  runAgent: (input: string, agentType?: string) => Promise<void>;
  runCoordinated: (input: string) => Promise<void>;
  cancelAgentTask: (taskId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  agentTasks: [],
  isLoading: false,
  isSending: false,
  error: null,
  activeTab: "chat" as const,
  selectedKbId: null,

  loadSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const sessions = await api.listSessions();
      // Sort by createdAt descending (newest first)
      sessions.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      set({ sessions, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load sessions",
        isLoading: false,
      });
    }
  },

  createSession: async (title?: string) => {
    set({ error: null });
    try {
      const session = await api.createSession(title);
      const { sessions } = get();
      set({ sessions: [session, ...sessions], currentSessionId: session.id });
      // Load empty messages for the new session
      set({ messages: [], agentTasks: [] });
      return session;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create session",
      });
      return null;
    }
  },

  selectSession: async (id: string) => {
    const { currentSessionId } = get();
    if (currentSessionId === id) return;

    set({
      currentSessionId: id,
      messages: [],
      agentTasks: [],
      isLoading: true,
      error: null,
    });
    try {
      const messages = await api.getMessages(id);
      // Also load agent tasks for this session
      let agentTasks: AgentTaskInfo[] = [];
      try {
        agentTasks = await api.getAgentTasks(id);
      } catch {
        // Agent tasks endpoint may not be available yet; ignore errors
      }
      set({ messages, agentTasks, isLoading: false });
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to load messages",
        isLoading: false,
      });
    }
  },

  deleteSession: async (id: string) => {
    set({ error: null });
    try {
      await api.deleteSession(id);
      const { sessions, currentSessionId } = get();
      const newSessions = sessions.filter((s) => s.id !== id);
      const newCurrentId =
        currentSessionId === id ? null : currentSessionId;
      set({
        sessions: newSessions,
        currentSessionId: newCurrentId,
        messages: currentSessionId === id ? [] : get().messages,
        agentTasks: currentSessionId === id ? [] : get().agentTasks,
      });
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to delete session",
      });
    }
  },

  sendMessage: async (content: string) => {
    const { currentSessionId } = get();
    if (!currentSessionId || !content.trim()) return;

    set({ isSending: true, error: null });

    // Append user message locally immediately (optimistic update)
    const tempUserMsg: MessageInfo = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, tempUserMsg],
    }));

    try {
      const result = await api.sendMessage(currentSessionId, content.trim());

      // Now reload messages from server to get the canonical versions
      // (both user message and assistant response)
      const messages = await api.getMessages(currentSessionId);
      set({ messages, isSending: false });

      // Also refresh agent tasks in case the backend created any
      try {
        const agentTasks = await api.getAgentTasks(currentSessionId);
        set({ agentTasks });
      } catch {
        // Agent tasks endpoint may not be available yet; ignore errors
      }

      // Update session title if it was the first message
      const { sessions } = get();
      const session = sessions.find((s) => s.id === currentSessionId);
      if (session && !session.title) {
        // Reload sessions to pick up the auto-generated title
        const updatedSessions = await api.listSessions();
        updatedSessions.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        set({ sessions: updatedSessions });
      }
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to send message",
        isSending: false,
      });
      // Remove the optimistic user message on failure
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempUserMsg.id),
      }));
    }
  },

  clearError: () => set({ error: null }),

  setActiveTab: (tab: "chat" | "reports") => set({ activeTab: tab }),
  setSelectedKbId: (kbId: string | null) => set({ selectedKbId: kbId }),

  // -----------------------------------------------------------------------
  // Agent task actions
  // -----------------------------------------------------------------------

  loadAgentTasks: async (sessionId: string) => {
    try {
      const agentTasks = await api.getAgentTasks(sessionId);
      set({ agentTasks });
    } catch (err) {
      // Silently ignore errors - the agent endpoint may not be initialized yet
      console.warn("Failed to load agent tasks:", err);
    }
  },

  runAgent: async (input: string, agentType?: string) => {
    const { currentSessionId } = get();
    if (!currentSessionId || !input.trim()) return;

    set({ isSending: true, error: null });

    // Optimistically add a user message
    const tempUserMsg: MessageInfo = {
      id: `temp-user-agent-${Date.now()}`,
      role: "user",
      content: input.trim(),
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, tempUserMsg],
    }));

    try {
      const result = await api.runAgent(
        currentSessionId,
        input.trim(),
        agentType,
      );

      // Reload messages and agent tasks from the server
      const [messages, agentTasks] = await Promise.all([
        api.getMessages(currentSessionId),
        api.getAgentTasks(currentSessionId).catch(() => get().agentTasks),
      ]);

      set({ messages, agentTasks, isSending: false });
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to run agent",
        isSending: false,
      });
      // Remove the optimistic user message on failure
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempUserMsg.id),
      }));
    }
  },

  runCoordinated: async (input: string) => {
    const { currentSessionId } = get();
    if (!currentSessionId || !input.trim()) return;

    set({ isSending: true, error: null });

    // Optimistically add a user message
    const tempUserMsg: MessageInfo = {
      id: `temp-user-coord-${Date.now()}`,
      role: "user",
      content: input.trim(),
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, tempUserMsg],
    }));

    try {
      const result = await api.runCoordinated(currentSessionId, input.trim());

      // Reload agent tasks to show the running coordinated task
      try {
        const agentTasks = await api.getAgentTasks(currentSessionId);
        set({ agentTasks });
      } catch {
        // Ignore - polling will pick it up
      }

      // Start polling for updates since coordinated runs are async
      pollAgentTasks(currentSessionId, get, set);

      set({ isSending: false });
    } catch (err) {
      set({
        error:
          err instanceof Error
            ? err.message
            : "Failed to start coordinated workflow",
        isSending: false,
      });
      // Remove the optimistic user message on failure
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempUserMsg.id),
      }));
    }
  },

  cancelAgentTask: async (taskId: string) => {
    try {
      await api.cancelAgentTask(taskId);

      // Refresh the task list
      const { currentSessionId } = get();
      if (currentSessionId) {
        const agentTasks = await api.getAgentTasks(currentSessionId);
        set({ agentTasks });
      }
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to cancel task",
      });
    }
  },
}));

// ---------------------------------------------------------------------------
// Polling helper for async agent tasks
// ---------------------------------------------------------------------------

/**
 * Poll agent tasks for a session until all tasks reach a terminal state.
 * Updates the store with each poll.
 */
function pollAgentTasks(
  sessionId: string,
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
): void {
  let pollCount = 0;
  const maxPolls = 120; // 2 minutes at 1-second intervals

  const intervalId = setInterval(async () => {
    pollCount++;

    // Stop if we've polled too many times
    if (pollCount > maxPolls) {
      clearInterval(intervalId);
      return;
    }

    // Stop if the user switched sessions
    if (get().currentSessionId !== sessionId) {
      clearInterval(intervalId);
      return;
    }

    try {
      const agentTasks = await api.getAgentTasks(sessionId);
      set({ agentTasks });

      // Also refresh messages since coordinated runs save assistant messages
      const messages = await api.getMessages(sessionId);
      set({ messages });

      // Check if all tasks are in a terminal state
      const hasActiveTasks = agentTasks.some(
        (t) => t.status === "pending" || t.status === "running",
      );

      if (!hasActiveTasks) {
        clearInterval(intervalId);
      }
    } catch {
      // Continue polling even if a single request fails
    }
  }, 1000);
}
