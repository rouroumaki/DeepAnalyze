import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { useChatStore } from "./store/chat";
import { useUIStore } from "./store/ui";
import { AppLayout } from "./components/layout/AppLayout";
import { api } from "./api/client";
import { router } from "./router";

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

  // Sync URL hash changes back to Zustand store so Sidebar highlights stay correct
  useEffect(() => {
    function syncRouteToStore() {
      const hash = window.location.hash.replace("#", "");
      const path = hash.split("/")[1] || "chat"; // first segment after /
      const viewMap: Record<string, "chat" | "knowledge" | "reports" | "tasks"> = {
        chat: "chat",
        sessions: "chat",
        knowledge: "knowledge",
        reports: "reports",
        tasks: "tasks",
      };
      const view = viewMap[path];
      if (view && view !== useUIStore.getState().activeView) {
        useUIStore.getState().setActiveView(view);
      }
    }

    // Sync initial route
    syncRouteToStore();

    // Listen for hash changes
    window.addEventListener("hashchange", syncRouteToStore);
    return () => window.removeEventListener("hashchange", syncRouteToStore);
  }, []);

  return (
    <AppLayout>
      <RouterProvider router={router} />
    </AppLayout>
  );
}
