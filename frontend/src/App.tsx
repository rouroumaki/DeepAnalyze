// =============================================================================
// DeepAnalyze - Main Application Layout
// =============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import { useChatStore } from "./store/chat";
import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { useWebSocket } from "./hooks/useWebSocket";
import type {
  WsMessageChunk,
  WsMessageComplete,
  WsToolCall,
  WsToolResult,
  WsSubtaskStart,
  WsSubtaskProgress,
  WsSubtaskComplete,
  WsError,
  ToolCallInfo,
} from "./types/index";

export default function App() {
  const loadSessions = useChatStore((s) => s.loadSessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // WebSocket connection
  const {
    isConnected,
    isReconnecting,
    connect,
    disconnect,
    send,
    reconnectAttempts,
  } = useWebSocket({
    onMessageChunk: (e: WsMessageChunk) => {
      const store = useChatStore.getState();
      if (!store.streamingMessageId) {
        store.startStreaming(e.messageId);
      }
      store.appendStreamContent(e.content);
    },
    onMessageComplete: (e: WsMessageComplete) => {
      const store = useChatStore.getState();
      store.finishStreaming(e.content, e.toolCalls);
    },
    onToolCall: (e: WsToolCall) => {
      const store = useChatStore.getState();
      const toolCall: ToolCallInfo = {
        id: e.id,
        toolName: e.toolName,
        input: e.input,
        status: "running",
      };
      store.addStreamToolCall(toolCall);
    },
    onToolResult: (e: WsToolResult) => {
      const store = useChatStore.getState();
      store.updateStreamToolResult(e.id, e.output, e.status);
    },
    onSubtaskStart: (e: WsSubtaskStart) => {
      const store = useChatStore.getState();
      store.addAgentTask({
        id: e.taskId,
        agentType: e.agent,
        status: "running",
        input: "",
        output: null,
        error: null,
        parentId: e.parentTaskId ?? null,
        sessionId: store.currentSessionId,
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
    },
    onSubtaskProgress: (e: WsSubtaskProgress) => {
      useChatStore.getState().updateAgentTaskProgress(e.taskId, e.progress);
    },
    onSubtaskComplete: (e: WsSubtaskComplete) => {
      useChatStore.getState().completeAgentTask(e.taskId, JSON.stringify(e.result));
    },
    onError: (e: WsError) => {
      console.error("[WS Error]", e.error);
    },
  });

  // Connect/disconnect WebSocket when session changes
  useEffect(() => {
    if (currentSessionId) {
      connect(currentSessionId);
    } else {
      disconnect();
    }
    return () => { disconnect(); };
  }, [currentSessionId, connect, disconnect]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Expose send to children via store-like pattern
  const sendWsMessage = useCallback(
    (content: string) => {
      if (currentSessionId) {
        send({ type: "message", sessionId: currentSessionId, content });
      }
    },
    [currentSessionId, send],
  );

  // Resize handler for right panel
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = rightPanelWidth;

      const handleMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const diff = startXRef.current - ev.clientX;
        const newWidth = Math.max(320, Math.min(800, startWidthRef.current + diff));
        setRightPanelWidth(newWidth);
      };

      const handleUp = () => {
        resizingRef.current = false;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [rightPanelWidth],
  );

  return (
    <div className="h-screen flex bg-da-bg overflow-hidden">
      {/* Left Sidebar - Session Management */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-12 flex items-center justify-between px-4 border-b border-da-border bg-da-bg-secondary shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-da-cyan">DeepAnalyze</span>
            {currentSessionId && (
              <span className="text-xs text-da-text-muted">|</span>
            )}
            {isConnected && (
              <span className="flex items-center gap-1 text-xs text-da-green">
                <span className="w-1.5 h-1.5 rounded-full bg-da-green" />
                Connected
              </span>
            )}
            {isReconnecting && (
              <span className="flex items-center gap-1 text-xs text-da-amber">
                <span className="w-1.5 h-1.5 rounded-full bg-da-amber animate-pulse" />
                Reconnecting ({reconnectAttempts})
              </span>
            )}
            {!isConnected && !isReconnecting && currentSessionId && (
              <span className="flex items-center gap-1 text-xs text-da-red">
                <span className="w-1.5 h-1.5 rounded-full bg-da-red" />
                Disconnected
              </span>
            )}
          </div>
        </header>

        {/* Chat Content */}
        <ChatWindow sendWsMessage={sendWsMessage} />
      </div>
    </div>
  );
}
