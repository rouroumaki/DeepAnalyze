import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  api,
  type ReportInfo,
  type ReportDetail,
  type TimelineEvent,
  type GraphNode,
  type GraphEdge,
} from "../api/client";
import { ReportViewer } from "./ReportViewer";

// ---------------------------------------------------------------------------
// KB Selector
// ---------------------------------------------------------------------------

function KbSelector({
  kbId,
  onChange,
}: {
  kbId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="kb-id-input"
        className="text-xs text-gray-500 whitespace-nowrap"
      >
        知识库 ID:
      </label>
      <input
        id="kb-id-input"
        type="text"
        value={kbId}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入知识库 ID..."
        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports Tab
// ---------------------------------------------------------------------------

function ReportsTab({ kbId }: { kbId: string }) {
  const [reports, setReports] = useState<ReportInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportDetail | null>(
    null,
  );

  useEffect(() => {
    if (!kbId.trim()) return;
    setIsLoading(true);
    setError(null);
    api
      .listReports(kbId)
      .then((data) => setReports(data.reports ?? []))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载报告失败"),
      )
      .finally(() => setIsLoading(false));
  }, [kbId]);

  const handleOpenReport = async (reportId: string) => {
    try {
      setError(null);
      const detail = await api.getReport(reportId);
      setSelectedReport(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载报告详情失败");
    }
  };

  if (selectedReport) {
    return (
      <ReportViewer
        report={selectedReport}
        onBack={() => setSelectedReport(null)}
      />
    );
  }

  if (!kbId.trim()) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        请先输入知识库 ID
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <svg
            className="animate-spin w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          加载中...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 text-sm mb-2">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs text-blue-500 hover:text-blue-600 cursor-pointer"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        暂无报告
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {reports.map((report) => (
        <button
          key={report.id}
          type="button"
          onClick={() => handleOpenReport(report.id)}
          className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all duration-150 cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-gray-800 truncate">
                {report.title}
              </h4>
              <p className="text-xs text-gray-400 mt-1">
                {new Date(report.createdAt).toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">
                {report.tokenCount} tokens
              </span>
              <svg
                className="w-4 h-4 text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Tab
// ---------------------------------------------------------------------------

function TimelineTab({ kbId }: { kbId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchTimeline = useCallback(() => {
    if (!kbId.trim()) return;
    setIsLoading(true);
    setError(null);
    api
      .getTimeline(kbId, query || undefined, 50)
      .then((data) => {
        const sorted = [...(data.events ?? [])].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
        setEvents(sorted);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载时间线失败"),
      )
      .finally(() => setIsLoading(false));
  }, [kbId, query]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  const formatDateBadge = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (!kbId.trim()) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        请先输入知识库 ID
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索事件..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <button
            type="button"
            onClick={fetchTimeline}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
          >
            搜索
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <svg
              className="animate-spin w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            加载中...
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      ) : events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          暂无时间线事件
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="relative max-w-3xl mx-auto">
            {/* Vertical line */}
            <div className="absolute left-5 md:left-1/2 top-0 bottom-0 w-0.5 bg-blue-200 md:-translate-x-0.5" />

            <div className="space-y-8">
              {events.map((event, idx) => {
                const isLeft = idx % 2 === 0;
                return (
                  <div key={idx} className="relative flex items-start">
                    {/* Mobile: always left-aligned */}
                    {/* Desktop: alternating */}
                    <div
                      className={`w-full md:w-1/2 ${
                        isLeft
                          ? "md:pr-12 md:text-right"
                          : "md:pl-12 md:ml-auto"
                      } pl-12 md:pl-0`}
                    >
                      {/* Dot on the timeline */}
                      <div
                        className={`absolute left-5 md:left-1/2 w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow-sm md:-translate-x-1.5 -translate-x-1.5 top-1`}
                      />

                      {/* Date badge */}
                      <div
                        className={`mb-1 ${isLeft ? "md:text-right" : "md:text-left"}`}
                      >
                        <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          {formatDateBadge(event.date)}
                        </span>
                      </div>

                      {/* Card */}
                      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                        <h4 className="text-sm font-semibold text-gray-800 mb-1">
                          {event.title}
                        </h4>
                        <p className="text-xs text-gray-600 leading-relaxed">
                          {event.description}
                        </p>
                        {event.sourceTitle && (
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <span className="text-xs text-gray-400">
                              来源: {event.sourceTitle}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph Tab - Canvas-based force-directed graph
// ---------------------------------------------------------------------------

interface NodePosition {
  id: string;
  label: string;
  type: string;
  group?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
}

const NODE_COLORS: Record<string, string> = {
  document: "#3b82f6", // blue
  entity: "#22c55e",   // green
  concept: "#a855f7",  // purple
  report: "#f97316",   // orange
  page: "#3b82f6",     // blue
  person: "#22c55e",   // green
  topic: "#a855f7",    // purple
};

function getNodeColor(type: string): string {
  return NODE_COLORS[type] ?? "#6b7280"; // gray default
}

function GraphTab({ kbId }: { kbId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodePosition[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const animFrameRef = useRef<number>(0);
  const nodesRef = useRef<NodePosition[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const dragRef = useRef<{
    nodeId: string | null;
    offsetX: number;
    offsetY: number;
  }>({ nodeId: null, offsetX: 0, offsetY: 0 });
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const fetchGraph = useCallback(() => {
    if (!kbId.trim()) return;
    setIsLoading(true);
    setError(null);
    api
      .getGraph(kbId, query || undefined, 100)
      .then((data) => {
        const canvas = canvasRef.current;
        const w = canvas?.width ?? 800;
        const h = canvas?.height ?? 600;

        const positioned: NodePosition[] = (data.nodes ?? []).map((n) => ({
          id: n.id,
          label: n.label,
          type: n.type,
          group: n.group,
          x: w / 2 + (Math.random() - 0.5) * w * 0.6,
          y: h / 2 + (Math.random() - 0.5) * h * 0.6,
          vx: 0,
          vy: 0,
          color: getNodeColor(n.type),
          radius: 8,
        }));

        nodesRef.current = positioned;
        edgesRef.current = data.edges ?? [];
        setNodes(positioned);
        setEdges(data.edges ?? []);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载关系图失败"),
      )
      .finally(() => setIsLoading(false));
  }, [kbId, query]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Update refs when state changes
  useEffect(() => {
    hoveredRef.current = hoveredNode;
  }, [hoveredNode]);

  useEffect(() => {
    selectedRef.current = selectedNode;
  }, [selectedNode]);

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Force simulation and rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const simulate = () => {
      if (!running) return;

      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      if (currentNodes.length === 0) {
        animFrameRef.current = requestAnimationFrame(simulate);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      // Force simulation step
      const alpha = 0.3;
      const repulsion = 1500;
      const attraction = 0.005;
      const centerForce = 0.01;
      const damping = 0.85;

      // Repulsion between all pairs
      for (let i = 0; i < currentNodes.length; i++) {
        for (let j = i + 1; j < currentNodes.length; j++) {
          const a = currentNodes[i];
          const b = currentNodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) dist = 1;
          const force = repulsion / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx * alpha;
          a.vy -= fy * alpha;
          b.vx += fx * alpha;
          b.vy += fy * alpha;
        }
      }

      // Attraction along edges
      for (const edge of currentEdges) {
        const a = currentNodes.find((n) => n.id === edge.source);
        const b = currentNodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = dist * attraction;
        const fx = (dx / Math.max(dist, 1)) * force;
        const fy = (dy / Math.max(dist, 1)) * force;
        a.vx += fx * alpha;
        a.vy += fy * alpha;
        b.vx -= fx * alpha;
        b.vy -= fy * alpha;
      }

      // Center gravity + damping
      for (const node of currentNodes) {
        node.vx += (w / 2 - node.x) * centerForce;
        node.vy += (h / 2 - node.y) * centerForce;
        node.vx *= damping;
        node.vy *= damping;

        // Skip dragged node
        if (dragRef.current.nodeId === node.id) continue;

        node.x += node.vx;
        node.y += node.vy;

        // Keep in bounds
        const margin = 20;
        node.x = Math.max(margin, Math.min(w - margin, node.x));
        node.y = Math.max(margin, Math.min(h - margin, node.y));
      }

      // ---- Render ----
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, w, h);

      // Grid dots (subtle)
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      for (let gx = 0; gx < w; gx += 40) {
        for (let gy = 0; gy < h; gy += 40) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const currentHovered = hoveredRef.current;
      const currentSelected = selectedRef.current;

      // Determine highlighted node set
      const highlightedIds = new Set<string>();
      if (currentSelected) {
        highlightedIds.add(currentSelected);
        for (const edge of currentEdges) {
          if (edge.source === currentSelected) highlightedIds.add(edge.target);
          if (edge.target === currentSelected) highlightedIds.add(edge.source);
        }
      }

      // Draw edges
      for (const edge of currentEdges) {
        const source = currentNodes.find((n) => n.id === edge.source);
        const target = currentNodes.find((n) => n.id === edge.target);
        if (!source || !target) continue;

        const isHighlighted =
          currentSelected === source.id ||
          currentSelected === target.id;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = isHighlighted
          ? "rgba(255,255,255,0.6)"
          : "rgba(255,255,255,0.15)";
        ctx.lineWidth = isHighlighted ? 2 : 1;
        ctx.stroke();

        // Edge label
        if (edge.label) {
          const mx = (source.x + target.x) / 2;
          const my = (source.y + target.y) / 2;
          ctx.font = "10px sans-serif";
          ctx.fillStyle = isHighlighted
            ? "rgba(255,255,255,0.7)"
            : "rgba(255,255,255,0.3)";
          ctx.textAlign = "center";
          ctx.fillText(edge.label, mx, my - 4);
        }
      }

      // Draw nodes
      for (const node of currentNodes) {
        const isHovered = currentHovered === node.id;
        const isSelected = currentSelected === node.id;
        const isConnected = highlightedIds.has(node.id);
        const dimmed =
          currentSelected !== null && !isConnected;

        const r = isHovered || isSelected ? node.radius * 1.5 : node.radius;

        // Glow effect for hovered/selected
        if (isHovered || isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = node.color + "33"; // 20% opacity
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = dimmed ? node.color + "40" : node.color;
        ctx.fill();
        ctx.strokeStyle = isHovered || isSelected
          ? "#ffffff"
          : dimmed
            ? "rgba(255,255,255,0.1)"
            : "rgba(255,255,255,0.3)";
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.stroke();

        // Label
        const showLabel =
          isHovered || isSelected || (!currentSelected && !dimmed);
        if (showLabel) {
          ctx.font = `${isHovered || isSelected ? "bold " : ""}11px sans-serif`;
          ctx.fillStyle = dimmed
            ? "rgba(255,255,255,0.3)"
            : "rgba(255,255,255,0.85)";
          ctx.textAlign = "center";
          ctx.fillText(
            node.label.length > 16
              ? node.label.slice(0, 14) + "..."
              : node.label,
            node.x,
            node.y + r + 14,
          );
        }
      }

      // Tooltip for hovered node
      if (currentHovered) {
        const hn = currentNodes.find((n) => n.id === currentHovered);
        if (hn) {
          const text = `${hn.label} [${hn.type}]`;
          ctx.font = "bold 12px sans-serif";
          const metrics = ctx.measureText(text);
          const tooltipW = metrics.width + 16;
          const tooltipH = 28;
          let tx = hn.x - tooltipW / 2;
          let ty = hn.y - hn.radius - tooltipH - 8;
          tx = Math.max(4, Math.min(w - tooltipW - 4, tx));
          ty = Math.max(4, ty);

          ctx.fillStyle = "rgba(0,0,0,0.8)";
          ctx.beginPath();
          ctx.roundRect(tx, ty, tooltipW, tooltipH, 6);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(text, tx + tooltipW / 2, ty + 18);
        }
      }

      // Stats overlay
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.textAlign = "left";
      ctx.fillText(
        `节点: ${currentNodes.length}  边: ${currentEdges.length}`,
        12,
        h - 12,
      );

      animFrameRef.current = requestAnimationFrame(simulate);
    };

    animFrameRef.current = requestAnimationFrame(simulate);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [nodes, edges]);

  // Mouse interaction handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getCanvasCoords = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const findNodeAt = (x: number, y: number) => {
      const currentNodes = nodesRef.current;
      for (let i = currentNodes.length - 1; i >= 0; i--) {
        const n = currentNodes[i];
        const dx = n.x - x;
        const dy = n.y - y;
        if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) {
          return n;
        }
      }
      return null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      mouseRef.current = { x, y };

      if (dragRef.current.nodeId) {
        const node = nodesRef.current.find(
          (n) => n.id === dragRef.current.nodeId,
        );
        if (node) {
          node.x = x + dragRef.current.offsetX;
          node.y = y + dragRef.current.offsetY;
          node.vx = 0;
          node.vy = 0;
        }
        return;
      }

      const found = findNodeAt(x, y);
      setHoveredNode(found?.id ?? null);
      canvas.style.cursor = found ? "pointer" : "default";
    };

    const handleMouseDown = (e: MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      const found = findNodeAt(x, y);
      if (found) {
        dragRef.current = {
          nodeId: found.id,
          offsetX: found.x - x,
          offsetY: found.y - y,
        };
      }
    };

    const handleMouseUp = () => {
      if (dragRef.current.nodeId) {
        const { x, y } = mouseRef.current;
        const found = findNodeAt(x, y);
        // Only toggle selection if it wasn't a drag (click in place)
        if (found && found.id === dragRef.current.nodeId) {
          setSelectedNode((prev) =>
            prev === found.id ? null : found.id,
          );
        }
        dragRef.current = { nodeId: null, offsetX: 0, offsetY: 0 };
      }
    };

    const handleMouseLeave = () => {
      setHoveredNode(null);
      dragRef.current = { nodeId: null, offsetX: 0, offsetY: 0 };
      canvas.style.cursor = "default";
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  if (!kbId.trim()) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        请先输入知识库 ID
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="过滤节点..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <button
            type="button"
            onClick={fetchGraph}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
          >
            刷新
          </button>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 mt-2">
          {[
            { label: "文档", color: "#3b82f6" },
            { label: "实体", color: "#22c55e" },
            { label: "概念", color: "#a855f7" },
            { label: "报告", color: "#f97316" },
          ].map((item) => (
            <span
              key={item.label}
              className="flex items-center gap-1.5 text-xs text-gray-500"
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e] z-10">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <svg
                className="animate-spin w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              加载中...
            </div>
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e] z-10">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : null}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportPanel (main component)
// ---------------------------------------------------------------------------

type TabType = "reports" | "timeline" | "graph";

interface ReportPanelProps {
  kbId: string;
  onKbIdChange: (id: string) => void;
}

export function ReportPanel({ kbId, onKbIdChange }: ReportPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("reports");

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    {
      key: "reports",
      label: "报告",
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
    },
    {
      key: "timeline",
      label: "时间线",
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      key: "graph",
      label: "关系图",
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50">
      {/* Toolbar: KB selector + tabs */}
      <div className="shrink-0 border-b border-gray-200 bg-white">
        {/* KB selector row */}
        <div className="px-4 pt-3">
          <KbSelector kbId={kbId} onChange={onKbIdChange} />
        </div>

        {/* Tab bar */}
        <div className="flex px-4 pt-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === "reports" && <ReportsTab kbId={kbId} />}
        {activeTab === "timeline" && <TimelineTab kbId={kbId} />}
        {activeTab === "graph" && <GraphTab kbId={kbId} />}
      </div>
    </div>
  );
}
