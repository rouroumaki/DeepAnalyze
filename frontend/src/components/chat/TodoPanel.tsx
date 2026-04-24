import { useChatStore } from "../../store/chat";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

/**
 * Displays the agent's real-time task list (todo items).
 * Shown above the chat when the agent has active tasks.
 */
export function TodoPanel() {
  const todos = useChatStore((s) => s.todos);

  if (!todos || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div
      style={{
        padding: "var(--space-2) var(--space-3)",
        background: "var(--surface-primary)",
        borderBottom: "1px solid var(--border-primary)",
        fontSize: "var(--text-xs)",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: todos.length > 0 ? "var(--space-2)" : 0,
      }}>
        <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
          Task Progress
        </span>
        <span style={{ color: "var(--text-tertiary)" }}>
          {completed}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 3,
        background: "var(--bg-tertiary)",
        borderRadius: 2,
        marginBottom: "var(--space-2)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${progress}%`,
          background: "linear-gradient(90deg, #3b82f6, #06b6d4)",
          borderRadius: 2,
          transition: "width 0.3s ease",
        }} />
      </div>

      {/* Task list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {todos.map((todo) => (
          <div
            key={todo.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "2px 0",
              opacity: todo.status === "completed" ? 0.6 : 1,
            }}
          >
            {todo.status === "completed" ? (
              <CheckCircle2 size={12} style={{ color: "#22c55e", flexShrink: 0 }} />
            ) : todo.status === "in_progress" ? (
              <Loader2 size={12} style={{ color: "#3b82f6", flexShrink: 0, animation: "spin 1s linear infinite" }} />
            ) : (
              <Circle size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
            )}
            <span style={{
              color: todo.status === "completed" ? "var(--text-tertiary)" : "var(--text-primary)",
              textDecoration: todo.status === "completed" ? "line-through" : "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {todo.subject}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
