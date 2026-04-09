// =============================================================================
// DeepAnalyze - ToolCallCard Component
// Displays tool invocation details in a collapsible card
// =============================================================================

import { useState } from "react";
import type { ToolCallInfo } from "../../types/index";

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

const TOOL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  kb_search: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  wiki_browse: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
  expand: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
  read: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20" },
  grep: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  bash: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  report_generate: { bg: "bg-teal-500/10", text: "text-teal-400", border: "border-teal-500/20" },
  timeline_build: { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/20" },
  graph_build: { bg: "bg-pink-500/10", text: "text-pink-400", border: "border-pink-500/20" },
};

function getToolColors(toolName: string) {
  return TOOL_COLORS[toolName] ?? { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/20" };
}

function getStatusIcon(status: string) {
  switch (status) {
    case "running":
      return (
        <svg className="w-3.5 h-3.5 animate-spin text-da-amber" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      );
    case "completed":
      return <svg className="w-3.5 h-3.5 text-da-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
    case "error":
      return <svg className="w-3.5 h-3.5 text-da-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
    default:
      return null;
  }
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const colors = getToolColors(toolCall.toolName);

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-white/5 transition-colors"
      >
        {getStatusIcon(toolCall.status)}
        <span className={`text-xs font-medium ${colors.text}`}>{toolCall.toolName}</span>
        <span className="text-[10px] text-da-text-muted flex-1 truncate">
          {JSON.stringify(toolCall.input).slice(0, 60)}
        </span>
        <svg
          className={`w-3 h-3 text-da-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-da-border/50 px-3 py-2 space-y-2">
          <div>
            <div className="text-[10px] text-da-text-muted mb-1">输入参数</div>
            <pre className="text-xs text-da-text-secondary bg-da-bg rounded p-2 overflow-x-auto max-h-32">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          {toolCall.output && (
            <div>
              <div className="text-[10px] text-da-text-muted mb-1">输出结果</div>
              <pre className="text-xs text-da-text-secondary bg-da-bg rounded p-2 overflow-x-auto max-h-32">
                {toolCall.output.length > 500 ? toolCall.output.slice(0, 500) + "..." : toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
