// =============================================================================
// DeepAnalyze - ChatWindow Component
// Main content area with tab navigation
// =============================================================================

import { useState } from "react";
import { useChatStore } from "../store/chat";
import { MessageList } from "./chat/MessageList";
import { MessageInput } from "./chat/MessageInput";
import { SubtaskPanel } from "./chat/SubtaskPanel";
import { ReportPanel } from "./reports/ReportPanel";
import { SettingsPanel } from "./settings/SettingsPanel";
import { KnowledgePanel } from "./knowledge/KnowledgePanel";
import { PluginManager } from "./plugins/PluginManager";
import { SkillBrowser } from "./plugins/SkillBrowser";
import { TaskPanel } from "./tasks/TaskPanel";
import type { TabId } from "../types/index";

interface ChatWindowProps {
  sendWsMessage: (content: string) => void;
}

export function ChatWindow({ sendWsMessage }: ChatWindowProps) {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const createSession = useChatStore((s) => s.createSession);
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [selectedKbId, setSelectedKbId] = useState("");

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  const tabs: Array<{ id: TabId; label: string; icon: string }> = [
    { id: "chat", label: "对话", icon: "chat" },
    { id: "knowledge", label: "知识库", icon: "knowledge" },
    { id: "reports", label: "报告", icon: "reports" },
    { id: "tasks", label: "任务", icon: "tasks" },
    { id: "settings", label: "设置", icon: "settings" },
  ];

  if (!currentSessionId || !currentSession) {
    return (
      <div className="flex-1 flex items-center justify-center bg-da-bg">
        <div className="text-center max-w-md animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-da-text mb-2">DeepAnalyze</h2>
          <p className="text-da-text-secondary mb-8">深度分析系统 - Agent驱动的文档分析与报告生成平台</p>
          <button
            onClick={() => createSession()}
            className="px-6 py-3 bg-da-accent hover:bg-da-accent-hover text-white rounded-xl font-medium transition-colors cursor-pointer"
          >
            开始新对话
          </button>
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {["分析一份文档", "总结研究报告", "提取关键信息"].map((hint) => (
              <span key={hint} className="px-3 py-1.5 bg-da-surface border border-da-border rounded-full text-sm text-da-text-secondary">
                {hint}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-da-bg">
      {/* Tab Navigation */}
      <div className="shrink-0 border-b border-da-border bg-da-bg-secondary">
        <div className="flex items-center justify-between px-4 py-1.5">
          <div className="text-sm font-medium text-da-text-secondary truncate max-w-[200px]">
            {activeTab === "chat"
              ? currentSession.title || "新对话"
              : tabs.find((t) => t.id === activeTab)?.label ?? ""}
          </div>
          <div className="flex items-center gap-0.5 bg-da-bg-tertiary rounded-lg p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? "bg-da-accent text-white shadow-sm"
                    : "text-da-text-muted hover:text-da-text-secondary hover:bg-da-bg-hover"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "chat" && (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-hidden">
              <MessageList />
            </div>
            <SubtaskPanel />
            <MessageInput sendWsMessage={sendWsMessage} />
          </div>
        )}
        {activeTab === "knowledge" && (
          <KnowledgePanel kbId={selectedKbId} onKbIdChange={setSelectedKbId} />
        )}
        {activeTab === "reports" && (
          <ReportPanel kbId={selectedKbId} onKbIdChange={setSelectedKbId} />
        )}
        {activeTab === "tasks" && <TaskPanel />}
        {activeTab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}
