import { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore } from "../../store/chat";
import { useFileUpload } from "../../hooks/useFileUpload";
import { FilePreview } from "../ui/FilePreview";
import { Send, Square, Paperclip, Loader2 } from "lucide-react";

export function MessageInput() {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSending = useChatStore((s) => s.isSending);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const { uploads, addFiles, selectFiles, removeUpload, hasPending } = useFileUpload();

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
    // Send via HTTP API - backend /api/agents/run handles message save + agent execution
    sendMessage(content);
    textareaRef.current?.focus();
  }, [canSend, text, sendMessage]);

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
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files.length > 0) {
          addFiles(e.dataTransfer.files);
        }
      }}
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--border-primary)",
        background: "var(--bg-secondary)",
        padding: "var(--space-3) var(--space-4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "var(--space-2)",
          maxWidth: 800,
          margin: "0 auto",
        }}
      >
        {/* Attach button */}
        <button
          title="添加附件"
          onClick={() => selectFiles()}
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-lg)",
            background: "var(--surface-primary)",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            transition: "all var(--transition-fast)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--interactive)";
            e.currentTarget.style.color = "var(--interactive)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-primary)";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <Paperclip size={16} />
        </button>

        {/* Textarea */}
        <div style={{ flex: 1, position: "relative" }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={1}
            disabled={isSending}
            style={{
              width: "100%",
              padding: "9px 14px",
              background: "var(--surface-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-xl)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
              lineHeight: "var(--leading-normal)",
              resize: "none",
              outline: "none",
              transition: "border-color var(--transition-fast), box-shadow var(--transition-fast)",
              fontFamily: "inherit",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--border-focus)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(51, 65, 85, 0.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border-primary)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Send / Stop button */}
        <button
          onClick={isStreaming ? stopStreaming : handleSend}
          disabled={!isStreaming && !canSend}
          title={isStreaming ? "停止生成" : "发送消息"}
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: "var(--radius-lg)",
            background: canSend || isStreaming ? "var(--brand-primary)" : "var(--bg-tertiary)",
            color: canSend || isStreaming ? "var(--brand-foreground)" : "var(--text-disabled)",
            cursor: canSend || isStreaming ? "pointer" : "not-allowed",
            transition: "all var(--transition-fast)",
          }}
        >
          {isStreaming ? <Square size={14} /> : <Send size={16} />}
        </button>
      </div>
      {uploads.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginTop: "var(--space-2)", maxWidth: 800, marginLeft: "auto", marginRight: "auto" }}>
          {uploads.map((u) => (
            <div key={u.id} style={{ position: "relative" }}>
              <FilePreview filename={u.file.name} fileType={u.file.type} fileSize={u.file.size} onRemove={() => removeUpload(u.id)} />
              {u.status === "uploading" && (
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "var(--bg-tertiary)", borderRadius: 1 }}>
                  <div style={{ width: `${u.progress}%`, height: "100%", background: "var(--interactive)", borderRadius: 1, transition: "width 0.3s" }} />
                </div>
              )}
              {u.status === "error" && (
                <span style={{ fontSize: 9, color: "var(--error)" }}>失败</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
