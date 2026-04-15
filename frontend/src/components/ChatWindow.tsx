import { useState, useEffect, useCallback, useMemo } from "react";
import { useChatStore } from "../store/chat";
import { useUIStore } from "../store/ui";
import { useWorkflowStore } from "../store/workflow";
import { MessageList } from "./chat/MessageList";
import { MessageInput } from "./chat/MessageInput";
import { SubtaskPanel } from "./chat/SubtaskPanel";
import { ScopeSelector } from "./chat/ScopeSelector";
import { SubAgentPanel } from "./teams/SubAgentPanel";
import { useKeyboard } from "../hooks/useKeyboard";
import { api } from "../api/client";
import { Sparkles, Upload, BookOpen, MessageSquare } from "lucide-react";
import type { AnalysisScope } from "../types/index";

interface KbEntry {
  id: string;
  name: string;
  documents: Array<{ id: string; filename: string; status: string }>;
}

export function ChatWindow() {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const createSession = useChatStore((s) => s.createSession);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const currentKbId = useUIStore((s) => s.currentKbId);

  // Workflow state — show SubAgentPanel for each active workflow
  // Get the Map reference (stable identity) and derive array via useMemo
  const activeWorkflows = useWorkflowStore((s) => s.activeWorkflows);
  const activeWorkflowIds = useMemo(
    () => (activeWorkflows ? Array.from(activeWorkflows.keys()) : []),
    [activeWorkflows],
  );

  const [scope, setScope] = useState<AnalysisScope>({ knowledgeBases: [], webSearch: false });
  const [kbList, setKbList] = useState<KbEntry[]>([]);

  // Load knowledge bases with their documents
  useEffect(() => {
    let cancelled = false;
    const loadKbs = async () => {
      try {
        const kbs = await api.listKnowledgeBases();
        if (cancelled) return;
        // Load documents for each KB
        const entries: KbEntry[] = await Promise.all(
          kbs.map(async (kb) => {
            try {
              const docs = await api.listDocuments(kb.id);
              return {
                id: kb.id,
                name: kb.name,
                documents: docs.map((d) => ({ id: d.id, filename: d.filename, status: d.status })),
              };
            } catch {
              return { id: kb.id, name: kb.name, documents: [] };
            }
          }),
        );
        if (!cancelled) setKbList(entries);
      } catch {
        // Non-critical
      }
    };
    loadKbs();
    return () => { cancelled = true; };
  }, []);

  const handleScopeChange = useCallback((newScope: AnalysisScope) => {
    setScope(newScope);
  }, []);

  useKeyboard({ key: "n", ctrl: true }, () => {
    createSession();
  });

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  // Welcome screen when no session active
  if (!currentSessionId || !currentSession) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-primary)",
          padding: "var(--space-8)",
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: 520,
            animation: "fadeIn 0.4s ease-out",
          }}
        >
          {/* Logo */}
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto var(--space-6)",
              borderRadius: "var(--radius-xl)",
              background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 24px rgba(59, 130, 246, 0.25)",
            }}
          >
            <Sparkles size={28} color="#fff" />
          </div>

          <h2
            style={{
              fontSize: "var(--text-3xl)",
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: "0 0 var(--space-2)",
            }}
          >
            DeepAnalyze
          </h2>
          <p
            style={{
              fontSize: "var(--text-base)",
              color: "var(--text-secondary)",
              margin: "0 0 var(--space-8)",
              lineHeight: "var(--leading-relaxed)",
            }}
          >
            深度分析系统 — Agent驱动的文档分析与报告生成平台
          </p>

          {/* Action buttons */}
          <div
            style={{
              display: "flex",
              gap: "var(--space-3)",
              justifyContent: "center",
              marginBottom: "var(--space-8)",
            }}
          >
            <WelcomeAction
              icon={<Upload size={18} />}
              label="上传文档"
              onClick={() => { window.location.hash = "#/knowledge/" + (currentKbId || ""); }}
            />
            <WelcomeAction
              icon={<BookOpen size={18} />}
              label="选择知识库"
              onClick={() => { window.location.hash = "#/knowledge/" + (currentKbId || ""); }}
            />
            <WelcomeAction
              icon={<MessageSquare size={18} />}
              label="开始对话"
              onClick={() => createSession()}
              primary
            />
          </div>

          {/* Quick hints */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-2)",
              justifyContent: "center",
              marginBottom: "var(--space-6)",
            }}
          >
            {["分析一份文档的关键条款", "提取文档中的时间线", "对比分析多份文档的差异"].map(
              (hint) => (
                <button
                  key={hint}
                  onClick={async () => {
                    const sessionId = await createSession();
                    if (sessionId) {
                      sendMessage(hint);
                    }
                  }}
                  style={{
                    padding: "var(--space-1) var(--space-3)",
                    background: "var(--surface-primary)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "var(--radius-full)",
                    fontSize: "var(--text-sm)",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--interactive)";
                    e.currentTarget.style.color = "var(--interactive)";
                    e.currentTarget.style.background = "var(--interactive-light)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-primary)";
                    e.currentTarget.style.color = "var(--text-secondary)";
                    e.currentTarget.style.background = "var(--surface-primary)";
                  }}
                >
                  {hint}
                </button>
              ),
            )}
          </div>

          {/* Scope selector on welcome screen */}
          {kbList.length > 0 && (
            <div style={{ maxWidth: 480, margin: "0 auto" }}>
              <p style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
                marginBottom: "var(--space-2)",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
              }}>
                分析范围
              </p>
              <ScopeSelector kbList={kbList} currentKbId={currentKbId} onScopeChange={handleScopeChange} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active chat session
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-primary)",
      }}
    >
      {/* Chat header bar */}
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-4)",
          borderBottom: "1px solid var(--border-primary)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentSession.title || "新对话"}
        </span>
        <ScopeSelector kbList={kbList} currentKbId={currentKbId} onScopeChange={handleScopeChange} />
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <MessageList />
      </div>

      {/* Subtask progress */}
      <SubtaskPanel />

      {/* Active workflow sub-agent panels */}
      {activeWorkflowIds.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: 240, overflowY: "auto" }}>
          {activeWorkflowIds.map((wfId) => (
            <SubAgentPanel key={wfId} workflowId={wfId} />
          ))}
        </div>
      )}

      {/* Input */}
      <MessageInput />
    </div>
  );
}

function WelcomeAction({
  icon,
  label,
  onClick,
  primary = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-4)",
        border: primary ? "none" : "1px solid var(--border-primary)",
        borderRadius: "var(--radius-xl)",
        background: primary ? "var(--brand-primary)" : "var(--surface-primary)",
        color: primary ? "var(--brand-foreground)" : "var(--text-secondary)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        cursor: "pointer",
        transition: "all var(--transition-fast)",
        boxShadow: primary ? "var(--shadow-md)" : "none",
      }}
      onMouseEnter={(e) => {
        if (primary) {
          e.currentTarget.style.background = "var(--brand-hover)";
          e.currentTarget.style.boxShadow = "var(--shadow-lg)";
        } else {
          e.currentTarget.style.borderColor = "var(--interactive)";
          e.currentTarget.style.color = "var(--interactive)";
        }
      }}
      onMouseLeave={(e) => {
        if (primary) {
          e.currentTarget.style.background = "var(--brand-primary)";
          e.currentTarget.style.boxShadow = "var(--shadow-md)";
        } else {
          e.currentTarget.style.borderColor = "var(--border-primary)";
          e.currentTarget.style.color = "var(--text-secondary)";
        }
      }}
    >
      {icon}
      {label}
    </button>
  );
}
