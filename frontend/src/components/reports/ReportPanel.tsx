// =============================================================================
// DeepAnalyze - ReportPanel Component
// Reports, Timeline, and Knowledge Graph visualization
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { useMarkdown } from "../../hooks/useMarkdown";
import type { ReportInfo, ReportDetail, TimelineEvent, GraphNode, GraphEdge } from "../../types/index";
import { ReportExport } from "./ReportExport";
import {
  Loader2,
  ChevronLeft,
  FileText,
  Clock,
  Network,
  Plus,
  X,
  FileDown,
} from "lucide-react";

interface ReportPanelProps {
  kbId: string;
  onKbIdChange: (id: string) => void;
}

type SubTab = "reports" | "timeline" | "graph";

export function ReportPanel({ kbId, onKbIdChange }: ReportPanelProps) {
  const { error: showError } = useToast();
  const { success } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("reports");
  const [reports, setReports] = useState<ReportInfo[]>([]);
  const [selectedReport, setSelectedReport] = useState<ReportDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genTitle, setGenTitle] = useState("");
  const [genQuery, setGenQuery] = useState("");
  const [generating, setGenerating] = useState(false);
  const [exportingReportId, setExportingReportId] = useState<string | null>(null);
  const [exportingReportTitle, setExportingReportTitle] = useState("");

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
  const containerRef = useRef<HTMLDivElement>(null);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const animFrameRef = useRef<number>(0);

  const initGraphPositions = useCallback((centerX: number, centerY: number) => {
    const positions = nodePositionsRef.current;
    graphNodes.forEach((node, i) => {
      if (!positions.has(node.id)) {
        const angle = (2 * Math.PI * i) / graphNodes.length;
        const r = 150 + Math.random() * 100;
        positions.set(node.id, {
          x: centerX + Math.cos(angle) * r,
          y: centerY + Math.sin(angle) * r,
          vx: 0,
          vy: 0,
        });
      }
    });
  }, [graphNodes]);

  useEffect(() => {
    if (activeSubTab !== "graph" || !canvasRef.current || !containerRef.current || graphNodes.length === 0) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width;
    canvas.height = height;

    const centerX = width / 2;
    const centerY = height / 2;

    initGraphPositions(centerX, centerY);

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
        p.vx += (centerX - p.x) * 0.01;
        p.vy += (centerY - p.y) * 0.01;
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

  const handleGenerateReport = async () => {
    if (!kbId || !genTitle.trim()) return;
    setGenerating(true);
    try {
      await api.generateReport(kbId, genQuery, genTitle);
      success("报告生成任务已提交");
      setShowGenModal(false);
      setGenTitle("");
      setGenQuery("");
      // Reload reports
      const reportsData = await api.listReports(kbId);
      setReports(reportsData.reports ?? []);
    } catch {
      showError("生成报告失败");
    } finally {
      setGenerating(false);
    }
  };

  if (!kbId) {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-tertiary)",
      }}>
        <p>请先在知识库标签页中选择一个知识库</p>
      </div>
    );
  }

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-primary)",
    }}>
      {/* Sub-tab navigation */}
      <div style={{
        flexShrink: 0,
        borderBottom: "1px solid var(--border-primary)",
        padding: "var(--space-2) var(--space-4)",
        background: "var(--bg-secondary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
          {[
            { id: "reports" as const, label: "报告", Icon: FileText },
            { id: "timeline" as const, label: "时间线", Icon: Clock },
            { id: "graph" as const, label: "关系图", Icon: Network },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding: "6px 12px",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--font-medium)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                transition: "all var(--transition-fast)",
                border: "none",
                background: activeSubTab === tab.id ? "var(--interactive)" : "transparent",
                color: activeSubTab === tab.id ? "#fff" : "var(--text-tertiary)",
              }}
              onMouseEnter={(e) => {
                if (activeSubTab !== tab.id) e.currentTarget.style.color = "var(--text-secondary)";
              }}
              onMouseLeave={(e) => {
                if (activeSubTab !== tab.id) e.currentTarget.style.color = "var(--text-tertiary)";
              }}
            >
              <tab.Icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Generate report button */}
        {activeSubTab === "reports" && (
          <button
            onClick={() => setShowGenModal(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-1)",
              padding: "6px 12px",
              fontSize: "var(--text-xs)",
              fontWeight: "var(--font-medium)",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              border: "none",
              background: "var(--interactive)",
              color: "#fff",
              transition: "background var(--transition-fast)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--interactive-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--interactive)"; }}
          >
            <Plus size={14} />
            生成报告
          </button>
        )}
      </div>

      {/* Generate Report Modal */}
      {showGenModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowGenModal(false)}
        >
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-xl)",
              padding: "var(--space-6)",
              width: 440,
              maxWidth: "90vw",
              boxShadow: "var(--shadow-md)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
              <h3 style={{
                fontSize: "var(--text-base)",
                fontWeight: "var(--font-semibold)",
                color: "var(--text-primary)",
                margin: 0,
              }}>
                生成新报告
              </h3>
              <button
                onClick={() => setShowGenModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-tertiary)",
                  padding: 0,
                  display: "flex",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div>
                <label style={{
                  display: "block",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-medium)",
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-1)",
                }}>
                  报告标题 *
                </label>
                <input
                  type="text"
                  value={genTitle}
                  onChange={(e) => setGenTitle(e.target.value)}
                  placeholder="输入报告标题"
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "var(--radius-lg)",
                    fontSize: "var(--text-sm)",
                    background: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
                />
              </div>
              <div>
                <label style={{
                  display: "block",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-medium)",
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-1)",
                }}>
                  分析要求 (可选)
                </label>
                <textarea
                  value={genQuery}
                  onChange={(e) => setGenQuery(e.target.value)}
                  placeholder="描述你希望报告包含的内容或分析方向..."
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "var(--radius-lg)",
                    fontSize: "var(--text-sm)",
                    background: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    outline: "none",
                    resize: "vertical",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)" }}>
                <button
                  onClick={() => setShowGenModal(false)}
                  style={{
                    padding: "var(--space-2) var(--space-4)",
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--font-medium)",
                    borderRadius: "var(--radius-lg)",
                    cursor: "pointer",
                    border: "1px solid var(--border-primary)",
                    background: "transparent",
                    color: "var(--text-secondary)",
                    transition: "background var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  取消
                </button>
                <button
                  onClick={handleGenerateReport}
                  disabled={generating || !genTitle.trim()}
                  style={{
                    padding: "var(--space-2) var(--space-4)",
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--font-medium)",
                    borderRadius: "var(--radius-lg)",
                    cursor: generating || !genTitle.trim() ? "not-allowed" : "pointer",
                    border: "none",
                    background: "var(--interactive)",
                    color: "#fff",
                    opacity: generating || !genTitle.trim() ? 0.5 : 1,
                    transition: "background var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => { if (!generating && genTitle.trim()) e.currentTarget.style.background = "var(--interactive-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--interactive)"; }}
                >
                  {generating ? "生成中..." : "开始生成"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {loading ? (
          <div style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
            gap: "var(--space-2)",
          }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
            加载中...
          </div>
        ) : selectedReport ? (
          <ReportDetailPanel report={selectedReport} onBack={() => setSelectedReport(null)} onExport={(id, title) => { setExportingReportId(id); setExportingReportTitle(title); }} />
        ) : activeSubTab === "reports" ? (
          <div style={{
            height: "100%",
            overflowY: "auto",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}>
            {reports.length === 0 ? (
              <div style={{
                textAlign: "center",
                padding: "48px 0",
                color: "var(--text-tertiary)",
              }}>
                <p>暂无报告</p>
                <p style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }}>
                  在对话中请求 Agent 生成分析报告，或点击上方"生成报告"按钮
                </p>
              </div>
            ) : (
              reports.map((report) => (
                <div
                  key={report.id}
                  onClick={() => api.getReport(report.id).then(setSelectedReport).catch(() => showError("加载报告失败"))}
                  style={{
                    padding: "var(--space-3) var(--space-4)",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "var(--radius-lg)",
                    cursor: "pointer",
                    transition: "border-color var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
                >
                  <p style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--text-primary)",
                    fontWeight: "var(--font-medium)",
                    margin: 0,
                  }}>
                    {report.title}
                  </p>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    marginTop: "var(--space-1)",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-tertiary)",
                  }}>
                    <span>{new Date(report.createdAt).toLocaleDateString("zh-CN")}</span>
                    <span>{report.tokenCount} tokens</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : activeSubTab === "timeline" ? (
          <div style={{ height: "100%", overflowY: "auto", padding: "var(--space-4)" }}>
            {timeline.length === 0 ? (
              <div style={{
                textAlign: "center",
                padding: "48px 0",
                color: "var(--text-tertiary)",
              }}>
                暂无时间线数据
              </div>
            ) : (
              <div style={{ position: "relative", paddingLeft: "var(--space-6)" }}>
                <div style={{
                  position: "absolute",
                  left: 8,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "var(--border-primary)",
                }} />
                {timeline.map((event, i) => (
                  <div key={i} style={{ position: "relative", paddingBottom: "var(--space-6)" }}>
                    <div style={{
                      position: "absolute",
                      left: -18,
                      width: 12,
                      height: 12,
                      borderRadius: "var(--radius-full)",
                      background: "var(--interactive)",
                      border: "2px solid var(--bg-primary)",
                    }} />
                    <div style={{
                      padding: "var(--space-3) var(--space-4)",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: "var(--radius-lg)",
                    }}>
                      <div style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--interactive)",
                        fontWeight: "var(--font-medium)",
                        marginBottom: "var(--space-1)",
                      }}>
                        {event.date}
                      </div>
                      <p style={{
                        fontSize: "var(--text-sm)",
                        color: "var(--text-primary)",
                        fontWeight: "var(--font-medium)",
                        margin: 0,
                      }}>
                        {event.title}
                      </p>
                      <p style={{
                        fontSize: "var(--text-sm)",
                        color: "var(--text-secondary)",
                        marginTop: "var(--space-1)",
                        margin: 0,
                      }}>
                        {event.description}
                      </p>
                      <p style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-tertiary)",
                        marginTop: "var(--space-2)",
                        margin: 0,
                      }}>
                        来源: {event.sourceTitle}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Graph */
          <div ref={containerRef} style={{ height: "100%", position: "relative" }}>
            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
            <div style={{
              position: "absolute",
              top: "var(--space-3)",
              right: "var(--space-3)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              background: "color-mix(in srgb, var(--bg-primary) 80%, transparent)",
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-lg)",
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: "#3b82f6" }} />
                文档
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: "#34d399" }} />
                实体
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: "#a78bfa" }} />
                概念
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: "#f59e0b" }} />
                报告
              </span>
              <span>| {graphNodes.length} 节点 {graphEdges.length} 边</span>
            </div>
          </div>
        )}
      </div>

      {exportingReportId && (
        <ReportExport
          reportId={exportingReportId}
          reportTitle={exportingReportTitle}
          onClose={() => setExportingReportId(null)}
        />
      )}
    </div>
  );
}

