import { useMarkdown } from "../../hooks/useMarkdown";
import { ToolCallCard } from "./ToolCallCard";
import { TraceabilityLink } from "./TraceabilityLink";
import { FilePreview } from "../ui/FilePreview";
import { useToast } from "../../hooks/useToast";
import { useUIStore } from "../../store/ui";
import { Copy, RefreshCw, FileDown, FileText, ExternalLink } from "lucide-react";
import { useState, useMemo } from "react";
import type { MessageInfo } from "../../types/index";
import { useChatStore } from "../../store/chat";
import DOMPurify from "dompurify";

/** Escape a string for safe embedding in an HTML attribute value. */
function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Replace [[doc:docId|文档名]] or [[文档名]] patterns in rendered HTML
 * with clickable spans that have data-doc-id attributes.
 */
function processDocRefs(html: string): string {
  // Match [[doc:xxx|yyy]] — explicit doc reference with ID
  let result = html.replace(
    /\[\[doc:([^\|]+)\|([^\]]+)\]\]/g,
    (_match, docId: string, label: string) =>
      `<span data-doc-id="${escapeHtmlAttr(docId)}" style="color:var(--interactive);cursor:pointer;text-decoration:underline;border-bottom:1px dashed var(--interactive)">${escapeHtmlAttr(label)}</span>`,
  );
  // Match [[文档名]] — simple reference without doc ID
  result = result.replace(
    /\[\[([^\]:\|]+)\]\]/g,
    (_match, label: string) =>
      `<span data-doc-ref="${escapeHtmlAttr(label)}" style="color:var(--interactive);cursor:pointer;border-bottom:1px dashed var(--interactive)">${escapeHtmlAttr(label)}</span>`,
  );
  return result;
}

interface MessageItemProps {
  message: MessageInfo;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === "user";
  const [hoveredRef, setHoveredRef] = useState<{ id: string; name: string; rect: DOMRect } | null>(null);
  const rawHtml = useMarkdown(message.content);
  const htmlContent = useMemo(() => {
    const processed = processDocRefs(rawHtml);
    return DOMPurify.sanitize(processed, {
      ALLOWED_TAGS: [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "br", "hr",
        "ul", "ol", "li",
        "blockquote", "pre", "code",
        "strong", "em", "del", "s",
        "a", "img",
        "table", "thead", "tbody", "tr", "th", "td",
        "span", "div",
        "input",
      ],
      ALLOWED_ATTR: [
        "href", "target", "rel",
        "class", "id",
        "checked", "disabled", "type",
        "alt", "src", "title",
        "style",
        "data-doc-id", "data-doc-ref", "data-doc-name",
      ],
      ADD_TAGS: ["code"],
    });
  }, [rawHtml]);
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

