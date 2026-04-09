// =============================================================================
// DeepAnalyze - MessageList Component
// Renders chat messages with auto-scroll
// =============================================================================

import { useEffect, useRef } from "react";
import { useChatStore } from "../../store/chat";
import { MessageItem } from "./MessageItem";

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-da-text-muted">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-sm">发送一条消息开始对话</p>
          <p className="text-xs mt-1 text-da-text-muted">支持上传文档、检索知识库、生成报告</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-4 py-4 space-y-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {isStreaming && (
        <div className="flex items-center gap-2 text-da-text-muted text-xs pl-4">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-da-accent" style={{ animation: "typing 1.4s infinite ease-in-out", animationDelay: "0s" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-da-accent" style={{ animation: "typing 1.4s infinite ease-in-out", animationDelay: "0.2s" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-da-accent" style={{ animation: "typing 1.4s infinite ease-in-out", animationDelay: "0.4s" }} />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
