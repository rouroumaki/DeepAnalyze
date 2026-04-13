// =============================================================================
// DeepAnalyze - WebSocket Handler Module
// Manages real-time communication for document processing status updates.
// Clients subscribe to knowledge base IDs and receive progress events.
// =============================================================================

// ---------------------------------------------------------------------------
// Types — Server-to-client message variants
// ---------------------------------------------------------------------------

export type WsServerMessage =
  | { type: "doc_upload_progress"; kbId: string; docId: string; progress: number }
  | { type: "doc_processing_step"; kbId: string; docId: string; step: string; progress: number }
  | { type: "doc_ready"; kbId: string; docId: string; filename: string }
  | { type: "doc_error"; kbId: string; docId: string; error: string }
  | { type: "pong" };

// ---------------------------------------------------------------------------
// Types — Client-to-server message variants
// ---------------------------------------------------------------------------

type WsClientMessage =
  | { type: "subscribe"; kbId: string }
  | { type: "unsubscribe"; kbId: string }
  | { type: "ping" };

// ---------------------------------------------------------------------------
// Client state
// ---------------------------------------------------------------------------

interface ClientState {
  /** Set of KB IDs this client is subscribed to. */
  subscriptions: Set<string>;
}

// ---------------------------------------------------------------------------
// Connection tracking
// ---------------------------------------------------------------------------

/**
 * Map of connected WebSocket clients to their subscription state.
 * Keyed by the WebSocket instance itself.
 */
const clients = new Map<WebSocket, ClientState>();

// ---------------------------------------------------------------------------
// WebSocket lifecycle handlers
// ---------------------------------------------------------------------------

/**
 * Called when a new WebSocket connection is opened.
 * Initializes empty subscription state for the client.
 */
export function handleOpen(ws: WebSocket): void {
  clients.set(ws, { subscriptions: new Set() });
  console.log(`[WS] Client connected. Total clients: ${clients.size}`);
}

/**
 * Called when a message is received from a connected client.
 * Parses JSON and dispatches to subscribe / unsubscribe / ping handlers.
 */
export function handleMessage(ws: WebSocket, raw: string | Buffer): void {
  let msg: WsClientMessage;
  try {
    msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as WsClientMessage;
  } catch {
    console.warn("[WS] Received non-JSON message, ignoring");
    return;
  }

  const state = clients.get(ws);
  if (!state) {
    console.warn("[WS] Message from unknown client, closing");
    ws.close(4003, "Unknown client");
    return;
  }

  switch (msg.type) {
    case "subscribe": {
      if (!msg.kbId) {
        console.warn("[WS] Subscribe message missing kbId");
        return;
      }
      state.subscriptions.add(msg.kbId);
      console.log(`[WS] Client subscribed to KB ${msg.kbId}. Subscriptions: ${state.subscriptions.size}`);
      break;
    }

    case "unsubscribe": {
      if (!msg.kbId) {
        console.warn("[WS] Unsubscribe message missing kbId");
        return;
      }
      state.subscriptions.delete(msg.kbId);
      console.log(`[WS] Client unsubscribed from KB ${msg.kbId}. Subscriptions: ${state.subscriptions.size}`);
      break;
    }

    case "ping": {
      ws.send(JSON.stringify({ type: "pong" } satisfies WsServerMessage));
      break;
    }

    default: {
      console.warn(`[WS] Unknown message type: ${(msg as Record<string, unknown>).type}`);
      break;
    }
  }
}

/**
 * Called when a WebSocket connection is closed.
 * Cleans up client state from the connection map.
 */
export function handleClose(ws: WebSocket): void {
  const state = clients.get(ws);
  if (state) {
    console.log(
      `[WS] Client disconnected. Had ${state.subscriptions.size} KB subscription(s). Total clients: ${clients.size - 1}`,
    );
  }
  clients.delete(ws);
}

// ---------------------------------------------------------------------------
// Broadcast helper
// ---------------------------------------------------------------------------

/**
 * Sends a JSON-encoded message to every client currently subscribed to the
 * given knowledge base ID.
 */
export function broadcastToKb(kbId: string, message: WsServerMessage): void {
  const payload = JSON.stringify(message);
  let recipientCount = 0;

  for (const [ws, state] of clients) {
    if (state.subscriptions.has(kbId)) {
      try {
        ws.send(payload);
        recipientCount++;
      } catch (err) {
        console.error("[WS] Failed to send to client, removing", err);
        clients.delete(ws);
      }
    }
  }

  if (recipientCount > 0) {
    console.log(`[WS] Broadcast "${message.type}" to ${recipientCount} client(s) for KB ${kbId}`);
  }
}

// ---------------------------------------------------------------------------
// Utility — get count of connected clients (useful for health checks)
// ---------------------------------------------------------------------------

export function getConnectedClientCount(): number {
  return clients.size;
}
