// =============================================================================
// DeepAnalyze - Chat Store
// Manages sessions, messages, streaming, and agent tasks
// =============================================================================

import { create } from "zustand";
import { api } from "../api/client.js";
import type { SessionInfo, MessageInfo, AgentTaskInfo, ToolCallInfo } from "../types/index.js";
import { useWorkflowStore } from "./workflow.js";

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

export const useChatStore = create<ChatState>((set, get) => {
  const savedSession = localStorage.getItem('deepanalyze-session') || null;

  return {
  sessions: [],
  currentSessionId: savedSession,
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
      localStorage.setItem('deepanalyze-session', session.id);
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
    localStorage.setItem('deepanalyze-session', id);
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
      if (state.currentSessionId === id) {
        localStorage.removeItem('deepanalyze-session');
      }
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
      // Create the streaming assistant message placeholder
      const assistantId = `stream-${Date.now()}`;
      get().startStreaming(assistantId);

      // Use SSE streaming for real-time output
      const { promise } = api.runAgentStream(
        currentSessionId,
        content,
        undefined,
        {
          onStart: (_taskId, _agentType) => {
            // Agent started
          },
          onContent: (_content, accumulated) => {
            // Update the streaming message content
            set((s) => {
              const newContent = accumulated;
              return {
                streamingContent: newContent,
                messages: s.messages.map((m) =>
                  m.id === s.streamingMessageId ? { ...m, content: newContent } : m,
                ),
              };
            });
          },
          onToolCall: (tc) => {
            const toolCall: ToolCallInfo = {
              id: tc.id,
              toolName: tc.toolName,
              input: tc.input,
              status: "running",
            };
            get().addStreamToolCall(toolCall);
          },
          onToolResult: (data) => {
            get().updateStreamToolResult(data.id, data.output, "completed");
          },
          onComplete: (_data) => {
            // Agent completed with final output
          },
          onError: (data) => {
            set({ error: data.error });
          },
          onDone: (data) => {
            // Streaming finished — finalize the message
            const state = get();
            const finalContent = state.streamingContent;
            const finalToolCalls = state.streamingToolCalls.map((tc) => ({
              ...tc,
              status: tc.status === "running" ? "completed" as const : tc.status,
            }));

            state.finishStreaming(finalContent, finalToolCalls);

            // Don't reload messages from server here — the server only saves
            // the final output text (not tool calls/progress), so reloading
            // would replace the rich streamed content with just one line.
            // The messages will be refreshed next time the session is loaded.

            // Reload agent tasks
            api.getAgentTasks(currentSessionId).then((tasks) => {
              set({ agentTasks: tasks });
            }).catch(() => {});

            // Mark sending as done
            set({ isSending: false });

            if (data.status === "failed") {
              set({ error: "Agent run failed" });
            }
          },
        },
      );

      await promise;
    } catch (err) {
      // SSE stream ended or was interrupted.
      // The agent is likely still running on the server (or already finished).
      // Don't re-run the agent — just poll for the result.
      console.warn("[ChatStore] SSE stream ended, polling for final result:", err);

      // If we have streaming content, finalize what we have
      const state = get();
      if (state.isStreaming && state.streamingMessageId) {
        const partialContent = state.streamingContent;
        const partialToolCalls = state.streamingToolCalls.map((tc) => ({
          ...tc,
          status: tc.status === "running" ? "completed" as const : tc.status,
        }));
        state.finishStreaming(partialContent, partialToolCalls);
      }

      // Poll for the final messages from the server (the agent may still be running)
      const pollForResult = async (attempts = 0) => {
        if (attempts > 60) { // Give up after ~60 seconds of polling
          set({ isSending: false });
          return;
        }
        try {
          const messages = await api.getMessages(currentSessionId);
          // Check if there's an assistant message after our user message
          const hasAssistantResponse = messages.some(
            (m) => m.role === "assistant" &&
              messages.findIndex((msg) => msg === m) > messages.findIndex((msg) => msg.role === "user" && msg.content === content),
          );
          if (hasAssistantResponse) {
            set({ messages, isSending: false });
            // Also reload agent tasks
            api.getAgentTasks(currentSessionId).then((tasks) => {
              set({ agentTasks: tasks });
            }).catch(() => {});
            return;
          }
        } catch {
          // Continue polling
        }
        setTimeout(() => pollForResult(attempts + 1), 1000);
      };

      // Start polling after a short delay to give the agent time to finish
      setTimeout(() => pollForResult(), 2000);
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
      // Create streaming placeholder
      const assistantId = `stream-agent-${Date.now()}`;
      get().startStreaming(assistantId);

      const { promise } = api.runAgentStream(
        currentSessionId,
        input,
        agentType,
        {
          onContent: (_content, accumulated) => {
            set((s) => ({
              streamingContent: accumulated,
              messages: s.messages.map((m) =>
                m.id === s.streamingMessageId ? { ...m, content: accumulated } : m,
              ),
            }));
          },
          onToolCall: (tc) => {
            get().addStreamToolCall({
              id: tc.id,
              toolName: tc.toolName,
              input: tc.input,
              status: "running",
            });
          },
          onToolResult: (data) => {
            get().updateStreamToolResult(data.id, data.output, "completed");
          },
          onError: (data) => {
            set({ error: data.error });
          },
          onDone: (data) => {
            const state = get();
            const finalContent = state.streamingContent;
            const finalToolCalls = state.streamingToolCalls.map((tc) => ({
              ...tc,
              status: tc.status === "running" ? "completed" as const : tc.status,
            }));
            state.finishStreaming(finalContent, finalToolCalls);

            // Don't reload messages from server — would lose streamed content

            api.getAgentTasks(currentSessionId).then((tasks) => {
              set({ agentTasks: tasks });
            }).catch(() => {});

            set({ isSending: false });

            if (data.status === "failed") {
              set({ error: "Agent run failed" });
            }
          },
        },
      );

      await promise;
    } catch (err) {
      // SSE stream ended or was interrupted — agent may still be running on server.
      // Don't re-run. Poll for the result instead.
      console.warn("[ChatStore] SSE stream ended for runAgent, polling for result:", err);

      const state = get();
      if (state.isStreaming && state.streamingMessageId) {
        const partialContent = state.streamingContent;
        const partialToolCalls = state.streamingToolCalls.map((tc) => ({
          ...tc,
          status: tc.status === "running" ? "completed" as const : tc.status,
        }));
        state.finishStreaming(partialContent, partialToolCalls);
      }

      // Poll for the final result
      const pollForResult = async (attempts = 0) => {
        if (attempts > 120) { set({ isSending: false }); return; }
        if (get().currentSessionId !== currentSessionId) { set({ isSending: false }); return; }
        try {
          const tasks = await api.getAgentTasks(currentSessionId);
          set({ agentTasks: tasks });
          const stillRunning = tasks.some(
            (t) => t.status === "running" || t.status === "pending",
          );
          if (stillRunning) {
            setTimeout(() => pollForResult(attempts + 1), 1000);
          } else {
            const messages = await api.getMessages(currentSessionId);
            set({ messages, isSending: false });
          }
        } catch {
          set({ isSending: false });
        }
      };
      setTimeout(() => pollForResult(), 2000);
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
  };
});