// Report Detail View
function ReportDetailPanel({ report, onBack, onExport }: { report: ReportDetail; onBack: () => void; onExport: (id: string, title: string) => void }) {
  const htmlContent = useMarkdown(report.content);

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <div style={{
        position: "sticky",
        top: 0,
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-primary)",
        padding: "var(--space-3) var(--space-6)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        zIndex: 10,
      }}>
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-tertiary)",
            padding: 0,
            display: "flex",
            transition: "color var(--transition-fast)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={() => onExport(report.id, report.title)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            padding: "4px 10px",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--font-medium)",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            border: "1px solid var(--border-primary)",
            background: "transparent",
            color: "var(--text-secondary)",
            transition: "all var(--transition-fast)",
            marginLeft: "auto",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--interactive)"; e.currentTarget.style.color = "var(--interactive)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
        >
          <FileDown size={14} />
          导出
        </button>
        <div>
          <h3 style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--font-medium)",
            color: "var(--text-primary)",
            margin: 0,
          }}>
            {report.title}
          </h3>
          <p style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            margin: 0,
          }}>
            {new Date(report.createdAt).toLocaleString("zh-CN")} | {report.tokenCount} tokens
          </p>
        </div>
      </div>
      <div style={{ padding: "var(--space-4) var(--space-6)", maxWidth: 900, margin: "0 auto" }}>
        <div className="markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </div>
    </div>
  );
}
