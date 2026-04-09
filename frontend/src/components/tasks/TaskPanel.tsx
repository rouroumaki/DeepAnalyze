// =============================================================================
// DeepAnalyze - TaskPanel Component
// Shows all agent tasks across sessions
// =============================================================================

import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { AgentTaskInfo } from "../../types/index";
import { useChatStore } from "../../store/chat";

export function TaskPanel() {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sessionTasks = useChatStore((s) => s.agentTasks);
  const cancelAgentTask = useChatStore((s) => s.cancelAgentTask);
  const [allTasks, setAllTasks] = useState<AgentTaskInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentSessionId) return;
    setLoading(true);
    api.getAgentTasks(currentSessionId)
      .then((tasks) => setAllTasks(tasks))
      .catch(() => setAllTasks([]))
      .finally(() => setLoading(false));
  }, [currentSessionId, sessionTasks]);

  const running = allTasks.filter((t) => t.status === "running" || t.status === "pending");
  const done = allTasks.filter((t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled");

  return (
    <div className="h-full flex flex-col bg-da-bg">
      {/* Header */}
      <div className="shrink-0 border-b border-da-border px-4 py-3 bg-da-bg-secondary">
        <h3 className="text-sm font-medium text-da-text">Agent 任务面板</h3>
        <div className="flex items-center gap-3 mt-1 text-xs text-da-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-da-accent" />
            {running.length} 运行中
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-da-green" />
            {done.filter((t) => t.status === "completed").length} 完成
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-da-red" />
            {done.filter((t) => t.status === "failed").length} 失败
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-center py-8 text-da-text-muted">加载中...</div>
        ) : allTasks.length === 0 ? (
          <div className="text-center py-12 text-da-text-muted">
            <p>暂无任务</p>
            <p className="text-xs mt-1">在对话中向 Agent 提交分析任务</p>
          </div>
        ) : (
          <>
            {/* Running Tasks */}
            {running.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-da-text-muted mb-2">运行中</h4>
                <div className="space-y-2">
                  {running.map((task) => (
                    <TaskCard key={task.id} task={task} onCancel={cancelAgentTask} />
                  ))}
                </div>
              </div>
            )}

            {/* Completed Tasks */}
            {done.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-da-text-muted mb-2">已完成</h4>
                <div className="space-y-2">
                  {done.slice(0, 20).map((task) => (
                    <TaskCard key={task.id} task={task} onCancel={cancelAgentTask} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onCancel }: { task: AgentTaskInfo; onCancel: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig: Record<string, { color: string; label: string }> = {
    pending: { color: "text-da-text-muted", label: "等待" },
    running: { color: "text-da-amber", label: "运行中" },
    completed: { color: "text-da-green", label: "完成" },
    failed: { color: "text-da-red", label: "失败" },
    cancelled: { color: "text-da-text-muted", label: "已取消" },
  };

  const config = statusConfig[task.status] ?? statusConfig.pending;

  return (
    <div className="border border-da-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-da-bg-hover transition-colors cursor-pointer"
      >
        <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-da-bg-tertiary text-da-text-secondary">
          {task.agentType}
        </span>
        <span className="text-sm text-da-text flex-1 truncate">{task.input.slice(0, 60)}</span>
        {task.status === "running" && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}
            className="text-xs text-da-text-muted hover:text-da-red cursor-pointer"
          >
            取消
          </button>
        )}
        <svg className={`w-3 h-3 text-da-text-muted transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-da-border px-4 py-3 space-y-2 bg-da-bg/50 text-sm">
          {task.input && <div><span className="text-xs text-da-text-muted">输入:</span><pre className="text-xs text-da-text-secondary mt-1 whitespace-pre-wrap">{task.input}</pre></div>}
          {task.output && <div><span className="text-xs text-da-text-muted">输出:</span><pre className="text-xs text-da-text-secondary mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">{task.output}</pre></div>}
          {task.error && <div><span className="text-xs text-da-red">错误:</span><pre className="text-xs text-da-red mt-1">{task.error}</pre></div>}
          <div className="text-[10px] text-da-text-muted">
            创建: {new Date(task.createdAt).toLocaleString("zh-CN")}
            {task.completedAt && ` | 完成: ${new Date(task.completedAt).toLocaleString("zh-CN")}`}
          </div>
        </div>
      )}
    </div>
  );
}
