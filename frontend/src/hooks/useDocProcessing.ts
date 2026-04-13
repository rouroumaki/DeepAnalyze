// =============================================================================
// DeepAnalyze - Document Processing Status Hook
// Tracks real-time processing status for documents in a knowledge base.
// Uses the knowledge WebSocket hook to receive updates.
// =============================================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { useWebSocket } from "./useWebSocket";
import type { WsServerMessage } from "./useWebSocket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessingState {
  /** Current processing step label (e.g. "parsing", "compiling"). */
  step: string;
  /** Progress percentage 0-100. */
  progress: number;
  /** Error message if processing failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDocProcessingReturn {
  /** Map of docId -> current processing state for docs being processed. */
  processingDocs: Map<string, ProcessingState>;
  /** Whether the WebSocket connection is alive. */
  wsConnected: boolean;
}

export function useDocProcessing(kbId: string | null): UseDocProcessingReturn {
  const [processingDocs, setProcessingDocs] = useState<Map<string, ProcessingState>>(
    () => new Map(),
  );
  const kbIdRef = useRef(kbId);
  kbIdRef.current = kbId;

  const handleMessage = useCallback((msg: WsServerMessage) => {
    // Only process messages for our KB
    if (!kbIdRef.current) return;
    if ("kbId" in msg && msg.kbId !== kbIdRef.current) return;

    switch (msg.type) {
      case "doc_upload_progress": {
        setProcessingDocs((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.docId);
          next.set(msg.docId, {
            step: existing?.step ?? "uploading",
            progress: msg.progress,
            error: existing?.error,
          });
          return next;
        });
        break;
      }

      case "doc_processing_step": {
        setProcessingDocs((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.docId);
          next.set(msg.docId, {
            step: msg.step,
            progress: msg.progress,
            error: existing?.error,
          });
          return next;
        });
        break;
      }

      case "doc_error": {
        setProcessingDocs((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.docId);
          next.set(msg.docId, {
            step: existing?.step ?? "error",
            progress: existing?.progress ?? 0,
            error: msg.error,
          });
          return next;
        });
        break;
      }

      case "doc_ready": {
        setProcessingDocs((prev) => {
          const next = new Map(prev);
          next.delete(msg.docId);
          return next;
        });
        break;
      }
    }
  }, []);

  const { connected, subscribe, unsubscribe } = useWebSocket({
    onMessage: handleMessage,
  });

  // Subscribe to the KB when it changes or when connection is established
  useEffect(() => {
    if (!kbId) return;

    subscribe([kbId]);

    return () => {
      unsubscribe([kbId]);
      // Clear processing state when switching KB
      setProcessingDocs(new Map());
    };
  }, [kbId, subscribe, unsubscribe]);

  return { processingDocs, wsConnected: connected };
}
