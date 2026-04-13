import { Component, useEffect, lazy, Suspense, type ReactNode } from "react";
import { useChatStore } from "./store/chat";
import { useUIStore } from "./store/ui";
import { AppLayout } from "./components/layout/AppLayout";
import { Spinner } from "./components/ui/Spinner";
import { api } from "./api/client";

const ChatWindow = lazy(() => import("./components/ChatWindow").then(m => ({ default: m.ChatWindow })));
const KnowledgePanel = lazy(() => import("./components/knowledge/KnowledgePanel").then(m => ({ default: m.KnowledgePanel })));
const ReportPanel = lazy(() => import("./components/reports/ReportPanel").then(m => ({ default: m.ReportPanel })));
const TaskPanel = lazy(() => import("./components/tasks/TaskPanel").then(m => ({ default: m.TaskPanel })));

// ---------------------------------------------------------------------------
// Error boundary — catches render errors in lazy-loaded views so the whole
// app doesn't white-screen. Shows a retry button instead.
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ViewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    console.error("[ViewErrorBoundary] Render error:", error);
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary, #64748b)" }}>
          <h3 style={{ marginBottom: "12px", color: "var(--error, #ef4444)" }}>
            页面加载失败
          </h3>
          <p style={{ fontSize: "14px", marginBottom: "8px", maxWidth: "500px", margin: "0 auto 16px" }}>
            {this.state.error?.message || "未知错误"}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              padding: "8px 24px",
              border: "1px solid var(--border-primary, #e2e8f0)",
              borderRadius: "8px",
              background: "var(--bg-primary, #fff)",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// View router — only main view tabs (chat/knowledge/reports/tasks)
// Settings, plugins, skills, cron are now in the RightPanel
// ---------------------------------------------------------------------------

function ViewRouter() {
  const activeView = useUIStore((s) => s.activeView);
  const currentKbId = useUIStore((s) => s.currentKbId);
  const setCurrentKbId = useUIStore((s) => s.setCurrentKbId);

  return (
    <ViewErrorBoundary>
      <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="md" /></div>}>
        {(() => {
          switch (activeView) {
            case "chat":
              return <ChatWindow key="chat" />;
            case "knowledge":
              return <KnowledgePanel key="knowledge" kbId={currentKbId} onKbIdChange={setCurrentKbId} />;
            case "reports":
              return <ReportPanel key="reports" kbId={currentKbId} onKbIdChange={setCurrentKbId} />;
            case "tasks":
              return <TaskPanel key="tasks" />;
            default:
              return <ChatWindow key="default" />;
          }
        })()}
      </Suspense>
    </ViewErrorBoundary>
  );
}

export default function App() {
  const loadSessions = useChatStore((s) => s.loadSessions);
  const setCurrentKbId = useUIStore((s) => s.setCurrentKbId);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Pre-load knowledge bases and set a default kbId
  useEffect(() => {
    api.listKnowledgeBases()
      .then((kbs) => {
        const currentKbId = useUIStore.getState().currentKbId;
        if (Array.isArray(kbs) && kbs.length > 0 && !currentKbId) {
          setCurrentKbId(kbs[0].id);
        }
      })
      .catch(() => {
        // Non-critical — KnowledgePanel will handle its own loading
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppLayout>
      <ViewRouter />
    </AppLayout>
  );
}
