import { useChatStore } from "../store/chat";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { SubtaskPanel } from "./SubtaskPanel";
import { ReportPanel } from "./ReportPanel";

export function ChatWindow() {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const createSession = useChatStore((s) => s.createSession);
  const activeTab = useChatStore((s) => s.activeTab);
  const setActiveTab = useChatStore((s) => s.setActiveTab);
  const selectedKbId = useChatStore((s) => s.selectedKbId);
  const setSelectedKbId = useChatStore((s) => s.setSelectedKbId);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const kbId = selectedKbId ?? "";

  if (!currentSessionId || !currentSession) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            DeepAnalyze
          </h2>
          <p className="text-gray-500 mb-8">
            深度分析系统 - 开始一段新的对话吧
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => createSession()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors duration-150 cursor-pointer"
            >
              开始新对话
            </button>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {["分析一份文档", "总结研究报告", "提取关键信息"].map(
                (hint) => (
                  <span
                    key={hint}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm text-gray-500"
                  >
                    {hint}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50">
      {/* Header with tab navigation */}
      <div className="shrink-0 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-2">
          <h3 className="text-sm font-medium text-gray-700 truncate">
            {activeTab === "chat"
              ? currentSession.title || "新对话"
              : "报告中心"}
          </h3>

          {/* Tab switcher */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
                activeTab === "chat"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              对话
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("reports")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
                activeTab === "reports"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              报告
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      {activeTab === "chat" ? (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-hidden">
            <MessageList />
          </div>

          {/* Agent task progress panel */}
          <SubtaskPanel />

          {/* Input */}
          <MessageInput />
        </>
      ) : (
        <ReportPanel
          kbId={kbId}
          onKbIdChange={setSelectedKbId}
        />
      )}
    </div>
  );
}
