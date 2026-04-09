// =============================================================================
// DeepAnalyze - MessageItem Component
// Renders a single chat message with markdown support
// =============================================================================

import { useMarkdown } from "../../hooks/useMarkdown";
import { ToolCallCard } from "./ToolCallCard";
import type { MessageInfo } from "../../types/index";

interface MessageItemProps {
  message: MessageInfo;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === "user";
  const htmlContent = useMarkdown(message.content);

  return (
    <div className={`flex gap-3 animate-fade-in ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-xs font-bold ${
          isUser
            ? "bg-da-accent text-white"
            : "bg-gradient-to-br from-cyan-500 to-blue-600 text-white"
        }`}
      >
        {isUser ? "U" : "AI"}
      </div>

      {/* Content */}
      <div className={`max-w-[75%] min-w-0 ${isUser ? "text-right" : ""}`}>
        {isUser ? (
          <div className="inline-block px-4 py-2.5 bg-da-accent text-white rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Tool calls */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="space-y-1.5">
                {message.toolCalls.map((tc) => (
                  <ToolCallCard key={tc.id} toolCall={tc} />
                ))}
              </div>
            )}

            {/* Message content */}
            {message.content && (
              <div className="bg-da-surface border border-da-border rounded-2xl rounded-tl-sm px-4 py-3">
                <div
                  className="markdown-content text-sm text-da-text leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: htmlContent }}
                />
              </div>
            )}

            {/* Streaming placeholder when no content yet */}
            {!message.content && message.isStreaming && (
              <div className="bg-da-surface border border-da-border rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex items-center gap-2 text-da-text-muted text-sm">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  思考中...
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div className={`text-[10px] text-da-text-muted mt-1 ${isUser ? "text-right" : ""}`}>
          {new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}
