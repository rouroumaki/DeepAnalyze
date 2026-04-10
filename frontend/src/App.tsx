import { useEffect, useState, lazy, Suspense } from "react";
import { useChatStore } from "./store/chat";
import { useUIStore } from "./store/ui";
import { AppLayout } from "./components/layout/AppLayout";
import { Spinner } from "./components/ui/Spinner";

const ChatWindow = lazy(() => import("./components/ChatWindow").then(m => ({ default: m.ChatWindow })));
const KnowledgePanel = lazy(() => import("./components/knowledge/KnowledgePanel").then(m => ({ default: m.KnowledgePanel })));
const ReportPanel = lazy(() => import("./components/reports/ReportPanel").then(m => ({ default: m.ReportPanel })));
const TaskPanel = lazy(() => import("./components/tasks/TaskPanel").then(m => ({ default: m.TaskPanel })));
const SettingsPanel = lazy(() => import("./components/settings/SettingsPanel").then(m => ({ default: m.SettingsPanel })));
const PluginManager = lazy(() => import("./components/plugins/PluginManager").then(m => ({ default: m.PluginManager })));

function ViewRouter({ currentKbId, onKbIdChange }: {
  currentKbId: string;
  onKbIdChange: (id: string) => void;
}) {
  const activeView = useUIStore((s) => s.activeView);

  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="md" /></div>}>
      {(() => {
        switch (activeView) {
          case "chat":
            return <ChatWindow />;
          case "knowledge":
            return <KnowledgePanel kbId={currentKbId} onKbIdChange={onKbIdChange} />;
          case "reports":
            return <ReportPanel kbId={currentKbId} onKbIdChange={onKbIdChange} />;
          case "tasks":
            return <TaskPanel />;
          case "settings":
            return <SettingsPanel />;
          case "plugins":
            return <PluginManager />;
          default:
            return <ChatWindow />;
        }
      })()}
    </Suspense>
  );
}

export default function App() {
  const loadSessions = useChatStore((s) => s.loadSessions);
  const [currentKbId, setCurrentKbId] = useState("");

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  return (
    <AppLayout>
      <ViewRouter currentKbId={currentKbId} onKbIdChange={setCurrentKbId} />
    </AppLayout>
  );
}
