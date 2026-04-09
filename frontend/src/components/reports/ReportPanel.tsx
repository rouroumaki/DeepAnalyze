// =============================================================================
// DeepAnalyze - ReportPanel Component
// Reports, Timeline, and Knowledge Graph visualization
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { useMarkdown } from "../../hooks/useMarkdown";
import type { ReportInfo, ReportDetail, TimelineEvent, GraphNode, GraphEdge } from "../../types/index";

interface ReportPanelProps {
  kbId: string;
  onKbIdChange: (id: string) => void;
}

type SubTab = "reports" | "timeline" | "graph";

export function ReportPanel({ kbId, onKbIdChange }: ReportPanelProps) {
  const { error } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("reports");
  const [reports, setReports] = useState<ReportInfo[]>([]);
  const [selectedReport, setSelectedReport] = useState<ReportDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);

  // Load data when kb changes
  useEffect(() => {
    if (!kbId) return;
    setLoading(true);
    Promise.all([
      api.listReports(kbId).catch(() => ({ reports: [] })),
      api.getTimeline(kbId).catch(() => ({ events: [] })),
      api.getGraph(kbId).catch(() => ({ nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } })),
    ]).then(([reportsData, timelineData, graphData]) => {
      setReports(reportsData.reports ?? []);
      setTimeline(timelineData.events ?? []);
      setGraphNodes(graphData.nodes ?? []);
      setGraphEdges(graphData.edges ?? []);
      setLoading(false);
    });
  }, [kbId]);

  // Graph canvas rendering
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const animFrameRef = useRef<number>(0);

  const initGraphPositions = useCallback(() => {
    const positions = nodePositionsRef.current;
    graphNodes.forEach((node, i) => {
      if (!positions.has(node.id)) {
        const angle = (2 * Math.PI * i) / graphNodes.length;
        const r = 150 + Math.random() * 100;
        positions.set(node.id, {
          x: 400 + Math.cos(angle) * r,
          y: 300 + Math.sin(angle) * r,
          vx: 0,
          vy: 0,
        });
      }
    });
  }, [graphNodes]);

  useEffect(() => {
    if (activeSubTab !== "graph" || !canvasRef.current || graphNodes.length === 0) return;

    initGraphPositions();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodeTypeColors: Record<string, string> = {
      document: "#3b82f6",
      entity: "#34d399",
      concept: "#a78bfa",
      report: "#f59e0b",
    };

    const simulate = () => {
      const positions = nodePositionsRef.current;
      const damping = 0.85;
      const repulsion = 1500;
      const attraction = 0.005;

      // Repulsion between nodes
      const nodes = graphNodes;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = positions.get(nodes[i].id);
          const b = positions.get(nodes[j].id);
          if (!a || !b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = repulsion / (dist * dist);
          a.vx += (dx / dist) * force;
          a.vy += (dy / dist) * force;
          b.vx -= (dx / dist) * force;
          b.vy -= (dy / dist) * force;
        }
      }

      // Attraction along edges
      graphEdges.forEach((edge) => {
        const a = positions.get(edge.source);
        const b = positions.get(edge.target);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        a.vx += dx * attraction;
        a.vy += dy * attraction;
        b.vx -= dx * attraction;
        b.vy -= dy * attraction;
      });

      // Center gravity
      positions.forEach((p) => {
        p.vx += (400 - p.x) * 0.01;
        p.vy += (300 - p.y) * 0.01;
        p.vx *= damping;
        p.vy *= damping;
        p.x += p.vx;
        p.y += p.vy;
      });

      // Draw
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#0a0e1a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Edges
      ctx.strokeStyle = "rgba(100, 116, 139, 0.3)";
      ctx.lineWidth = 1;
      graphEdges.forEach((edge) => {
        const a = positions.get(edge.source);
        const b = positions.get(edge.target);
        if (!a || !b) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // Edge label
        if (edge.label) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          ctx.fillStyle = "#64748b";
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(edge.label, mx, my - 4);
        }
      });

      // Nodes
      nodes.forEach((node) => {
        const p = positions.get(node.id);
        if (!p) return;
        const color = nodeTypeColors[node.type] ?? "#64748b";

        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.fillStyle = "#e2e8f0";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(node.label, p.x, p.y + 20);
      });

      animFrameRef.current = requestAnimationFrame(simulate);
    };

    simulate();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [activeSubTab, graphNodes, graphEdges, initGraphPositions]);

  if (!kbId) {
    return (
      <div className="h-full flex items-center justify-center text-da-text-muted">
        <p>请先在知识库标签页中选择一个知识库</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-da-bg">
      {/* Sub-tab navigation */}
      <div className="shrink-0 border-b border-da-border px-4 py-2 bg-da-bg-secondary">
        <div className="flex items-center gap-1">
          {[
            { id: "reports" as const, label: "报告" },
            { id: "timeline" as const, label: "时间线" },
            { id: "graph" as const, label: "关系图" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                activeSubTab === tab.id
                  ? "bg-da-accent text-white"
                  : "text-da-text-muted hover:text-da-text-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center text-da-text-muted">
            <svg className="w-6 h-6 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        ) : selectedReport ? (
          <ReportDetailPanel report={selectedReport} onBack={() => setSelectedReport(null)} />
        ) : activeSubTab === "reports" ? (
          <div className="h-full overflow-y-auto p-4 space-y-2">
            {reports.length === 0 ? (
              <div className="text-center py-12 text-da-text-muted">
                <p>暂无报告</p>
                <p className="text-xs mt-1">在对话中请求 Agent 生成分析报告</p>
              </div>
            ) : (
              reports.map((report) => (
                <div
                  key={report.id}
                  onClick={() => api.getReport(report.id).then(setSelectedReport).catch(() => error("加载报告失败"))}
                  className="px-4 py-3 bg-da-surface border border-da-border rounded-lg cursor-pointer hover:border-da-accent/30 transition-colors"
                >
                  <p className="text-sm text-da-text font-medium">{report.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-da-text-muted">
                    <span>{new Date(report.createdAt).toLocaleDateString("zh-CN")}</span>
                    <span>{report.tokenCount} tokens</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : activeSubTab === "timeline" ? (
          <div className="h-full overflow-y-auto p-4">
            {timeline.length === 0 ? (
              <div className="text-center py-12 text-da-text-muted">暂无时间线数据</div>
            ) : (
              <div className="relative pl-6">
                <div className="absolute left-2 top-0 bottom-0 w-px bg-da-border" />
                {timeline.map((event, i) => (
                  <div key={i} className="relative pb-6 animate-fade-in">
                    <div className="absolute left-[-18px] w-3 h-3 rounded-full bg-da-accent border-2 border-da-bg" />
                    <div className="px-4 py-3 bg-da-surface border border-da-border rounded-lg">
                      <div className="text-xs text-da-accent font-medium mb-1">{event.date}</div>
                      <p className="text-sm text-da-text font-medium">{event.title}</p>
                      <p className="text-sm text-da-text-secondary mt-1">{event.description}</p>
                      <p className="text-xs text-da-text-muted mt-2">来源: {event.sourceTitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Graph */
          <div className="h-full relative">
            <canvas ref={canvasRef} width={800} height={600} className="w-full h-full" />
            <div className="absolute top-3 right-3 flex items-center gap-3 text-xs text-da-text-muted bg-da-bg/80 px-3 py-2 rounded-lg">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />文档</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />实体</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" />概念</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />报告</span>
              <span>| {graphNodes.length} 节点 {graphEdges.length} 边</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Report Detail View
function ReportDetailPanel({ report, onBack }: { report: ReportDetail; onBack: () => void }) {
  const htmlContent = useMarkdown(report.content);

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 bg-da-bg-secondary border-b border-da-border px-6 py-3 flex items-center gap-3 z-10">
        <button onClick={onBack} className="text-da-text-muted hover:text-da-text cursor-pointer">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h3 className="text-sm font-medium text-da-text">{report.title}</h3>
          <p className="text-[10px] text-da-text-muted">{new Date(report.createdAt).toLocaleString("zh-CN")} | {report.tokenCount} tokens</p>
        </div>
      </div>
      <div className="px-6 py-4 max-w-4xl mx-auto">
        <div className="markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </div>
    </div>
  );
}
