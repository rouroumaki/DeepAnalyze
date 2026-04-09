// =============================================================================
// DeepAnalyze - MessageInput Component
// Chat input with auto-resize, keyboard shortcuts, and send controls
// =============================================================================

import { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore } from "../../store/chat";

interface MessageInputProps {
  sendWsMessage: (content: string) => void;
}

export function MessageInput({ sendWsMessage }: MessageInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isSending = useChatStore((s) => s.isSending);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentSessionId = useChatStore((s) => s.currentSessionId);

  const canSend = text.trim().length > 0 && !isSending && !isStreaming && !!currentSessionId;

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [text]);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const content = text.trim();
    setText("");
    // Try WebSocket first, fall back to REST
    sendWsMessage(content);
    sendMessage(content);
  }, [canSend, text, sendWsMessage, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="shrink-0 border-t border-da-border bg-da-bg-secondary px-4 py-3">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送 / Shift+Enter 换行)"
            rows={1}
            disabled={isSending || isStreaming}
            className="w-full px-4 py-2.5 bg-da-surface border border-da-border rounded-xl text-sm text-da-text placeholder-da-text-muted focus:outline-none focus:border-da-accent focus:ring-1 focus:ring-da-accent/30 resize-none disabled:opacity-50"
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-da-accent hover:bg-da-accent-hover disabled:bg-da-surface disabled:text-da-text-muted text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {isSending || isStreaming ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
