import { useChatStore } from "../store/chat";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";

export function ChatWindow() {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const createSession = useChatStore((s) => s.createSession);

  const currentSession = sessions.find((s) => s.id === currentSessionId);

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
      {/* Chat Header */}
      <div className="px-6 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <h3 className="text-sm font-medium text-gray-700 truncate">
          {currentSession.title || "新对话"}
        </h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <MessageList />
      </div>

      {/* Input */}
      <MessageInput />
    </div>
  );
}
