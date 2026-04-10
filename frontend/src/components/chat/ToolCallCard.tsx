import { useState } from "react";
import { ChevronDown, Check, X, Loader2 } from "lucide-react";
import type { ToolCallInfo } from "../../types/index";

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

const TOOL_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  kb_search: { bg: "var(--interactive-light)", border: "rgba(59,130,246,0.2)", text: "var(--interactive)" },
  wiki_browse: { bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.2)", text: "#8b5cf6" },
  expand: { bg: "var(--info-light)", border: "rgba(14,165,233,0.2)", text: "var(--info)" },
  read: { bg: "var(--success-light)", border: "rgba(16,185,129,0.2)", text: "var(--success)" },
  grep: { bg: "var(--warning-light)", border: "rgba(245,158,11,0.2)", text: "var(--warning)" },
  bash: { bg: "var(--error-light)", border: "rgba(239,68,68,0.2)", text: "var(--error)" },
  report_generate: { bg: "rgba(20,184,166,0.08)", border: "rgba(20,184,166,0.2)", text: "#14b8a6" },
  timeline_build: { bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.2)", text: "#6366f1" },
  graph_build: { bg: "rgba(236,72,153,0.08)", border: "rgba(236,72,153,0.2)", text: "#ec4899" },
};

function getToolStyle(toolName: string) {
  return TOOL_STYLES[toolName] ?? { bg: "var(--bg-tertiary)", border: "var(--border-primary)", text: "var(--text-secondary)" };
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return <Loader2 size={14} style={{ animation: "spin 1s linear infinite", color: "var(--warning)" }} />;
    case "completed":
      return <Check size={14} style={{ color: "var(--success)" }} />;
    case "error":
      return <X size={14} style={{ color: "var(--error)" }} />;
    default:
      return null;
  }
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const style = getToolStyle(toolCall.toolName);

  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${style.border}`,
        background: style.bg,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "8px 12px",
          textAlign: "left",
          cursor: "pointer",
          border: "none",
          background: "transparent",
          transition: "background var(--transition-fast)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,0,0,0.03)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <StatusIcon status={toolCall.status} />
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: style.text }}>
          {toolCall.toolName}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {JSON.stringify(toolCall.input).slice(0, 60)}
        </span>
        <ChevronDown
          size={12}
          style={{
            color: "var(--text-tertiary)",
            transition: "transform var(--transition-fast)",
            transform: expanded ? "rotate(180deg)" : "rotate(0)",
          }}
        />
      </button>

      {expanded && (
        <div
          style={{
            borderTop: `1px solid ${style.border}`,
            padding: "var(--space-2) var(--space-3)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            animation: "fadeIn 0.15s ease-out",
          }}
        >
          <div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 4 }}>
              输入参数
            </div>
            <pre
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                background: "var(--bg-primary)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-2)",
                overflowX: "auto",
                maxHeight: 128,
                margin: 0,
              }}
            >
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          {toolCall.output && (
            <div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 4 }}>
                输出结果
              </div>
              <pre
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                  background: "var(--bg-primary)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-2)",
                  overflowX: "auto",
                  maxHeight: 128,
                  margin: 0,
                }}
              >
                {toolCall.output.length > 500 ? toolCall.output.slice(0, 500) + "..." : toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
