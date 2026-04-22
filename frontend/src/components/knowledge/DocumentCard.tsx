// =============================================================================
// DeepAnalyze - DocumentCard
// Unified card component that renders differently based on file type with
// L0/L1/L2 buttons, media preview, and expand/collapse content areas.
// =============================================================================

import { useState, useCallback, useRef } from "react";
import {
  FileText,
  Image as ImageIcon,
  Music,
  Video,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { api } from "../../api/client";
import { formatFileSize } from "../../utils/format";
import type { DocumentInfo } from "../../types/index";
import { MediaPlayer } from "./MediaPlayer";
import type { MediaType } from "./MediaPlayer";

// ---------------------------------------------------------------------------
// File type classification
// ---------------------------------------------------------------------------

type FileCategory = "document" | "image" | "audio" | "video" | "unknown";

const DOCUMENT_EXTS = new Set([
  "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "txt", "md", "csv", "json", "html",
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp", "svg"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"]);
const VIDEO_EXTS = new Set(["mp4", "avi", "mov", "mkv", "webm", "flv", "wmv"]);

function classifyFile(filename: string): FileCategory {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (DOCUMENT_EXTS.has(ext)) return "document";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "unknown";
}

function categoryToMediaType(cat: FileCategory): MediaType | null {
  switch (cat) {
    case "image": return "image";
    case "audio": return "audio";
    case "video": return "video";
    default: return null;
  }
}

function categoryIcon(cat: FileCategory): React.ReactNode {
  switch (cat) {
    case "document": return <FileText size={16} />;
    case "image": return <ImageIcon size={16} />;
    case "audio": return <Music size={16} />;
    case "video": return <Video size={16} />;
    default: return <FileText size={16} />;
  }
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

interface StatusDisplay {
  label: string;
  color: string;
  icon: React.ReactNode;
}

function getStatusDisplay(status: DocumentInfo["status"], processing?: ProcessingInfo | null): StatusDisplay {
  switch (status) {
    case "ready":
      return { label: "就绪", color: "var(--success)", icon: <CheckCircle size={14} /> };
    case "error":
      return { label: "错误", color: "var(--error)", icon: <AlertCircle size={14} /> };
    case "uploaded":
      return { label: "已上传", color: "var(--text-tertiary)", icon: <Clock size={14} /> };
    case "parsing":
    case "compiling":
    case "indexing":
    case "linking":
      return {
        label: STEP_LABELS[status] ?? status,
        color: "var(--warning)",
        icon: <Loader2 size={14} className="animate-spin" />,
      };
    default:
      if (processing) {
        return {
          label: STEP_LABELS[processing.step] ?? processing.step,
          color: "var(--warning)",
          icon: <Loader2 size={14} className="animate-spin" />,
        };
      }
      return { label: status, color: "var(--text-tertiary)", icon: <Clock size={14} /> };
  }
}

const STEP_LABELS: Record<string, string> = {
  parsing: "解析中",
  compiling: "编译中",
  indexing: "索引中",
  linking: "关联中",
  uploading: "上传中",
};

// ---------------------------------------------------------------------------
// LevelReadiness
// ---------------------------------------------------------------------------

export interface LevelReadiness {
  L0: boolean;
  L1: boolean;
  L2: boolean;
}

// ---------------------------------------------------------------------------
// Processing info
// ---------------------------------------------------------------------------

export interface ProcessingInfo {
  step: string;
  progress: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocumentCardProps {
  document: DocumentInfo;
  levels: LevelReadiness;
  processing?: ProcessingInfo | null;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onRetry?: () => void;
  kbId: string;
}

// ---------------------------------------------------------------------------
// Cached level content state
// ---------------------------------------------------------------------------

type LevelContentCache = Record<string, { content: string; expandable: boolean }>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocumentCard({
  document: doc,
  levels,
  processing,
  selected,
  onToggleSelect,
  onDelete,
  onRetry,
  kbId,
}: DocumentCardProps) {
  const category = classifyFile(doc.filename);
  const mediaType = categoryToMediaType(category);
  const isMedia = mediaType !== null;

  // Expanded state: "media" | "L0" | "L1" | "L2" | null
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Cache for level content
  const [levelCache, setLevelCache] = useState<LevelContentCache>({});
  // Loading state for level fetch
  const [levelLoading, setLevelLoading] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);
  // L1 format toggle: "md" (Markdown) or "dt" (DocTags)
  const [l1Format, setL1Format] = useState<"md" | "dt">("md");
  // Processor selector: "auto" | "docling" | "native"
  const [processor, setProcessor] = useState<"auto" | "docling" | "native">("auto");

  // Use ref to avoid stale closures in fetch
  const abortRef = useRef<AbortController | null>(null);

  // -------------------------------------------------------------------------
  // Toggle expand section
  // -------------------------------------------------------------------------

  const handleToggleExpand = useCallback(
    (key: string) => {
      if (expandedKey === key) {
        // Collapse
        setExpandedKey(null);
        abortRef.current?.abort();
        return;
      }

      // Expand new section
      setExpandedKey(key);
      setLevelError(null);

      // If it's a level key (L0/L1/L2) and not cached, fetch it
      if ((key === "L0" || key === "L1" || key === "L2") && !levelCache[key]) {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLevelLoading(true);
        const format = key === "L1" ? l1Format : undefined;
        api
          .expandWiki(kbId, doc.id, key, format)
          .then((result) => {
            if (!controller.signal.aborted) {
              setLevelCache((prev) => ({
                ...prev,
                [key]: { content: result.content, expandable: result.expandable },
              }));
              setLevelLoading(false);
            }
          })
          .catch((err: unknown) => {
            if (!controller.signal.aborted) {
              const msg = err instanceof Error ? err.message : String(err);
              setLevelError(msg);
              setLevelLoading(false);
            }
          });
      }
    },
    [expandedKey, levelCache, kbId, doc.id],
  );

  // -------------------------------------------------------------------------
  // Determine readiness / status display
  // -------------------------------------------------------------------------

  const isReady = doc.status === "ready";
  // Once the server reports "ready", clear stale processing state (can happen
  // if the doc_ready WebSocket event was missed during a reconnect).
  const hasProcessing = processing != null && !isReady;
  const hasError = doc.status === "error" || (processing?.error != null);
  const statusInfo = getStatusDisplay(doc.status, processing);
  const progressPct = processing ? Math.min(100, Math.max(0, processing.progress)) : 0;

  // -------------------------------------------------------------------------
  // Render: level button style helper
  // -------------------------------------------------------------------------

  const renderLevelButton = (level: "L0" | "L1" | "L2") => {
    const ready = levels[level];
    const isExpanded = expandedKey === level;

    // Button state colors
    let borderColor: string;
    let dotColor: string;
    let textColor: string;
    let bgColor: string;

    if (isExpanded) {
      // Active / expanded state - blue
      borderColor = "var(--interactive)";
      dotColor = "var(--interactive)";
      textColor = "var(--interactive)";
      bgColor = "var(--interactive-light, rgba(59, 130, 246, 0.08))";
    } else if (ready) {
      // Ready but not expanded - green
      borderColor = "var(--success)";
      dotColor = "var(--success)";
      textColor = "var(--success)";
      bgColor = "transparent";
    } else {
      // Not ready - gray
      borderColor = "var(--border-primary)";
      dotColor = "var(--text-tertiary)";
      textColor = "var(--text-tertiary)";
      bgColor = "transparent";
    }

    return (
      <button
        key={level}
        onClick={() => handleToggleExpand(level)}
        disabled={!ready && !isExpanded}
        title={ready ? `${level} 内容` : `${level} 未就绪`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "var(--space-1) var(--space-2)",
          border: `1px solid ${borderColor}`,
          borderRadius: "var(--radius-sm)",
          backgroundColor: bgColor,
          color: textColor,
          fontSize: "var(--text-xs)",
          fontWeight: "var(--font-medium)",
          cursor: ready || isExpanded ? "pointer" : "not-allowed",
          opacity: !ready && !isExpanded ? 0.5 : 1,
          transition: "all var(--transition-fast)",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          if (ready || isExpanded) {
            e.currentTarget.style.opacity = "0.85";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = !ready && !isExpanded ? "0.5" : "1";
        }}
      >
        {/* Readiness dot */}
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: dotColor,
            flexShrink: 0,
          }}
        />
        {level}
        {isExpanded && <ChevronDown size={10} style={{ marginLeft: -2 }} />}
      </button>
    );
  };

  // -------------------------------------------------------------------------
  // Render: expanded content area
  // -------------------------------------------------------------------------

  const renderExpandedContent = () => {
    if (!expandedKey) return null;

    // Media preview
    if (expandedKey === "media") {
      const originalUrl = api.getOriginalFileUrl(kbId, doc.id);
      const thumbnailUrl = api.getThumbnailUrl(kbId, doc.id);

      if (mediaType === "image") {
        return (
          <MediaPlayer
            mediaType="image"
            imageProps={{
              thumbnailUrl,
              originalUrl,
            }}
          />
        );
      }

      if (mediaType === "audio") {
        return (
          <MediaPlayer
            mediaType="audio"
            audioProps={{
              src: originalUrl,
              duration: 0,
              speakers: [],
              turns: [],
            }}
          />
        );
      }

      if (mediaType === "video") {
        return (
          <MediaPlayer
            mediaType="video"
            videoProps={{
              src: originalUrl,
              duration: 0,
              scenes: [],
              transcript: { speakers: [], turns: [] },
              frameUrls: [],
            }}
          />
        );
      }

      return null;
    }

    // Level content (L0/L1/L2)
    if (expandedKey === "L0" || expandedKey === "L1" || expandedKey === "L2") {
      // Show loading
      if (levelLoading) {
        return (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-2)",
            padding: "var(--space-4)",
            color: "var(--text-tertiary)",
          }}>
            <Loader2 size={16} className="animate-spin" />
            <span style={{ fontSize: "var(--text-sm)" }}>加载中...</span>
          </div>
        );
      }

      // Show error
      if (levelError) {
        return (
          <div style={{
            padding: "var(--space-3)",
            backgroundColor: "rgba(239, 68, 68, 0.06)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            borderRadius: "var(--radius-md)",
          }}>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--error)", margin: 0 }}>
              加载失败: {levelError}
            </p>
          </div>
        );
      }

      // Show cached content
      const cached = levelCache[expandedKey];
      if (cached) {
        return (
          <div style={{
            padding: "var(--space-3)",
            backgroundColor: "var(--bg-tertiary)",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-md)",
            maxHeight: 400,
            overflowY: "auto",
          }}>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-primary)",
                lineHeight: "var(--leading-relaxed)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {cached.content}
            </div>
          </div>
        );
      }

      return null;
    }

    return null;
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      style={{
        border: `1px solid ${selected ? "var(--interactive)" : "var(--border-primary)"}`,
        borderRadius: "var(--radius-lg)",
        backgroundColor: selected ? "var(--interactive-light, rgba(59, 130, 246, 0.04))" : "var(--bg-primary)",
        overflow: "hidden",
        transition: "border-color var(--transition-fast), background-color var(--transition-fast)",
      }}
    >
      {/* ====== Card header ====== */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-2)",
          padding: "var(--space-3)",
        }}
      >
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          style={{
            marginTop: 2,
            accentColor: "var(--interactive)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        />

        {/* File type icon */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            flexShrink: 0,
          }}
        >
          {categoryIcon(category)}
        </div>

        {/* Filename, size, status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-medium)",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              margin: 0,
            }}
          >
            {doc.filename}
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              marginTop: "var(--space-1)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
              {formatFileSize(doc.fileSize)}
            </span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
              {category !== "unknown" ? category.charAt(0).toUpperCase() + category.slice(1) : doc.fileType.toUpperCase()}
            </span>
            {/* Status indicator */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                fontSize: "var(--text-xs)",
                color: statusInfo.color,
                fontWeight: "var(--font-medium)",
              }}
            >
              {statusInfo.icon}
              {statusInfo.label}
            </span>
          </div>
        </div>

        {/* Delete button */}
        <button
          onClick={onDelete}
          title="删除文档"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            border: "none",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "transparent",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            flexShrink: 0,
            transition: "color var(--transition-fast), background-color var(--transition-fast)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--error)";
            e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-tertiary)";
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* ====== Processing progress bar ====== */}
      {hasProcessing && !hasError && (
        <div
          style={{
            padding: "0 var(--space-3) var(--space-2)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <div
            style={{
              flex: 1,
              height: 4,
              backgroundColor: "var(--border-primary)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                backgroundColor: "var(--interactive)",
                borderRadius: 2,
                transition: "width 0.3s",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              flexShrink: 0,
              minWidth: 32,
              textAlign: "right",
            }}
          >
            {progressPct}%
          </span>
        </div>
      )}

      {/* ====== Error message with retry ====== */}
      {hasError && (
        <div
          style={{
            margin: "0 var(--space-3) var(--space-2)",
            padding: "var(--space-2) var(--space-3)",
            backgroundColor: "rgba(239, 68, 68, 0.06)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-2)",
          }}
        >
          <p
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--error)",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
          >
            {processing?.error ?? "处理失败"}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding: "var(--space-1) var(--space-2)",
                border: "1px solid var(--interactive)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "transparent",
                color: "var(--interactive)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--font-medium)",
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
                transition: "color var(--transition-fast), background-color var(--transition-fast)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#fff";
                e.currentTarget.style.backgroundColor = "var(--interactive)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--interactive)";
                e.currentTarget.style.backgroundColor = "transparent";
              }}
              title="重试"
            >
              <RefreshCw size={10} />
              重试
            </button>
          )}
        </div>
      )}

      {/* ====== Level buttons row (only when ready) ====== */}
      {isReady && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "0 var(--space-3) var(--space-2)",
            flexWrap: "wrap",
          }}
        >
          {renderLevelButton("L0")}
          {renderLevelButton("L1")}

          {/* L1 Format toggle (MD/DT) */}
          {expandedKey === "L1" && (
            <div
              style={{
                display: "inline-flex",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
              }}
            >
              {(["md", "dt"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => {
                    setL1Format(fmt);
                    // Clear cache and refetch with new format
                    setLevelCache((prev) => { const next = { ...prev }; delete next.L1; return next; });
                    handleToggleExpand("L1");
                    setExpandedKey("L1");
                  }}
                  style={{
                    padding: "var(--space-1) var(--space-2)",
                    border: "none",
                    backgroundColor: l1Format === fmt ? "var(--interactive-light, rgba(59, 130, 246, 0.12))" : "transparent",
                    color: l1Format === fmt ? "var(--interactive)" : "var(--text-tertiary)",
                    fontSize: "var(--text-xs)",
                    fontWeight: l1Format === fmt ? "var(--font-medium)" : "var(--font-normal)",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                  }}
                  title={fmt === "md" ? "Markdown 格式" : "DocTags 格式"}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {renderLevelButton("L2")}

          {/* Media toggle button */}
          {isMedia && (
            <button
              onClick={() => handleToggleExpand("media")}
              title="预览媒体"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding: "var(--space-1) var(--space-2)",
                border: `1px solid ${expandedKey === "media" ? "var(--interactive)" : "var(--border-primary)"}`,
                borderRadius: "var(--radius-sm)",
                backgroundColor: expandedKey === "media"
                  ? "var(--interactive-light, rgba(59, 130, 246, 0.08))"
                  : "transparent",
                color: expandedKey === "media" ? "var(--interactive)" : "var(--text-secondary)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--font-medium)",
                cursor: "pointer",
                transition: "all var(--transition-fast)",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.85";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
            >
              <Play size={10} />
              预览
              {expandedKey === "media" && <ChevronDown size={10} style={{ marginLeft: -2 }} />}
            </button>
          )}

          {/* Processor selector */}
          {!isMedia && (
            <select
              value={processor}
              onChange={(e) => setProcessor(e.target.value as "auto" | "docling" | "native")}
              title="处理器选择"
              style={{
                padding: "var(--space-1) var(--space-2)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-secondary)",
                fontSize: "var(--text-xs)",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="auto">Auto</option>
              <option value="docling">Docling</option>
              <option value="native">Native</option>
            </select>
          )}
        </div>
      )}

      {/* ====== Expanded content area ====== */}
      {expandedKey && (
        <div
          style={{
            padding: "0 var(--space-3) var(--space-3)",
            borderTop: "1px solid var(--border-primary)",
            marginTop: "var(--space-1)",
            paddingTop: "var(--space-2)",
          }}
        >
          {renderExpandedContent()}
        </div>
      )}
    </div>
  );
}
