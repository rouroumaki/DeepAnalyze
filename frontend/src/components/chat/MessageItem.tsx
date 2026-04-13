import { useMarkdown } from "../../hooks/useMarkdown";
import { ToolCallCard } from "./ToolCallCard";
import { TraceabilityLink } from "./TraceabilityLink";
import { FilePreview } from "../ui/FilePreview";
import { useToast } from "../../hooks/useToast";
import { useUIStore } from "../../store/ui";
import { Copy, RefreshCw, FileDown } from "lucide-react";
import { useState } from "react";
import type { MessageInfo } from "../../types/index";

interface MessageItemProps {
  message: MessageInfo;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === "user";
  const htmlContent = useMarkdown(message.content);
  const [showActions, setShowActions] = useState(false);
  const { success, error: toastError } = useToast();
  const currentKbId = useUIStore((s) => s.currentKbId);
  const navigateToDoc = useUIStore((s) => s.navigateToDoc);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-3)",
        animation: "fadeIn 0.2s ease-out",
        flexDirection: isUser ? "row-reverse" : "row",
        padding: "var(--space-3) var(--space-5)",
      }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "var(--radius-lg)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--text-xs)",
          fontWeight: 700,
          background: isUser
            ? "var(--interactive)"
            : "linear-gradient(135deg, #06b6d4, #3b82f6)",
          color: "#fff",
        }}
      >
        {isUser ? "U" : "AI"}
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: "75%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: isUser ? "flex-end" : "flex-start",
        }}
      >
        {isUser ? (
          <div
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "var(--interactive)",
              color: "#fff",
              borderRadius: "18px 4px 18px 18px",
              fontSize: "var(--text-sm)",
              lineHeight: "var(--leading-relaxed)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {message.content}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {/* Tool calls */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {message.toolCalls.map((tc) => (
                  <ToolCallCard key={tc.id} toolCall={tc} />
                ))}
              </div>
            )}

            {/* Message content */}
            {message.content && (
              <div
                style={{
                  background: "var(--surface-primary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "4px 18px 18px 18px",
                  padding: "var(--space-3) var(--space-4)",
                }}
              >
                <div
                  className="markdown-content"
                  style={{ fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}
                  dangerouslySetInnerHTML={{ __html: htmlContent }}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    // Handle clicks on document reference links
                    const docRef = target.closest<HTMLElement>('[data-doc-id]');
                    if (docRef && currentKbId) {
                      navigateToDoc(currentKbId, docRef.dataset.docId!);
                    }
                  }}
                />
                {/* Traceability links extracted from content */}
                {message.content && (
                  <TraceabilityExtractor content={message.content} />
                )}
              </div>
            )}

            {/* Streaming placeholder */}
            {!message.content && message.isStreaming && (
              <div
                style={{
                  background: "var(--surface-primary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "4px 18px 18px 18px",
                  padding: "var(--space-3) var(--space-4)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--text-tertiary)",
                        animation: "typing 1.2s ease-in-out infinite",
                        animationDelay: `${i * 0.2}s`,
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                  思考中...
                </span>
              </div>
            )}

            {/* AI message action bar */}
            {message.content && showActions && !message.isStreaming && (
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-1)",
                  animation: "fadeIn 0.15s ease-out",
                }}
              >
                <ActionIcon icon={<Copy size={13} />} title="复制" onClick={handleCopy} />
                <ActionIcon icon={<RefreshCw size={13} />} title="重新生成" onClick={() => {}} />
                <ActionIcon icon={<FileDown size={13} />} title="导出报告" onClick={async () => {
                  try {
                    // Use the message content as a basis for generating a report
                    const chatStore = await import("../../store/chat");
                    const sessionId = chatStore.useChatStore.getState().currentSessionId;
                    if (sessionId) {
                      success("正在生成报告...");
                    }
                  } catch {
                    toastError("导出失败");
                  }
                }} />
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div
          style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            marginTop: 4,
          }}
        >
          {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

function ActionIcon({
  icon,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: "var(--radius-md)",
        background: "transparent",
        color: "var(--text-tertiary)",
        cursor: "pointer",
        transition: "all var(--transition-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-tertiary)";
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-tertiary)";
      }}
    >
      {icon}
    </button>
  );
}

function TraceabilityExtractor({ content }: { content: string }) {
  const navigateToDoc = useUIStore((s) => s.navigateToDoc);
  const currentKbId = useUIStore((s) => s.currentKbId);

  // Match patterns like [📄 第3.2条→] or [📄 来源→]
  const pattern = /\[📄\s*(.+?)→\]/g;
  const matches: { full: string; label: string }[] = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    matches.push({ full: match[0], label: match[1] });
  }
  if (matches.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginTop: "var(--space-1)" }}>
      {matches.map((m, i) => (
        <span key={i} onClick={() => { if (currentKbId) navigateToDoc(currentKbId, ""); }} style={{ cursor: "pointer" }}>
          <TraceabilityLink label={m.label} confidence="confirmed" />
        </span>
      ))}
    </div>
  );
}