// ---------------------------------------------------------------------------
// Workflow WebSocket event dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatches a workflow_* WebSocket event to the workflow store.
 * Can be called from any WebSocket message handler (e.g., a dedicated
 * workflow WS connection) to feed events into the workflow state.
 *
 * Usage:
 *   import { handleWorkflowWsEvent } from "../store/chat.js";
 *   ws.onmessage = (e) => {
 *     const event = JSON.parse(e.data);
 *     handleWorkflowWsEvent(event);
 *   };
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleWorkflowWsEvent(event: { type: string; [key: string]: any }): void {
  const wfStore = useWorkflowStore.getState();
  // Cast through unknown because the incoming WebSocket event is a loose bag of
  // key-value pairs; we trust the server to send the correct shape per event type.
  const e = event as unknown;

  switch (event.type) {
    case "workflow_start":
      wfStore.handleWorkflowStart(e as Parameters<typeof wfStore.handleWorkflowStart>[0]);
      break;
    case "workflow_agent_start":
      wfStore.handleAgentStart(e as Parameters<typeof wfStore.handleAgentStart>[0]);
      break;
    case "workflow_agent_tool_call":
      wfStore.handleAgentToolCall(e as Parameters<typeof wfStore.handleAgentToolCall>[0]);
      break;
    case "workflow_agent_tool_result":
      wfStore.handleAgentToolResult(e as Parameters<typeof wfStore.handleAgentToolResult>[0]);
      break;
    case "workflow_agent_complete":
      wfStore.handleAgentComplete(e as Parameters<typeof wfStore.handleAgentComplete>[0]);
      break;
    case "workflow_complete":
      wfStore.handleWorkflowComplete(e as Parameters<typeof wfStore.handleWorkflowComplete>[0]);
      break;
  }
}
