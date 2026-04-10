import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../../store/chat";
import { MessageItem } from "./MessageItem";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { MessageSquare } from "lucide-react";

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    }
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isAtBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
          <MessageSquare size={48} strokeWidth={1} style={{ margin: "0 auto var(--space-3)", opacity: 0.3, display: "block" }} />
          <p style={{ fontSize: "var(--text-sm)", margin: 0 }}>发送一条消息开始对话</p>
          <p style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
            支持上传文档、检索知识库、生成报告
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {isStreaming && <ThinkingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
