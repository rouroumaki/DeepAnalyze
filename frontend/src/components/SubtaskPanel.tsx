import { useState } from "react";
import { useChatStore } from "../store/chat";
import type { AgentTaskInfo } from "../api/client";

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  pending:
    "bg-gray-100 text-gray-600",
  running:
    "bg-blue-100 text-blue-700",
  completed:
    "bg-green-100 text-green-700",
  failed:
    "bg-red-100 text-red-700",
  cancelled:
    "bg-yellow-100 text-yellow-700",
};

const AGENT_TYPE_COLORS: Record<string, string> = {
  explore: "bg-indigo-100 text-indigo-700",
  compile: "bg-purple-100 text-purple-700",
  verify: "bg-amber-100 text-amber-700",
  report: "bg-teal-100 text-teal-700",
  coordinator: "bg-sky-100 text-sky-700",
  general: "bg-gray-100 text-gray-600",
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return (
        <svg
          className="animate-spin w-4 h-4 text-blue-500"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      );
    case "completed":
      return (
        <svg
          className="w-4 h-4 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      );
    case "failed":
      return (
        <svg
          className="w-4 h-4 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      );
    case "cancelled":
      return (
        <svg
          className="w-4 h-4 text-yellow-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
      );
    default:
      // pending
      return (
        <svg
          className="w-4 h-4 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <circle cx="12" cy="12" r="10" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6l4 2"
          />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// TaskItem
// ---------------------------------------------------------------------------

function TaskItem({ task }: { task: AgentTaskInfo }) {
  const [expanded, setExpanded] = useState(false);

  const statusStyle =
    STATUS_STYLES[task.status] ?? "bg-gray-100 text-gray-600";
  const agentStyle =
    AGENT_TYPE_COLORS[task.agentType] ?? "bg-gray-100 text-gray-600";

  // Truncate long input for preview
  const inputPreview =
    task.input.length > 80
      ? task.input.slice(0, 80) + "..."
      : task.input;

  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
      >
        <StatusIcon status={task.status} />

        <span
          className={`text-xs font-medium px-1.5 py-0.5 rounded ${agentStyle}`}
        >
          {task.agentType}
        </span>

        <span
          className={`text-xs font-medium px-1.5 py-0.5 rounded ${statusStyle}`}
        >
          {task.status}
        </span>

        <span className="flex-1 text-sm text-gray-600 truncate ml-1">
          {inputPreview}
        </span>

        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-2">
          {/* Full input */}
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Input
            </span>
            <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap break-words">
              {task.input}
            </p>
          </div>

          {/* Output */}
          {task.output && (
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Output
              </span>
              <div className="mt-0.5 text-sm text-gray-700 bg-gray-50 rounded p-2 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                {task.output}
              </div>
            </div>
          )}

          {/* Error */}
          {task.error && (
            <div>
              <span className="text-xs font-medium text-red-500 uppercase tracking-wider">
                Error
              </span>
              <p className="text-sm text-red-600 mt-0.5 whitespace-pre-wrap break-words">
                {task.error}
              </p>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex gap-4 text-xs text-gray-400 pt-1">
            <span>Created: {new Date(task.createdAt).toLocaleString()}</span>
            {task.completedAt && (
              <span>
                Completed: {new Date(task.completedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubtaskPanel
// ---------------------------------------------------------------------------

export function SubtaskPanel() {
  const [expanded, setExpanded] = useState(false);
  const agentTasks = useChatStore((s) => s.agentTasks);
  const cancelAgentTask = useChatStore((s) => s.cancelAgentTask);

  const taskCount = agentTasks.length;
  const runningCount = agentTasks.filter((t) => t.status === "running").length;
  const completedCount = agentTasks.filter(
    (t) => t.status === "completed",
  ).length;
  const failedCount = agentTasks.filter((t) => t.status === "failed").length;

  // Don't render the panel at all if there are no tasks
  if (taskCount === 0) {
    return null;
  }

  return (
    <div className="border-t border-gray-200 bg-white">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
          <span className="text-sm font-medium text-gray-700">
            Agent Tasks
          </span>
          <span className="text-xs text-gray-400">
            ({taskCount}
            {runningCount > 0 && `, ${runningCount} running`}
            {completedCount > 0 && `, ${completedCount} done`}
            {failedCount > 0 && `, ${failedCount} failed`})
          </span>
        </div>

        {/* Quick status summary dots */}
        <div className="flex gap-1.5">
          {runningCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-blue-400" />
          )}
          {completedCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-green-400" />
          )}
          {failedCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-red-400" />
          )}
        </div>
      </button>

      {/* Task list */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 max-h-80 overflow-y-auto">
          {agentTasks.map((task) => {
            // If the task is running, show a cancel button
            const isRunning = task.status === "running";

            return (
              <div key={task.id} className="relative">
                <TaskItem task={task} />
                {isRunning && (
                  <button
                    type="button"
                    onClick={() => cancelAgentTask(task.id)}
                    className="absolute top-2 right-2 text-xs text-gray-400 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50 cursor-pointer"
                    title="Cancel task"
                  >
                    Cancel
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
