import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { useChatStore } from "./store/chat";

export default function App() {
  const loadSessions = useChatStore((s) => s.loadSessions);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  return (
    <div className="h-screen flex bg-gray-50">
      <Sidebar />
      <ChatWindow />
    </div>
  );
}
