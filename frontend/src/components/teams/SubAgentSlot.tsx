// =============================================================================
// DeepAnalyze - SubAgentSlot Component
// Single agent card showing status, progress, messages and tool calls
// =============================================================================

import { useRef, useEffect } from "react";
import { Wrench, MessageSquare } from "lucide-react";
import type { AgentState } from "../../store/workflow";

// ---------------------------------------------------------------------------
// Status colour mapping
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { dot: string; bg: string; label: string }> = {
  queued: { dot: "var(--text-tertiary)", bg: "var(--bg-tertiary)", label: "排队中" },
  running: { dot: "var(--success)", bg: "color-mix(in srgb, var(--success) 12%, transparent)", label: "运行中" },
  waiting: { dot: "var(--warning)", bg: "color-mix(in srgb, var(--warning) 12%, transparent)", label: "等待中" },
  completed: { dot: "var(--interactive)", bg: "color-mix(in srgb, var(--interactive) 12%, transparent)", label: "已完成" },
  error: { dot: "var(--error)", bg: "color-mix(in srgb, var(--error) 12%, transparent)", label: "错误" },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SubAgentSlotProps {
  /** Role name shown on the card header */
  role: string;
  /** Task description */
  task: string;
  /** Current agent status */
  status: AgentState["status"];
  /** Duration in seconds (0 while running) */
  duration: number;
  /** Total number of tool calls made */
  toolCallCount: number;
  /** Progress percentage 0-100 */
  progress: number;
  /** Message log entries */
  messages: Array<{ type: string; content: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "-";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m${s}s`;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubAgentSlot({
  role,
  task,
  status,
  duration,
  toolCallCount,
  progress,
  messages,
}: SubAgentSlotProps) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.queued;
  const isRunning = status === "running";
  const lastMessages = messages.slice(-5);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll message list to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div
      style={{
        border: "1px solid var(--border-primary)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "box-shadow var(--transition-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 8px color-mix(in srgb, var(--bg-primary) 80%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* ---- Header ---- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--border-primary)",
          background: "var(--bg-tertiary)",
        }}
      >
        {/* Status dot */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "var(--radius-full)",
            background: colors.dot,
            flexShrink: 0,
            animation: isRunning ? "pulse 1.5s ease-in-out infinite" : "none",
          }}
        />

        {/* Role name */}
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--font-semibold)",
            color: "var(--text-primary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {role}
        </span>

        {/* Status label */}
        <span
          style={{
            fontSize: 10,
            fontWeight: "var(--font-medium)",
            color: colors.dot,
            padding: "1px 6px",
            borderRadius: "var(--radius-sm)",
            background: colors.bg,
          }}
        >
          {colors.label}
        </span>

        {/* Tool call count badge */}
        {toolCallCount > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 10,
              color: "var(--text-secondary)",
              background: "var(--bg-tertiary)",
              padding: "1px 6px",
              borderRadius: "var(--radius-sm)",
              flexShrink: 0,
            }}
          >
            <Wrench size={10} />
            {toolCallCount}
          </span>
        )}

        {/* Duration */}
        <span
          style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            flexShrink: 0,
            fontFamily: "monospace",
          }}
        >
          {formatDuration(duration)}
        </span>
      </div>

      {/* ---- Task description ---- */}
      <div
        style={{
          padding: "var(--space-2) var(--space-3)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          lineHeight: 1.4,
          borderBottom: progress > 0 && progress < 100 ? "none" : "1px solid var(--border-primary)",
        }}
      >
        {truncate(task, 120)}
      </div>

      {/* ---- Progress bar ---- */}
      {progress > 0 && (
        <div
          style={{
            height: 3,
            background: "var(--bg-tertiary)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(progress, 100)}%`,
              background: status === "error" ? "var(--error)" : "var(--interactive)",
              borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}

      {/* ---- Message list (last 5, scrollable) ---- */}
      {lastMessages.length > 0 && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: 96,
            overflowY: "auto",
            padding: "var(--space-1) var(--space-3)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            borderTop: "1px solid var(--border-primary)",
          }}
        >
          {lastMessages.map((msg, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                lineHeight: 1.4,
                color:
                  msg.type === "error"
                    ? "var(--error)"
                    : msg.type === "tool_call" || msg.type === "tool_result"
                      ? "var(--text-tertiary)"
                      : "var(--text-secondary)",
                display: "flex",
                gap: "var(--space-1)",
                alignItems: "flex-start",
              }}
            >
              {(msg.type === "tool_call" || msg.type === "tool_result") ? (
                <Wrench size={9} style={{ flexShrink: 0, marginTop: 1 }} />
              ) : msg.type === "chunk" || msg.type === "output" ? (
                <MessageSquare size={9} style={{ flexShrink: 0, marginTop: 1 }} />
              ) : null}
              <span
                style={{
                  wordBreak: "break-all",
                  overflow: "hidden",
                }}
              >
                {truncate(msg.content, 200)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
