// =============================================================================
// DeepAnalyze - SubAgentPanel Component
// Workflow panel showing a grid of SubAgentSlot components for active workflows
// =============================================================================

import { useMemo } from "react";
import { useWorkflowStore } from "../../store/workflow";
import { SubAgentSlot } from "./SubAgentSlot";
import { Users, Clock, CheckCircle2, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SubAgentPanelProps {
  /** The workflow ID to display */
  workflowId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeSince(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

const MODE_LABELS: Record<string, string> = {
  pipeline: "Pipeline",
  graph: "Graph",
  council: "Council",
  parallel: "Parallel",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubAgentPanel({ workflowId }: SubAgentPanelProps) {
  const activeWorkflows = useWorkflowStore((s) => s.activeWorkflows);

  const workflow = useMemo(() => activeWorkflows.get(workflowId), [activeWorkflows, workflowId]);

  if (!workflow) {
    return (
      <div
        style={{
          padding: "var(--space-4)",
          textAlign: "center",
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
        }}
      >
        No active workflow found.
      </div>
    );
  }

  const agents = Array.from(workflow.agents.values());
  const completedCount = agents.filter((a) => a.status === "completed").length;
  const errorCount = agents.filter((a) => a.status === "error").length;
  const runningCount = agents.filter((a) => a.status === "running").length;
  const isComplete = agents.length > 0 && completedCount + errorCount === agents.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ---- Header ---- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--border-primary)",
          background: "var(--bg-secondary)",
          flexShrink: 0,
        }}
      >
        <Users size={16} style={{ color: "var(--interactive)", flexShrink: 0 }} />

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
          {workflow.teamName}
        </span>

        {/* Mode badge */}
        <span
          style={{
            fontSize: 10,
            fontWeight: "var(--font-medium)",
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
          }}
        >
          {MODE_LABELS[workflow.mode] ?? workflow.mode}
        </span>

        {/* Agent count */}
        <span
          style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Users size={10} />
          {agents.length}
        </span>

        {/* Elapsed time */}
        <span
          style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Clock size={10} />
          {formatTimeSince(workflow.startedAt)}
        </span>

        {/* Completion status */}
        {isComplete && (
          <span
            style={{
              fontSize: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              color: errorCount > 0 ? "var(--error)" : "var(--success)",
            }}
          >
            {errorCount > 0 ? (
              <>
                <AlertCircle size={10} />
                {errorCount} failed
              </>
            ) : (
              <>
                <CheckCircle2 size={10} />
                Done
              </>
            )}
          </span>
        )}

        {runningCount > 0 && (
          <span
            style={{
              fontSize: 10,
              color: "var(--success)",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            {runningCount} running
          </span>
        )}
      </div>

      {/* ---- Agent grid (2 columns) ---- */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--space-3)",
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "var(--space-3)",
          alignContent: "start",
        }}
      >
        {agents.map((agent) => (
          <SubAgentSlot
            key={agent.agentId}
            role={agent.role}
            task={agent.task}
            status={agent.status}
            duration={agent.duration}
            toolCallCount={agent.toolCallCount}
            progress={agent.progress}
            messages={agent.messages}
          />
        ))}

        {agents.length === 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              textAlign: "center",
              padding: "var(--space-6)",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-sm)",
            }}
          >
            Waiting for agents to start...
          </div>
        )}
      </div>
    </div>
  );
}
