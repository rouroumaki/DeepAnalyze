import { create } from "zustand";
import { api, type SessionInfo, type MessageInfo } from "../api/client";

interface ChatState {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  messages: MessageInfo[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;

  loadSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<SessionInfo | null>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isLoading: false,
  isSending: false,
  error: null,

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
      set({ messages: [] });
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

    set({ currentSessionId: id, messages: [], isLoading: true, error: null });
    try {
      const messages = await api.getMessages(id);
      set({ messages, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load messages",
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
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to delete session",
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
        error: err instanceof Error ? err.message : "Failed to send message",
        isSending: false,
      });
      // Remove the optimistic user message on failure
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempUserMsg.id),
      }));
    }
  },

  clearError: () => set({ error: null }),
}));