            {/* Message content — report or normal markdown */}
            {message.report ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {/* Report badge */}
                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "2px 8px",
                  background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-xs)",
                  color: "#fff",
                  fontWeight: 600,
                  width: "fit-content",
                }}>
                  <FileText size={12} />
                  {message.report.title}
                </div>
                {/* Full report content rendered as markdown */}
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
                      const docRef = target.closest<HTMLElement>('[data-doc-id]');
                      if (docRef && currentKbId) {
                        navigateToDoc(currentKbId, docRef.dataset.docId!);
                        return;
                      }
                      const namedRef = target.closest<HTMLElement>('[data-doc-ref]');
                      if (namedRef && currentKbId) {
                        navigateToDoc(currentKbId, "");
                      }
                    }}
                  />
                </div>
                {/* Report actions: download + view in report page */}
                <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <button
                    onClick={async () => {
                      try {
                        const blob = new Blob([message.content], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${message.report?.title || 'report'}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                        success("报告已下载");
                      } catch {
                        toastError("下载失败");
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "4px 12px",
                      background: "var(--bg-hover)",
                      color: "var(--text-secondary)",
                      fontSize: "var(--text-xs)",
                      fontWeight: 500,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-primary)",
                      cursor: "pointer",
                      transition: "background var(--transition-fast)",
                    }}
                  >
                    <FileDown size={12} />
                    下载报告
                  </button>
                  {message.report?.id && (
                    <button
                      onClick={() => { window.location.hash = "#/reports"; }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        padding: "4px 12px",
                        background: "var(--bg-hover)",
                        color: "var(--text-secondary)",
                        fontSize: "var(--text-xs)",
                        fontWeight: 500,
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-primary)",
                        cursor: "pointer",
                        transition: "background var(--transition-fast)",
                      }}
                    >
                      <ExternalLink size={12} />
                      查看报告页
                    </button>
                  )}
                </div>
              </div>
            ) : message.content ? (
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
                  style={{ fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)", position: "relative" }}
                  dangerouslySetInnerHTML={{ __html: htmlContent }}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    // Handle clicks on document reference links
                    const docRef = target.closest<HTMLElement>('[data-doc-id]');
                    if (docRef && currentKbId) {
                      navigateToDoc(currentKbId, docRef.dataset.docId!);
                      return;
                    }
                    // Handle simple doc name references (no docId, just navigate to KB)
                    const namedRef = target.closest<HTMLElement>('[data-doc-ref]');
                    if (namedRef && currentKbId) {
                      navigateToDoc(currentKbId, "");
                    }
                  }}
                  onMouseOver={(e) => {
                    const target = e.target as HTMLElement;
                    const docRef = target.closest<HTMLElement>('[data-doc-id]');
                    if (docRef) {
                      const rect = docRef.getBoundingClientRect();
                      setHoveredRef({
                        id: docRef.dataset.docId || "",
                        name: docRef.textContent || "",
                        rect,
                      });
                    } else {
                      const namedRef = target.closest<HTMLElement>('[data-doc-ref]');
                      if (namedRef) {
                        const rect = namedRef.getBoundingClientRect();
                        setHoveredRef({
                          id: "",
                          name: namedRef.textContent || "",
                          rect,
                        });
                      }
                    }
                  }}
                  onMouseOut={(e) => {
                    const target = e.target as HTMLElement;
                    const docRef = target.closest<HTMLElement>('[data-doc-id],[data-doc-ref]');
                    if (!docRef) {
                      setHoveredRef(null);
                    }
                  }}
                />
                {/* Hover preview popover for document references */}
                {hoveredRef && (
                  <div
                    style={{
                      position: "fixed",
                      left: hoveredRef.rect.left,
                      top: hoveredRef.rect.bottom + 4,
                      minWidth: 200,
                      maxWidth: 320,
                      padding: "8px 12px",
                      background: "var(--surface-primary)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: "var(--radius-md)",
                      boxShadow: "var(--shadow-lg)",
                      zIndex: 9999,
                      fontSize: "var(--text-xs)",
                      color: "var(--text-primary)",
                      pointerEvents: "none",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {hoveredRef.name || hoveredRef.id}
                    </div>
                    <div style={{ color: "var(--text-tertiary)" }}>
                      {hoveredRef.id ? `文档 ID: ${hoveredRef.id.substring(0, 8)}...` : "文档引用"}
                    </div>
                  </div>
                )}
                {/* Traceability links extracted from content */}
                {message.content && (
                  <TraceabilityExtractor content={message.content} />
                )}
              </div>
            ) : null}

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
                <ActionIcon icon={<RefreshCw size={13} />} title="重新生成" onClick={() => useChatStore.getState().regenerateMessage(message.id)} />
                <ActionIcon icon={<FileDown size={13} />} title="导出报告" onClick={async () => {
                  try {
                    const reportId = message.report?.id;
                    if (reportId) {
                      window.open(`/api/reports/reports/${reportId}/export`, '_blank');
                    } else {
                      const blob = new Blob([message.content], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `report-${Date.now()}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                    success("报告已导出");
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
      {matches.map((m) => (
        <span key={m.label} onClick={() => { if (currentKbId) navigateToDoc(currentKbId, ""); }} style={{ cursor: "pointer" }}>
          <TraceabilityLink label={m.label} confidence="confirmed" />
        </span>
      ))}
    </div>
  );
}
