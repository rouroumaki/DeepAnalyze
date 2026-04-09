// =============================================================================
// DeepAnalyze - WebSocket Client
// Handles real-time communication with the Agent backend
// =============================================================================

import { useRef, useCallback, useEffect, useState } from "react";
import type {
  WsEvent,
  WsMessageChunk,
  WsMessageComplete,
  WsToolCall,
  WsToolResult,
  WsSubtaskStart,
  WsSubtaskProgress,
  WsSubtaskComplete,
  WsError,
} from "../types/index.js";

type WsHandler = (event: WsEvent) => void;

interface UseWebSocketOptions {
  onMessageChunk?: (e: WsMessageChunk) => void;
  onMessageComplete?: (e: WsMessageComplete) => void;
  onToolCall?: (e: WsToolCall) => void;
  onToolResult?: (e: WsToolResult) => void;
  onSubtaskStart?: (e: WsSubtaskStart) => void;
  onSubtaskProgress?: (e: WsSubtaskProgress) => void;
  onSubtaskComplete?: (e: WsSubtaskComplete) => void;
  onError?: (e: WsError) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  isReconnecting: boolean;
  connect: (sessionId: string) => void;
  disconnect: () => void;
  send: (data: Record<string, unknown>) => void;
  reconnectAttempts: number;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);

  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/chat`;
  }, []);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as WsEvent;

      switch (data.type) {
        case "pong":
          break;
        case "message_chunk":
          optionsRef.current.onMessageChunk?.(data as unknown as WsMessageChunk);
          break;
        case "message_complete":
          optionsRef.current.onMessageComplete?.(data as unknown as WsMessageComplete);
          break;
        case "tool_call":
          optionsRef.current.onToolCall?.(data as unknown as WsToolCall);
          break;
        case "tool_result":
          optionsRef.current.onToolResult?.(data as unknown as WsToolResult);
          break;
        case "subtask_start":
          optionsRef.current.onSubtaskStart?.(data as unknown as WsSubtaskStart);
          break;
        case "subtask_progress":
          optionsRef.current.onSubtaskProgress?.(data as unknown as WsSubtaskProgress);
          break;
        case "subtask_complete":
          optionsRef.current.onSubtaskComplete?.(data as unknown as WsSubtaskComplete);
          break;
        case "error":
          optionsRef.current.onError?.(data as unknown as WsError);
          break;
      }
    } catch (err) {
      console.error("[WebSocket] Failed to parse message:", err);
    }
  }, []);

  const connect = useCallback(
    (sessionId: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current === sessionId) {
        return;
      }

      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      }

      clearHeartbeat();
      clearReconnectTimer();
      sessionIdRef.current = sessionId;
      attemptsRef.current = 0;
      setReconnectAttempts(0);
      setIsReconnecting(false);

      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        setIsReconnecting(false);
        attemptsRef.current = 0;
        setReconnectAttempts(0);

        // Subscribe to session
        ws.send(JSON.stringify({ type: "subscribe", sessionId }));

        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);

        optionsRef.current.onOpen?.();
      };

      ws.onmessage = handleMessage;

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        clearHeartbeat();
        optionsRef.current.onClose?.();

        // Auto-reconnect unless intentionally closed
        if (sessionIdRef.current && !event.wasClean && attemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(BASE_DELAY * Math.pow(2, attemptsRef.current), MAX_DELAY);
          attemptsRef.current += 1;
          setReconnectAttempts(attemptsRef.current);
          setIsReconnecting(true);

          reconnectTimerRef.current = setTimeout(() => {
            if (sessionIdRef.current && mountedRef.current) {
              connect(sessionIdRef.current);
            }
          }, delay);
        }
      };

      ws.onerror = () => {
        console.error("[WebSocket] Connection error");
      };
    },
    [getWsUrl, handleMessage, clearHeartbeat, clearReconnectTimer],
  );

  const disconnect = useCallback(() => {
    sessionIdRef.current = null;
    clearHeartbeat();
    clearReconnectTimer();
    setIsReconnecting(false);
    setReconnectAttempts(0);

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, [clearHeartbeat, clearReconnectTimer]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn("[WebSocket] Cannot send, not connected");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isReconnecting,
    connect,
    disconnect,
    send,
    reconnectAttempts,
  };
}
