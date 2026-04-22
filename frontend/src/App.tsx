import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { useChatStore } from "./store/chat";
import { useUIStore } from "./store/ui";
import { AppLayout } from "./components/layout/AppLayout";
import { api } from "./api/client";
import { router } from "./router";

const ROUTE_STORAGE_KEY = "deepanalyze-route";

export default function App() {
  const loadSessions = useChatStore((s) => s.loadSessions);
  const setCurrentKbId = useUIStore((s) => s.setCurrentKbId);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Pre-load knowledge bases and set a default kbId, then restore route
  useEffect(() => {
    api.listKnowledgeBases()
      .then((kbs) => {
        const currentKbId = useUIStore.getState().currentKbId;
        if (Array.isArray(kbs) && kbs.length > 0) {
          // Validate cached kbId still exists; if not, auto-select the first KB
          const cachedExists = kbs.some((kb: { id: string }) => kb.id === currentKbId);
          if (!currentKbId || !cachedExists) {
            setCurrentKbId(kbs[0].id);
          }
        }

        // Restore persisted route if current URL has no meaningful hash
        const currentHash = window.location.hash;
        if (!currentHash || currentHash === "#" || currentHash === "#/" || currentHash === "#") {
          try {
            const savedRoute = localStorage.getItem(ROUTE_STORAGE_KEY);
            if (savedRoute) {
              // If the saved route is /knowledge without kbId, append the default kbId
              if (savedRoute === "/knowledge" && kbs.length > 0) {
                const defaultKbId = currentKbId || kbs[0].id;
                window.location.hash = `#/knowledge/${defaultKbId}`;
              } else {
                window.location.hash = `#${savedRoute}`;
              }
            }
          } catch {
            // localStorage unavailable
          }
        }
      })
      .catch(() => {
        // Non-critical — KnowledgePanel will handle its own loading
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL hash changes back to Zustand store so Sidebar highlights stay correct
  // Also persist the current route to localStorage for refresh recovery
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

      // Persist the route (store the path without hash)
      try {
        localStorage.setItem(ROUTE_STORAGE_KEY, hash || "/chat");
      } catch {
        // localStorage unavailable
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
