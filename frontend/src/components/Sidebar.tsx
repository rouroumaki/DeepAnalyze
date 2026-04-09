// =============================================================================
// DeepAnalyze - Sidebar Component
// Session list management with dark theme
// =============================================================================

import { useChatStore } from "../store/chat";
import { useState } from "react";

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const isLoading = useChatStore((s) => s.isLoading);
  const createSession = useChatStore((s) => s.createSession);
  const selectSession = useChatStore((s) => s.selectSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleNewChat = async () => {
    await createSession();
  };

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await deleteSession(sessionId);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "昨天";
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
    }
  };

  return (
    <div className="w-64 min-w-[256px] h-full bg-da-bg-secondary border-r border-da-border flex flex-col">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-da-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-sm font-bold text-white">
            D
          </div>
          <div>
            <div className="text-sm font-semibold text-da-text">DeepAnalyze</div>
            <div className="text-[10px] text-da-text-muted">深度分析系统</div>
          </div>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-3 py-3">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-da-accent hover:bg-da-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新建对话
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {isLoading && sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-da-text-muted text-sm">加载中...</div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-da-text-muted text-sm">
            暂无对话
            <br />
            <span className="text-xs">点击上方按钮开始</span>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => selectSession(session.id)}
                onMouseEnter={() => setHoveredId(session.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  currentSessionId === session.id
                    ? "bg-da-accent/10 text-da-text border border-da-accent/20"
                    : "text-da-text-secondary hover:bg-da-bg-hover hover:text-da-text"
                }`}
              >
                <svg
                  className="w-4 h-4 shrink-0 opacity-50"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{session.title || "新对话"}</div>
                  <div className="text-[11px] text-da-text-muted mt-0.5">
                    {formatDate(session.createdAt)}
                  </div>
                </div>
                {hoveredId === session.id && (
                  <button
                    onClick={(e) => handleDelete(e, session.id)}
                    className="p-1 rounded hover:bg-red-500/20 text-da-text-muted hover:text-da-red transition-colors shrink-0"
                    title="删除对话"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-da-border text-[10px] text-da-text-muted">
        DeepAnalyze v0.1.0
      </div>
    </div>
  );
}
