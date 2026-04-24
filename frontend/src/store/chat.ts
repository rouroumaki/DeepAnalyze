// =============================================================================
// DeepAnalyze - Chat Store
// Manages sessions, messages, streaming, and agent tasks
// =============================================================================

import { create } from "zustand";
import { api } from "../api/client.js";
import type { SessionInfo, MessageInfo, AgentTaskInfo, ToolCallInfo } from "../types/index.js";
import { useWorkflowStore } from "./workflow.js";

// ---------------------------------------------------------------------------
// Map API messages to MessageInfo, enriching toolCalls from metadata
// ---------------------------------------------------------------------------

function mapMessages(msgs: any[]): MessageInfo[] {
  return msgs.map((msg) => {
    const result: MessageInfo = {
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.created_at ?? msg.createdAt ?? "",
    };
    // Map tool calls from persisted metadata (backend enriches these)
    if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
      result.toolCalls = msg.toolCalls.map((tc: any) => ({
        id: tc.id,
        toolName: tc.toolName,
        input: tc.inputSummary ? { _summary: tc.inputSummary } : {},
        output: tc.outputSummary,
        status: tc.status || "completed",
      }));
    }
    // Map report
    if (msg.report) {
      result.report = msg.report;
    }
    // Map pushed contents from persisted metadata
    if (msg.pushedContents && Array.isArray(msg.pushedContents)) {
      result.pushedContents = msg.pushedContents.map((pc: any) => ({
        type: pc.type,
        title: pc.title,
        data: pc.data,
        format: pc.format,
        timestamp: pc.timestamp,
      }));
    }
    return result;
  });
}

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

  // Agent todo list
  todos: import("../types/index.js").TodoItem[];

  // ask_user state
  pendingQuestion: {
    taskId: string;
    question: string;
    options: string[];
  } | null;

  // Actions
  loadSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<string>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (content: string, scope?: import("../types/index.js").AnalysisScope) => Promise<void>;
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
  regenerateMessage: (messageId: string) => void;

  // Todo list actions
  updateTodos: (todos: import("../types/index.js").TodoItem[]) => void;
  clearTodos: () => void;

  // ask_user actions
  setPendingQuestion: (q: { taskId: string; question: string; options: string[] } | null) => void;
  answerQuestion: (taskId: string, answer: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => {
  let savedSession: string | null = null;
  try { savedSession = localStorage.getItem('deepanalyze-session'); } catch { /* SSR */ }

  return {
  sessions: [],
  currentSessionId: savedSession,
  messages: [],
  agentTasks: [],
  todos: [],
  pendingQuestion: null,
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
      const sorted = sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      set({
        sessions: sorted,
        isLoading: false,
      });
      // Auto-load messages for the saved session on first load
      const { currentSessionId, messages } = get();
      if (currentSessionId && messages.length === 0) {
        const exists = sorted.some((s) => s.id === currentSessionId);
        if (exists) {
          try {
            const [msgs, tasks] = await Promise.all([
              api.getMessages(currentSessionId),
              api.getAgentTasks(currentSessionId).catch(() => []),
            ]);
            set({ messages: mapMessages(msgs), agentTasks: tasks });
          } catch {
            // Silently fail — user can click to retry
          }
        }
      }
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
      set({ messages: mapMessages(messages), agentTasks: tasks });
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

  sendMessage: async (content: string, scope?: import("../types/index.js").AnalysisScope) => {
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

      // Track whether we received any SSE content events or tool events
      let receivedContent = false;
      let receivedAnyEvent = false;

      // Use SSE streaming for real-time output
      const { promise } = api.runAgentStream(
        currentSessionId,
        content,
        undefined,
        {
          onStart: (_taskId, _agentType) => {
            // Agent started
            receivedAnyEvent = true;
          },
          onContent: (content, accumulated) => {
            receivedContent = true;
            // Update the streaming message content
            set((s) => {
              // Use accumulated if provided, otherwise append the delta manually
              const newContent = accumulated ?? ((s.streamingContent || "") + content);
              return {
                streamingContent: newContent,
                messages: s.messages.map((m) =>
                  m.id === s.streamingMessageId ? { ...m, content: newContent } : m,
                ),
              };
            });
          },
          onToolCall: (tc) => {
            receivedAnyEvent = true;
            const toolCall: ToolCallInfo = {
              id: tc.id,
              toolName: tc.toolName,
              input: tc.input,
              status: "running",
            };
            get().addStreamToolCall(toolCall);
          },
          onToolResult: (data) => {
            receivedAnyEvent = true;
            get().updateStreamToolResult(data.id, data.output, "completed");
          },
          onComplete: (_data) => {
            // Agent completed with final output
          },
          onPushContent: (data) => {
            // Agent pushed structured content directly to frontend
            const state = get();
            const msgId = state.streamingMessageId;
            if (!msgId) return;
            const pushedItem = {
              type: data.type,
              title: data.title,
              data: data.data,
              format: data.format,
              timestamp: data.timestamp,
            };
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === msgId
                  ? { ...m, pushedContents: [...(m.pushedContents || []), pushedItem] }
                  : m
              ),
            }));
          },
          onTodoUpdate: (data) => {
            // Agent updated todo list
            if (Array.isArray((data as any).todos)) {
              try {
                const lines = (data as any).todos as string;
                // Parse the todo text format: "⬜ [task-1] Subject — desc (pending)"
                const todoItems: import("../types/index.js").TodoItem[] = [];
                const regex = /[⬜🔄✅]\s+\[([^\]]+)\]\s+(.+?)\s*\((pending|in_progress|completed)\)/g;
                let match;
                while ((match = regex.exec(lines)) !== null) {
                  todoItems.push({
                    id: match[1],
                    subject: match[2].replace(/\s*—\s*.+$/, '').trim(),
                    status: match[3] as "pending" | "in_progress" | "completed",
                  });
                }
                if (todoItems.length > 0) {
                  set({ todos: todoItems });
                }
              } catch {
                // Ignore parse errors
              }
            }
          },
          onAskUser: (data) => {
            set({
              pendingQuestion: {
                taskId: data.taskId,
                question: data.question,
                options: data.options ?? [],
              },
            });
          },
          onAskUserAnswered: () => {
            set({ pendingQuestion: null });
          },
          onError: (data) => {
            set({ error: data.error });
          },
          onDone: (data) => {
            // Streaming finished — finalize the message
            const state = get();
            let finalContent = state.streamingContent;

            // If no SSE content was received but the done event includes output
            // (e.g., agent failed before producing streaming content), use it
            if (!finalContent && (data as { output?: string }).output) {
              finalContent = (data as { output?: string }).output!;
            }

            const finalToolCalls = state.streamingToolCalls.map((tc) => ({
              ...tc,
              status: tc.status === "running" ? "completed" as const : tc.status,
            }));

            // Extract report data if present in the done event
            const reportPayload = (data as { report?: { id: string; title: string; content: string; sourceCount?: number; reportType?: string } }).report;

            state.finishStreaming(finalContent, finalToolCalls);

            // If report data was received, attach it to the message
            if (reportPayload) {
              const msgId = state.streamingMessageId;
              set((s) => ({
                messages: s.messages.map((m) =>
                  m.id === msgId
                    ? {
                        ...m,
                        report: {
                          id: reportPayload.id,
                          title: reportPayload.title,
                          content: reportPayload.content,
                          summary: reportPayload.content.slice(0, 200),
                          references: [],
                          entities: [],
                          createdAt: new Date().toISOString(),
                        },
                      }
                    : m,
                ),
              }));
            }

            // If still no content, reload messages from server as last resort
            if (!finalContent) {
              api.getMessages(currentSessionId).then((messages) => {
                set({ messages: mapMessages(messages) });
              }).catch(() => {});
            }

            // Reload agent tasks
            api.getAgentTasks(currentSessionId).then((tasks) => {
              set({ agentTasks: tasks });
            }).catch(() => {});

            // Mark sending as done
            set({ isSending: false });

            if (data.status === "failed") {
              set({ error: (data as { output?: string }).output ?? "Agent run failed" });
            }
          },
        },
        scope,
      );

      // SSE timeout fallback: if no events at all arrive within 30 seconds,
      // fall back to polling for the server-side result.
      // Tool calls and start events reset the timer since they indicate activity.
      const sseTimeoutId = setTimeout(() => {
        if (!receivedAnyEvent && get().isStreaming) {
          console.warn("[ChatStore] No SSE content received after 15s, falling back to polling");
          // Poll for the result from the server
          const userMsgCount = get().messages.filter((m) => m.role === "user").length;
          const pollForResult = async (attempts = 0) => {
            if (attempts > 60) {
              set({ isSending: false });
              return;
            }
            try {
              const messages = await api.getMessages(currentSessionId);
              let userMsgIndex = -1;
              let userCount = 0;
              for (let i = 0; i < messages.length; i++) {
                if (messages[i].role === "user") {
                  userCount++;
                  if (userCount === userMsgCount) {
                    userMsgIndex = i;
                    break;
                  }
                }
              }
              const hasAssistantResponse = userMsgIndex >= 0 &&
                messages.some((m, i) => m.role === "assistant" && i > userMsgIndex);
              if (hasAssistantResponse) {
                const state = get();
                if (state.isStreaming) {
                  state.finishStreaming(
                    messages.filter((m, i) => m.role === "assistant" && i > userMsgIndex)[0]?.content ?? "",
                  );
                }
                set({ messages: mapMessages(messages), isSending: false });
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
          setTimeout(() => pollForResult(), 1000);
        }
      }, 15_000);

      // Clear the timeout when the stream finishes normally
      promise.finally(() => clearTimeout(sseTimeoutId));

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
      // Always clear isSending — polling will set it again when response arrives
      set({ isSending: false });

      // Poll for the final messages from the server (the agent may still be running)
      // Track by position: look for an assistant message whose index is greater than
      // the last user message index at the time of sending.
      const userMsgCount = get().messages.filter((m) => m.role === "user").length;
      const pollForResult = async (attempts = 0) => {
        if (attempts > 60) { // Give up after ~60 seconds of polling
          set({ isSending: false });
          return;
        }
        try {
          const messages = await api.getMessages(currentSessionId);
          // Find the N-th user message (matching the count at send time) and check
          // if any assistant message follows it.
          // userMsgCount includes the optimistic message we just added, so it equals
          // the number of user messages the server should now have.
          let userMsgIndex = -1;
          let userCount = 0;
          for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === "user") {
              userCount++;
              if (userCount === userMsgCount) {
                userMsgIndex = i;
                break;
              }
            }
          }
          const hasAssistantResponse = userMsgIndex >= 0 &&
            messages.some((m, i) => m.role === "assistant" && i > userMsgIndex);
          if (hasAssistantResponse) {
            set({ messages: mapMessages(messages), isSending: false });
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
          onContent: (content, accumulated) => {
            set((s) => {
              const newContent = accumulated ?? ((s.streamingContent || "") + content);
              return {
                streamingContent: newContent,
                messages: s.messages.map((m) =>
                  m.id === s.streamingMessageId ? { ...m, content: newContent } : m,
                ),
              };
            });
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
          onPushContent: (data) => {
            const state = get();
            const msgId = state.streamingMessageId;
            if (!msgId) return;
            const pushedItem = {
              type: data.type,
              title: data.title,
              data: data.data,
              format: data.format,
              timestamp: data.timestamp,
            };
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === msgId
                  ? { ...m, pushedContents: [...(m.pushedContents || []), pushedItem] }
                  : m
              ),
            }));
          },
          onTodoUpdate: (data) => {
            if (Array.isArray((data as any).todos)) {
              try {
                const lines = (data as any).todos as string;
                const todoItems: import("../types/index.js").TodoItem[] = [];
                const regex = /[⬜🔄✅]\s+\[([^\]]+)\]\s+(.+?)\s*\((pending|in_progress|completed)\)/g;
                let match;
                while ((match = regex.exec(lines)) !== null) {
                  todoItems.push({
                    id: match[1],
                    subject: match[2].replace(/\s*—\s*.+$/, '').trim(),
                    status: match[3] as "pending" | "in_progress" | "completed",
                  });
                }
                if (todoItems.length > 0) {
                  set({ todos: todoItems });
                }
              } catch {
                // Ignore parse errors
              }
            }
          },
          onAskUser: (data) => {
            set({
              pendingQuestion: {
                taskId: data.taskId,
                question: data.question,
                options: data.options ?? [],
              },
            });
          },
          onAskUserAnswered: () => {
            set({ pendingQuestion: null });
          },
          onError: (data) => {
            set({ error: data.error });
          },
          onDone: (data) => {
            const state = get();
            let finalContent = state.streamingContent;

            // If no SSE content received but done event has output, use it
            if (!finalContent && (data as { output?: string }).output) {
              finalContent = (data as { output?: string }).output!;
            }

            const finalToolCalls = state.streamingToolCalls.map((tc) => ({
              ...tc,
              status: tc.status === "running" ? "completed" as const : tc.status,
            }));
            state.finishStreaming(finalContent, finalToolCalls);

            // Extract report data if present in the done event
            const reportPayload = (data as { report?: { id: string; title: string; content: string; sourceCount?: number; reportType?: string } }).report;
            if (reportPayload) {
              const msgId = state.streamingMessageId;
              set((s) => ({
                messages: s.messages.map((m) =>
                  m.id === msgId
                    ? {
                        ...m,
                        report: {
                          id: reportPayload.id,
                          title: reportPayload.title,
                          content: reportPayload.content,
                          summary: reportPayload.content.slice(0, 200),
                          references: [],
                          entities: [],
                          createdAt: new Date().toISOString(),
                        },
                      }
                    : m
                ),
              }));
            }

            // If still no content, reload from server
            if (!finalContent) {
              api.getMessages(currentSessionId).then((messages) => {
                set({ messages: mapMessages(messages) });
              }).catch(() => {});
            }

            api.getAgentTasks(currentSessionId).then((tasks) => {
              set({ agentTasks: tasks });
            }).catch(() => {});

            set({ isSending: false });

            if (data.status === "failed") {
              set({ error: (data as { output?: string }).output ?? "Agent run failed" });
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
            set({ messages: mapMessages(messages), isSending: false });
          }
        } catch {
          set({ isSending: false });
        }
      };
      setTimeout(() => pollForResult(), 2000);
    }
  },

  regenerateMessage: (messageId: string) => {
    const state = get();
    const msgIndex = state.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    // Find the user message before this AI message
    let userMsgIndex = msgIndex - 1;
    while (userMsgIndex >= 0 && state.messages[userMsgIndex].role !== "user") {
      userMsgIndex--;
    }
    if (userMsgIndex < 0) return;

    const userContent = state.messages[userMsgIndex].content;

    // Remove the AI message and everything after it
    set({ messages: state.messages.slice(0, msgIndex) });

    // Re-send the user message through the normal flow
    get().sendMessage(userContent);
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

  updateTodos: (todos: import("../types/index.js").TodoItem[]) => {
    set({ todos });
  },

  clearTodos: () => {
    set({ todos: [] });
  },

  setPendingQuestion: (q) => {
    set({ pendingQuestion: q });
  },

  answerQuestion: async (taskId, answer) => {
    try {
      await api.answerAskUser(taskId, answer);
      set({ pendingQuestion: null });
    } catch (err) {
      set({ error: String(err) });
    }
  },
  };
});

// ---------------------------------------------------------------------------
// Workflow WebSocket event dispatching is handled in useWebSocket.ts
// which automatically routes workflow_* events to the workflow store.
