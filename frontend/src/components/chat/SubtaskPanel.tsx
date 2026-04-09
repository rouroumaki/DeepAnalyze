// =============================================================================
// DeepAnalyze - SubtaskPanel Component
// Collapsible panel showing agent task progress
// =============================================================================

import { useState } from "react";
import { useChatStore } from "../../store/chat";
import type { AgentTaskInfo } from "../../types/index";

const AGENT_COLORS: Record<string, { bg: string; text: string }> = {
  explore: { bg: "bg-indigo-500/10", text: "text-indigo-400" },
  compile: { bg: "bg-purple-500/10", text: "text-purple-400" },
  verify: { bg: "bg-amber-500/10", text: "text-amber-400" },
  report: { bg: "bg-teal-500/10", text: "text-teal-400" },
  coordinator: { bg: "bg-sky-500/10", text: "text-sky-400" },
  general: { bg: "bg-gray-500/10", text: "text-gray-400" },
};

function getAgentColor(type: string) {
  return AGENT_COLORS[type] ?? AGENT_COLORS.general;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return (
        <svg className="w-3.5 h-3.5 animate-spin text-da-amber" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      );
    case "completed":
      return <svg className="w-3.5 h-3.5 text-da-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
    case "failed":
      return <svg className="w-3.5 h-3.5 text-da-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
    case "pending":
      return <svg className="w-3.5 h-3.5 text-da-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
    case "cancelled":
      return <svg className="w-3.5 h-3.5 text-da-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>;
    default:
      return null;
  }
}

function TaskItem({ task }: { task: AgentTaskInfo }) {
  const [expanded, setExpanded] = useState(false);
  const cancelAgentTask = useChatStore((s) => s.cancelAgentTask);
  const colors = getAgentColor(task.agentType);

  return (
    <div className="border border-da-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-da-bg-hover transition-colors cursor-pointer"
      >
        <StatusIcon status={task.status} />
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
          {task.agentType}
        </span>
        <span className="text-xs text-da-text-secondary flex-1 truncate">
          {task.input.slice(0, 50)}
        </span>
        {task.status === "running" && (
          <button
            onClick={(e) => { e.stopPropagation(); cancelAgentTask(task.id); }}
            className="text-da-text-muted hover:text-da-red text-xs cursor-pointer"
          >
            取消
          </button>
        )}
        <svg
          className={`w-3 h-3 text-da-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-da-border px-3 py-2 space-y-1.5 bg-da-bg/50">
          {task.input && (
            <div>
              <span className="text-[10px] text-da-text-muted">输入:</span>
              <pre className="text-xs text-da-text-secondary mt-0.5 whitespace-pre-wrap">{task.input}</pre>
            </div>
          )}
          {task.output && (
            <div>
              <span className="text-[10px] text-da-text-muted">输出:</span>
              <pre className="text-xs text-da-text-secondary mt-0.5 whitespace-pre-wrap max-h-32 overflow-y-auto">
                {task.output.length > 500 ? task.output.slice(0, 500) + "..." : task.output}
              </pre>
            </div>
          )}
          {task.error && (
            <div>
              <span className="text-[10px] text-da-red">错误:</span>
              <pre className="text-xs text-da-red mt-0.5 whitespace-pre-wrap">{task.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SubtaskPanel() {
  const agentTasks = useChatStore((s) => s.agentTasks);
  const [collapsed, setCollapsed] = useState(false);

  if (agentTasks.length === 0) return null;

  const running = agentTasks.filter((t) => t.status === "running" || t.status === "pending").length;
  const completed = agentTasks.filter((t) => t.status === "completed").length;
  const failed = agentTasks.filter((t) => t.status === "failed").length;

  return (
    <div className={`shrink-0 border-t border-da-border bg-da-bg-secondary ${collapsed ? "" : "max-h-48"}`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left cursor-pointer hover:bg-da-bg-hover transition-colors"
      >
        <svg className={`w-3 h-3 text-da-text-muted transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        <span className="text-xs font-medium text-da-text-secondary">Agent 任务</span>
        {running > 0 && <span className="w-2 h-2 rounded-full bg-da-accent" />}
        {completed > 0 && <span className="w-2 h-2 rounded-full bg-da-green" />}
        {failed > 0 && <span className="w-2 h-2 rounded-full bg-da-red" />}
        <span className="text-[10px] text-da-text-muted">
          {running > 0 ? `${running} 运行中` : `${completed} 完成`}
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-2 space-y-1 overflow-y-auto max-h-36">
          {agentTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
