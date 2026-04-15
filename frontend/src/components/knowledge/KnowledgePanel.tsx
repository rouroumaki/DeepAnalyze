// =============================================================================
// DeepAnalyze - KnowledgePanel Component
// Knowledge base browser with search, document management, and wiki browsing
// =============================================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { api, uploadDocumentWithRetry, fetchDocumentStatus } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import { selectFolder, openFileDialog } from "../../hooks/useFileUpload";
import { useDocProcessing } from "../../hooks/useDocProcessing";
import type { KnowledgeBase, DocumentInfo } from "../../types/index";
import { WikiBrowser } from "./WikiBrowser";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { EntityPage } from "./EntityPage";
import { DropZone } from "../ui/DropZone";
import { UnifiedSearch } from "../search/UnifiedSearch";
import { TeamManager } from "../teams/TeamManager";
import {
  Database,
  Plus,
  Upload,
  Search,
  Trash2,
  FileText,
  BookOpen,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  X,
  FolderOpen,
  Settings,
  Eye,
  Loader2,
  Users,
  Play,
  Share2,
} from "lucide-react";

interface KnowledgePanelProps {
  kbId: string;
  onKbIdChange: (id: string) => void;
}

type TabId = "documents" | "wiki" | "entities" | "graph" | "search" | "teams" | "settings";

interface HealthCheckResult {
  name: string;
  status: "ok" | "error" | "warning";
  message: string;
}

interface UploadState {
  docId: string;
  filename: string;
  stage: string;
  progress: number;
  error?: string;
  retrying?: boolean;
}

const STEP_LABELS: Record<string, string> = {
  parsing: "解析中",
  compiling: "编译中",
  indexing: "索引中",
  linking: "关联中",
  uploading: "上传中",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  uploaded: {
    label: "已上传",
    color: "var(--text-tertiary)",
    icon: <Clock size={14} />,
  },
  parsing: {
    label: "解析中",
    color: "var(--warning)",
    icon: <Loader2 size={14} className="animate-spin" />,
  },
  compiling: {
    label: "编译中",
    color: "var(--warning)",
    icon: <Loader2 size={14} className="animate-spin" />,
  },
  indexing: {
    label: "索引中",
    color: "var(--warning)",
    icon: <Loader2 size={14} className="animate-spin" />,
  },
  linking: {
    label: "关联中",
    color: "var(--warning)",
    icon: <Loader2 size={14} className="animate-spin" />,
  },
  ready: {
    label: "就绪",
    color: "var(--success)",
    icon: <CheckCircle size={14} />,
  },
  error: {
    label: "错误",
    color: "var(--error)",
    icon: <AlertCircle size={14} />,
  },
};

export function KnowledgePanel({ kbId, onKbIdChange }: KnowledgePanelProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const { processingDocs, wsConnected } = useDocProcessing(kbId || null);

  // --- Data state ---
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);

  // --- UI state ---
  const [activeTab, setActiveTab] = useState<TabId>("documents");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [navigatingEntity, setNavigatingEntity] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<HealthCheckResult[]>([]);
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingKbs, setIsLoadingKbs] = useState(true);

  // --- Upload tracking state ---
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  // --- Entities state ---
  const [entities, setEntities] = useState<Array<{ name: string; type: string; mentions: number; docCount: number }>>([]);

  // --- Load knowledge bases ---
  const loadKnowledgeBases = useCallback(async () => {
    setIsLoadingKbs(true);
    setLoadError(null);
    try {
      const kbs = await api.listKnowledgeBases();
      setKnowledgeBases(Array.isArray(kbs) ? kbs : []);
      if (Array.isArray(kbs) && kbs.length > 0 && !kbId) {
        onKbIdChange(kbs[0].id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      console.error("[KnowledgePanel] Failed to load knowledge bases:", msg);
    } finally {
      setIsLoadingKbs(false);
    }
  }, [kbId, onKbIdChange]);

  useEffect(() => {
    loadKnowledgeBases();
  }, [loadKnowledgeBases]);

  // --- Load documents when kb changes ---
  useEffect(() => {
    if (!kbId) {
      setDocuments([]);
      return;
    }
    api
      .listDocuments(kbId)
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, [kbId]);

  // --- Load entities when entity tab is active ---
  useEffect(() => {
    if (activeTab === "entities" && kbId) {
      api.getEntities(kbId).then(setEntities).catch(() => setEntities([]));
    }
  }, [activeTab, kbId]);

  // --- Handlers ---

  const refreshDocuments = useCallback(async () => {
    if (!kbId) return;
    try {
      const docs = await api.listDocuments(kbId);
      setDocuments(docs);
    } catch {
      // silently refresh
    }
  }, [kbId]);

  const handleRetryProcess = useCallback(async (docId: string) => {
    if (!kbId) return;
    try {
      await fetch(`/api/knowledge/kbs/${kbId}/process/${docId}`, { method: "POST" });
      success("已重新提交处理");
      refreshDocuments();
    } catch {
      toastError("重试失败");
    }
  }, [kbId, success, toastError, refreshDocuments]);

  const handleDeleteDocument = async (docId: string) => {
    if (!kbId) return;
    const confirmed = await confirm({
      title: "删除文档",
      message: "确定要删除该文档吗？此操作不可撤销。",
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await api.deleteDocument(kbId, docId);
      success("文档已删除");
      refreshDocuments();
    } catch {
      toastError("删除失败");
    }
  };

  // --- Non-blocking upload with progress tracking ---
  const handleFiles = async (files: FileList | File[]) => {
    if (!kbId) return;
    for (const file of Array.from(files)) {
      const tempId = `temp-${Date.now()}-${file.name}`;
      setUploads((prev) => [...prev, { docId: tempId, filename: file.name, stage: "Upload", progress: 0 }]);
      uploadDocumentWithRetry(kbId, file, {
        onProgress: (pct) =>
          setUploads((prev) =>
            prev.map((u) => (u.docId === tempId ? { ...u, progress: pct } : u))
          ),
      })
        .then((result) => {
          setUploads((prev) =>
            prev.map((u) =>
              u.docId === tempId
                ? { ...u, docId: result.docId, stage: "Parsing", progress: 45 }
                : u
            )
          );
          refreshDocuments();
        })
        .catch((err) => {
          setUploads((prev) =>
            prev.map((u) =>
              u.docId === tempId
                ? { ...u, stage: "Error", progress: 0, error: err instanceof Error ? err.message : String(err) }
                : u
            )
          );
        });
    }
  };

  // --- WebSocket disconnect polling fallback ---
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  useEffect(() => {
    if (!wsConnected && uploadsRef.current.length > 0) {
      const interval = setInterval(async () => {
        for (const upload of uploadsRef.current) {
          if (
            upload.stage !== "Ready" &&
            upload.stage !== "Error" &&
            !upload.docId.startsWith("temp-")
          ) {
            try {
              const status = await fetchDocumentStatus(kbId, upload.docId);
              setUploads((prev) =>
                prev.map((u) =>
                  u.docId === upload.docId
                    ? { ...u, stage: status.stage, progress: status.progress, error: status.error }
                    : u
                )
              );
            } catch {
              /* ignore polling errors */
            }
          }
        }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [wsConnected, kbId]);

  // --- Batch operations ---
  const toggleSelect = (docId: string) =>
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      next.has(docId) ? next.delete(docId) : next.add(docId);
      return next;
    });

  const selectAll = () => setSelectedDocs(new Set(documents.map((d) => d.id)));

  const deselectAll = () => setSelectedDocs(new Set());

  const batchDelete = async () => {
    if (!kbId || selectedDocs.size === 0) return;
    const confirmed = await confirm({
      title: "批量删除",
      message: `确定要删除选中的 ${selectedDocs.size} 个文档吗？此操作不可撤销。`,
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      for (const docId of selectedDocs) {
        await api.deleteDocument(kbId, docId);
      }
      success(`已删除 ${selectedDocs.size} 个文档`);
      setSelectedDocs(new Set());
      refreshDocuments();
    } catch {
      toastError("批量删除失败");
    }
  };

  const retryFailed = async (docId: string) => {
    if (!kbId) return;
    try {
      await fetch(`/api/knowledge/kbs/${kbId}/process/${docId}`, { method: "POST" });
      success("已重新提交处理");
      refreshDocuments();
    } catch {
      toastError("重试失败");
    }
  };

  const handleCreateKb = async () => {
    const name = newKbName.trim();
    if (!name) return;
    setIsCreating(true);
    try {
      const kb = await api.createKnowledgeBase(name);
      success("知识库已创建");
      setShowCreateModal(false);
      setNewKbName("");
      loadKnowledgeBases();
      onKbIdChange(kb.id);
    } catch {
      toastError("创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteKb = async () => {
    if (!kbId) return;
    const confirmed = await confirm({
      title: "删除知识库",
      message: "确定要删除该知识库吗？此操作不可撤销，所有文档和数据将被永久删除。",
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await api.deleteKnowledgeBase(kbId);
      success("知识库已删除");
      onKbIdChange("");
      loadKnowledgeBases();
    } catch {
      toastError("删除知识库失败");
    }
  };

  const handleHealthCheck = async () => {
    if (!kbId) return;
    setIsHealthChecking(true);
    setHealthResults([]);
    try {
      const results: HealthCheckResult[] = [];
      // Check backend health
      try {
        const health = await api.health();
        results.push({
          name: "后端服务",
          status: "ok",
          message: `服务正常运行 (${health.version || "unknown version"})`,
        });
      } catch {
        results.push({
          name: "后端服务",
          status: "error",
          message: "后端服务不可达",
        });
      }
      // Check KB documents accessibility
      try {
        const docs = await api.listDocuments(kbId);
        results.push({
          name: "知识库索引",
          status: "ok",
          message: `索引正常，${docs.length} 个文档`,
        });
      } catch {
        results.push({
          name: "知识库索引",
          status: "error",
          message: "无法读取知识库文档列表",
        });
      }
      setHealthResults(results);
    } catch {
      setHealthResults([
        { name: "健康检查", status: "error", message: "无法完成健康检查" },
      ]);
    } finally {
      setIsHealthChecking(false);
    }
  };

  // --- Tabs config ---
  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: "documents", label: "文档", icon: <FileText size={14} /> },
    { id: "wiki", label: "Wiki", icon: <BookOpen size={14} /> },
    { id: "entities", label: "实体", icon: <Users size={14} /> },
    { id: "graph", label: "图谱", icon: <Share2 size={14} /> },
    { id: "search", label: "搜索", icon: <Search size={14} /> },
    { id: "teams", label: "团队", icon: <Users size={14} /> },
    { id: "settings", label: "设置", icon: <Settings size={14} /> },
  ];

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      {/* ================================================================== */}
      {/* KB Selector Header                                                 */}
      {/* ================================================================== */}
      <div
        style={{
          flexShrink: 0,
          borderBottom: "1px solid var(--border-primary)",
          padding: "var(--space-3) var(--space-4)",
          backgroundColor: "var(--bg-secondary)",
        }}
      >
        {/* Selector row */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div
            style={{
              flex: 1,
              position: "relative",
              display: "flex",
              alignItems: "center",
            }}
          >
            <Database
              size={16}
              style={{
                position: "absolute",
                left: "var(--space-3)",
                color: "var(--text-tertiary)",
                pointerEvents: "none",
              }}
            />
            <ChevronDown
              size={14}
              style={{
                position: "absolute",
                right: "var(--space-3)",
                color: "var(--text-tertiary)",
                pointerEvents: "none",
              }}
            />
            <select
              value={kbId}
              onChange={(e) => onKbIdChange(e.target.value)}
              style={{
                width: "100%",
                padding: "var(--space-2) var(--space-8) var(--space-2) var(--space-8)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-sm)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                outline: "none",
                cursor: "pointer",
                appearance: "none",
              }}
            >
              <option value="">-- 选择知识库 --</option>
              {knowledgeBases.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}{kb.documentCount != null ? ` (${kb.documentCount} 文档)` : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-1)",
              padding: "var(--space-2) var(--space-3)",
              backgroundColor: "var(--interactive)",
              color: "#fff",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-medium)",
              borderRadius: "var(--radius-md)",
              border: "none",
              cursor: "pointer",
              transition: "background-color var(--transition-fast)",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor =
                "var(--interactive-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--interactive)")
            }
          >
            <Plus size={14} />
            新建
          </button>
        </div>

        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            marginTop: "var(--space-3)",
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-1) var(--space-3)",
                  fontSize: "var(--text-xs)",
                  fontWeight: "var(--font-medium)",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                  backgroundColor: isActive
                    ? "var(--interactive)"
                    : "transparent",
                  color: isActive ? "#fff" : "var(--text-tertiary)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = "var(--text-secondary)";
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = "var(--text-tertiary)";
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ================================================================== */}
      {/* Content area                                                       */}
      {/* ================================================================== */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--space-4)",
        }}
      >
        {!kbId ? (
          /* ---- No KB selected ---- */
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-12) 0",
              color: "var(--text-tertiary)",
            }}
          >
            {isLoadingKbs ? (
              <>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    border: "3px solid var(--border-primary)",
                    borderTopColor: "var(--interactive)",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    margin: "0 auto var(--space-3)",
                  }}
                />
                <p style={{ fontSize: "var(--text-sm)" }}>加载知识库列表...</p>
              </>
            ) : loadError ? (
              <>
                <AlertCircle
                  size={40}
                  style={{
                    margin: "0 auto var(--space-3)",
                    display: "block",
                    color: "var(--error)",
                  }}
                />
                <p style={{ fontSize: "var(--text-sm)", color: "var(--error)" }}>
                  加载知识库失败
                </p>
                <p style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-1)", maxWidth: 400, margin: "var(--space-1) auto 0" }}>
                  {loadError}
                </p>
                <button
                  onClick={loadKnowledgeBases}
                  style={{
                    marginTop: "var(--space-3)",
                    padding: "var(--space-2) var(--space-4)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--surface-primary)",
                    fontSize: "var(--text-sm)",
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                  }}
                >
                  重试
                </button>
              </>
            ) : knowledgeBases.length === 0 ? (
              <>
                <FolderOpen
                  size={40}
                  style={{
                    margin: "0 auto var(--space-3)",
                    opacity: 0.4,
                    display: "block",
                  }}
                />
                <p style={{ fontSize: "var(--text-sm)" }}>暂无知识库</p>
                <p style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }}>
                  点击上方"新建"按钮创建一个知识库
                </p>
              </>
            ) : (
              <>
                <FolderOpen
                  size={40}
                  style={{
                    margin: "0 auto var(--space-3)",
                    opacity: 0.4,
                    display: "block",
                  }}
                />
                <p style={{ fontSize: "var(--text-sm)" }}>请选择或创建一个知识库</p>
              </>
            )}
          </div>
        ) : navigatingEntity ? (
          /* Entity Navigation Page */
          <EntityPage
            kbId={kbId}
            entityName={navigatingEntity}
            onBack={() => setNavigatingEntity(null)}
            onNavigateEntity={(name) => setNavigatingEntity(name)}
          />
        ) : activeTab === "documents" ? (
          /* Documents Tab */
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {/* Upload toolbar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                {documents.length > 0 && (
                  <input
                    type="checkbox"
                    checked={selectedDocs.size === documents.length && documents.length > 0}
                    onChange={() => selectedDocs.size === documents.length ? deselectAll() : selectAll()}
                    title={selectedDocs.size === documents.length ? "取消全选" : "全选"}
                    style={{ cursor: "pointer", accentColor: "var(--interactive)" }}
                  />
                )}
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                  {documents.length > 0 ? `${documents.length} 个文档` : ""}
                  {selectedDocs.size > 0 ? ` (已选 ${selectedDocs.size})` : ""}
                </span>
                {/* WS connection indicator */}
                <span
                  title={wsConnected ? "实时连接正常" : "实时连接已断开"}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: wsConnected ? "var(--success)" : "var(--text-tertiary)",
                    opacity: wsConnected ? 1 : 0.5,
                    transition: "background-color var(--transition-fast), opacity var(--transition-fast)",
                  }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                {/* Batch delete button */}
                {selectedDocs.size > 0 && (
                  <button
                    onClick={batchDelete}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "var(--space-2) var(--space-3)",
                      backgroundColor: "transparent",
                      color: "var(--error)",
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--font-medium)",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--error)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Trash2 size={14} />
                    删除 ({selectedDocs.size})
                  </button>
                )}
                {/* Upload folder button */}
                <button
                  onClick={async () => {
                    if (!kbId) { toastError("请先选择知识库"); return; }
                    const files = await selectFolder();
                    if (files && files.length > 0) {
                      handleFiles(files);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    padding: "var(--space-2) var(--space-3)",
                    backgroundColor: "transparent",
                    color: "var(--text-secondary)",
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--font-medium)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-primary)",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "var(--interactive)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.borderColor = "var(--border-primary)";
                  }}
                >
                  <FolderOpen size={14} />
                  上传文件夹
                </button>
                {/* Upload files button */}
                <button
                  onClick={async () => {
                    if (!kbId) { toastError("请先选择知识库"); return; }
                    const files = await openFileDialog(".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx,.html,.htm", true);
                    if (files && files.length > 0) {
                      handleFiles(files);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    padding: "var(--space-2) var(--space-3)",
                    backgroundColor: "var(--interactive)",
                    color: "#fff",
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--font-medium)",
                    borderRadius: "var(--radius-md)",
                    border: "none",
                    cursor: "pointer",
                    transition: "background-color var(--transition-fast)",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--interactive-hover)";
                  }}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "var(--interactive)")
                  }
                >
                  <Upload size={14} />
                  上传文档
                </button>
                {/* Manual processing trigger — shown when there are uploaded docs awaiting processing */}
                {documents.some((d) => d.status === "uploaded" || d.status === "error") && (
                  <button
                    onClick={async () => {
                      if (!kbId) return;
                      try {
                        const result = await api.triggerProcessing(kbId);
                        success(`已将 ${result.enqueued ?? 0} 个文档加入处理队列`);
                      } catch {
                        toastError("触发处理失败");
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "var(--space-2) var(--space-3)",
                      backgroundColor: "var(--warning, #f59e0b)",
                      color: "#fff",
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--font-medium)",
                      borderRadius: "var(--radius-md)",
                      border: "none",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Play size={14} />
                    开始处理
                  </button>
                )}
              </div>
            </div>

            {/* Upload progress indicators */}
            {uploads.map((upload) => (
              <div
                key={upload.docId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  padding: "var(--space-3) var(--space-4)",
                  backgroundColor: upload.stage === "Error" ? "var(--error-light)" : "var(--bg-tertiary)",
                  border: upload.stage === "Error" ? "1px solid var(--error)" : "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-lg)",
                }}
              >
                {upload.stage === "Error" ? (
                  <AlertCircle size={14} style={{ color: "var(--error)" }} />
                ) : upload.stage === "Ready" ? (
                  <CheckCircle size={14} style={{ color: "var(--success)" }} />
                ) : (
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite", color: "var(--interactive)" }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "var(--text-sm)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {upload.filename}
                  </p>
                  {upload.stage !== "Ready" && upload.stage !== "Error" && (
                    <div style={{ marginTop: "var(--space-1)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <div style={{ flex: 1, height: 4, backgroundColor: "var(--border-primary)", borderRadius: 2 }}>
                        <div style={{ width: `${upload.progress}%`, height: "100%", backgroundColor: "var(--interactive)", borderRadius: 2, transition: "width 0.3s" }} />
                      </div>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", flexShrink: 0 }}>
                        {upload.stage} {upload.progress}%
                      </span>
                    </div>
                  )}
                  {upload.stage === "Error" && (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--error)", margin: "var(--space-1) 0 0" }}>
                      {upload.error ?? "上传失败"}
                    </p>
                  )}
                </div>
                {upload.stage === "Error" && (
                  <button
                    onClick={() => {
                      if (!upload.docId.startsWith("temp-")) {
                        retryFailed(upload.docId);
                      }
                    }}
                    style={{
                      padding: "var(--space-1) var(--space-2)",
                      border: "1px solid var(--interactive)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      color: "var(--interactive)",
                      backgroundColor: "transparent",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--font-medium)",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    重试
                  </button>
                )}
              </div>
            ))}

            {documents.length === 0 && uploads.length === 0 ? (
              /* Empty state with DropZone */
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", alignItems: "center" }}>
                <DropZone
                  onFiles={(files) => {
                    if (!kbId) { toastError("请先选择知识库"); return; }
                    handleFiles(files);
                  }}
                  accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx,.html,.htm"
                  label="拖拽文件到此处上传"
                  hint="或点击选择文件"
                  style={{ width: "100%" }}
                />
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  支持 PDF、Word、TXT、Markdown、CSV 等格式
                </p>
              </div>
            ) : (
              /* Document list */
              documents.map((doc) => {
                const processing = processingDocs.get(doc.id);
                // Determine the effective display status
                let statusIcon: React.ReactNode;
                let statusLabel: string;
                let statusColor: string;
                let showProgress = false;
                let progressPct = 0;
                let showError = false;
                let errorMsg = "";

                if (processing) {
                  // Document is actively being processed via WebSocket
                  const stepLabel = STEP_LABELS[processing.step] ?? processing.step;
                  statusIcon = <Loader2 size={14} className="animate-spin" />;
                  statusLabel = stepLabel;
                  statusColor = "var(--warning)";
                  showProgress = true;
                  progressPct = processing.progress;
                  if (processing.error) {
                    showError = true;
                    errorMsg = processing.error;
                  }
                } else if (doc.status === "error") {
                  // Document errored out
                  statusIcon = <AlertCircle size={14} />;
                  statusLabel = "失败";
                  statusColor = "var(--error)";
                  showError = true;
                  errorMsg = "";
                } else if (doc.status === "ready") {
                  statusIcon = <CheckCircle size={14} />;
                  statusLabel = "就绪";
                  statusColor = "var(--success)";
                } else if (doc.status === "uploaded") {
                  // Uploaded but not yet processing = queued
                  statusIcon = <Clock size={14} />;
                  statusLabel = "排队中";
                  statusColor = "var(--text-tertiary)";
                } else {
                  // Fallback for other statuses (parsing, compiling, etc.)
                  const statusCfg = STATUS_CONFIG[doc.status] ?? {
                    label: doc.status,
                    color: "var(--text-tertiary)",
                    icon: <FileText size={14} />,
                  };
                  statusIcon = statusCfg.icon;
                  statusLabel = statusCfg.label;
                  statusColor = statusCfg.color;
                }

                return (
                  <div
                    key={doc.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-3)",
                      padding: "var(--space-3) var(--space-4)",
                      backgroundColor: showError ? "var(--error-light)" : selectedDocs.has(doc.id) ? "var(--interactive-light)" : "var(--bg-tertiary)",
                      border: showError ? "1px solid var(--error)" : selectedDocs.has(doc.id) ? "1px solid var(--interactive)" : "1px solid var(--border-primary)",
                      borderRadius: "var(--radius-lg)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDocs.has(doc.id)}
                      onChange={() => toggleSelect(doc.id)}
                      style={{ cursor: "pointer", accentColor: "var(--interactive)", flexShrink: 0 }}
                    />
                    <FileText
                      size={18}
                      style={{
                        flexShrink: 0,
                        color: "var(--text-tertiary)",
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <p
                        style={{
                          fontSize: "var(--text-sm)",
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
                        }}
                      >
                        <span
                          style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          {doc.fileType}
                        </span>
                        <span
                          style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          {(doc.fileSize / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      {/* Processing progress bar */}
                      {showProgress && (
                        <div style={{ marginTop: "var(--space-1)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <div style={{ flex: 1, height: 4, backgroundColor: "var(--border-primary)", borderRadius: 2 }}>
                            <div style={{ width: `${progressPct}%`, height: "100%", backgroundColor: "var(--interactive)", borderRadius: 2, transition: "width 0.3s" }} />
                          </div>
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", flexShrink: 0 }}>
                            {progressPct}%
                          </span>
                        </div>
                      )}
                      {/* Error message */}
                      {showError && errorMsg && (
                        <p style={{ fontSize: "var(--text-xs)", color: "var(--error)", margin: "var(--space-1) 0 0" }}>
                          {errorMsg}
                        </p>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        color: statusColor,
                        fontSize: "var(--text-xs)",
                        fontWeight: "var(--font-medium)",
                        flexShrink: 0,
                      }}
                    >
                      {statusIcon}
                      {statusLabel}
                    </div>
                    {/* Retry button for error status */}
                    {doc.status === "error" && (
                      <button
                        onClick={() => handleRetryProcess(doc.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "var(--space-1) var(--space-2)",
                          border: "1px solid var(--interactive)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          color: "var(--interactive)",
                          backgroundColor: "transparent",
                          fontSize: "var(--text-xs)",
                          fontWeight: "var(--font-medium)",
                          transition: "color var(--transition-fast), background-color var(--transition-fast)",
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = "#fff";
                          e.currentTarget.style.backgroundColor = "var(--interactive)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = "var(--interactive)";
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                        title="重新处理"
                      >
                        重试
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteDocument(doc.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "var(--space-1)",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        color: "var(--text-tertiary)",
                        backgroundColor: "transparent",
                        transition: "color var(--transition-fast), background-color var(--transition-fast)",
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--error)";
                        e.currentTarget.style.backgroundColor =
                          "var(--error-light)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "var(--text-tertiary)";
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                      title="删除文档"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        ) : activeTab === "wiki" ? (
          /* Wiki Browser Tab */
          <WikiBrowser
            kbId={kbId}
            onNavigateEntity={(name) => setNavigatingEntity(name)}
          />
        ) : activeTab === "entities" ? (
          /* Entities Tab */
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                {entities.length > 0 ? `${entities.length} 个实体` : ""}
              </span>
            </div>
            {entities.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "var(--space-12) 0",
                  color: "var(--text-tertiary)",
                }}
              >
                <Users
                  size={40}
                  style={{
                    margin: "0 auto var(--space-3)",
                    opacity: 0.4,
                    display: "block",
                  }}
                />
                <p style={{ fontSize: "var(--text-sm)", margin: 0 }}>
                  暂无实体
                </p>
                <p style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }}>
                  处理文档后将自动提取实体
                </p>
              </div>
            ) : (
              /* Group entities by type */
              (() => {
                const grouped = entities.reduce<Record<string, typeof entities>>((acc, e) => {
                  const key = e.type || "实体";
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(e);
                  return acc;
                }, {});

                return Object.entries(grouped).map(([type, items]) => (
                  <div key={type}>
                    <p
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: "var(--font-semibold)",
                        color: "var(--text-tertiary)",
                        margin: "0 0 var(--space-2)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {type} ({items.length})
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--space-1)",
                      }}
                    >
                      {items.map((entity, i) => (
                        <button
                          key={`${entity.name}-${i}`}
                          onClick={() => {
                            setNavigatingEntity(entity.name);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "var(--space-3)",
                            padding: "var(--space-2) var(--space-3)",
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-primary)",
                            borderRadius: "var(--radius-md)",
                            cursor: "pointer",
                            textAlign: "left",
                            transition:
                              "border-color var(--transition-fast), box-shadow var(--transition-fast)",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "var(--interactive)";
                            e.currentTarget.style.boxShadow =
                              "0 0 0 1px var(--interactive-light)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "var(--border-primary)";
                            e.currentTarget.style.boxShadow = "none";
                          }}
                        >
                          <span
                            style={{
                              fontSize: "var(--text-sm)",
                              color: "var(--text-primary)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {entity.name}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--space-2)",
                              flexShrink: 0,
                            }}
                          >
                            <span
                              style={{
                                fontSize: "var(--text-xs)",
                                color: "var(--text-tertiary)",
                              }}
                            >
                              {entity.mentions} 引用
                            </span>
                            <span
                              style={{
                                fontSize: "var(--text-xs)",
                                color: "var(--text-tertiary)",
                              }}
                            >
                              {entity.docCount} 文档
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ));
              })()
            )}
          </div>
        ) : activeTab === "graph" ? (
          /* Graph Tab */
          <KnowledgeGraph kbId={kbId} />
        ) : activeTab === "search" ? (
          /* Unified Search Tab - replaces legacy search UI */
          <UnifiedSearch
            kbId={kbId}
            onResultClick={(result) => {
              // Navigate to wiki tab when a search result is clicked
              if (result.docId) {
                setActiveTab("wiki");
              }
            }}
            onEntityClick={(entity) => {
              // Navigate to the entity page
              setNavigatingEntity(entity.name);
            }}
          />
        ) : activeTab === "teams" ? (
          /* Agent Teams Tab */
          <TeamManager />
        ) : activeTab === "settings" ? (
          /* Settings Tab */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            {/* KB Info Section */}
            <div
              style={{
                padding: "var(--space-4)",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-lg)",
              }}
            >
              <h4
                style={{
                  margin: "0 0 var(--space-3)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-semibold)",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                <Settings size={14} />
                知识库信息
              </h4>
              {(() => {
                const currentKb = knowledgeBases.find((kb) => kb.id === kbId);
                return currentKb ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        名称
                      </span>
                      <p
                        style={{
                          fontSize: "var(--text-sm)",
                          color: "var(--text-primary)",
                          margin: 0,
                        }}
                      >
                        {currentKb.name}
                      </p>
                    </div>
                    <div>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        描述
                      </span>
                      <p
                        style={{
                          fontSize: "var(--text-sm)",
                          color: "var(--text-secondary)",
                          margin: 0,
                        }}
                      >
                        {currentKb.description || "暂无描述"}
                      </p>
                    </div>
                    <div>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        文档数量
                      </span>
                      <p
                        style={{
                          fontSize: "var(--text-sm)",
                          color: "var(--text-secondary)",
                          margin: 0,
                        }}
                      >
                        {currentKb.documentCount ?? documents.length} 个文档
                      </p>
                    </div>
                    <div>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        创建时间
                      </span>
                      <p
                        style={{
                          fontSize: "var(--text-sm)",
                          color: "var(--text-secondary)",
                          margin: 0,
                        }}
                      >
                        {new Date(currentKb.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--text-tertiary)",
                      margin: 0,
                    }}
                  >
                    无法加载知识库信息
                  </p>
                );
              })()}
            </div>

            {/* Wiki Health Check Section */}
            <div
              style={{
                padding: "var(--space-4)",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-lg)",
              }}
            >
              <h4
                style={{
                  margin: "0 0 var(--space-3)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-semibold)",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                <Eye size={14} />
                健康检查
              </h4>
              <button
                onClick={handleHealthCheck}
                disabled={isHealthChecking}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-2) var(--space-3)",
                  backgroundColor: "var(--interactive)",
                  color: "#fff",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-medium)",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  cursor: isHealthChecking ? "not-allowed" : "pointer",
                  opacity: isHealthChecking ? 0.7 : 1,
                  transition:
                    "background-color var(--transition-fast), opacity var(--transition-fast)",
                  marginBottom: "var(--space-3)",
                }}
                onMouseEnter={(e) => {
                  if (!isHealthChecking)
                    e.currentTarget.style.backgroundColor =
                      "var(--interactive-hover)";
                }}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    "var(--interactive)")
                }
              >
                {isHealthChecking ? "检查中..." : "运行健康检查"}
              </button>

              {isHealthChecking && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    fontSize: "var(--text-sm)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      border: "2px solid var(--border-primary)",
                      borderTopColor: "var(--interactive)",
                      borderRadius: "var(--radius-full)",
                      animation: "spin 0.6s linear infinite",
                    }}
                  />
                  正在检查...
                </div>
              )}

              {healthResults.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                  }}
                >
                  {healthResults.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        padding: "var(--space-2) var(--space-3)",
                        backgroundColor: "var(--bg-secondary)",
                        borderRadius: "var(--radius-md)",
                        fontSize: "var(--text-sm)",
                      }}
                    >
                      {item.status === "ok" ? (
                        <CheckCircle
                          size={14}
                          style={{ color: "var(--success)", flexShrink: 0 }}
                        />
                      ) : item.status === "warning" ? (
                        <AlertCircle
                          size={14}
                          style={{ color: "var(--warning)", flexShrink: 0 }}
                        />
                      ) : (
                        <AlertCircle
                          size={14}
                          style={{ color: "var(--error)", flexShrink: 0 }}
                        />
                      )}
                      <span
                        style={{
                          fontWeight: "var(--font-medium)",
                          color: "var(--text-primary)",
                          flexShrink: 0,
                        }}
                      >
                        {item.name}
                      </span>
                      <span
                        style={{
                          color: "var(--text-tertiary)",
                          fontSize: "var(--text-xs)",
                        }}
                      >
                        {item.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Danger Zone */}
            <div
              style={{
                padding: "var(--space-4)",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--error)",
                borderRadius: "var(--radius-lg)",
              }}
            >
              <h4
                style={{
                  margin: "0 0 var(--space-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-semibold)",
                  color: "var(--error)",
                }}
              >
                危险操作
              </h4>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  margin: "0 0 var(--space-3)",
                }}
              >
                删除知识库将永久移除所有文档和数据，此操作不可撤销。
              </p>
              <button
                onClick={handleDeleteKb}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-2) var(--space-3)",
                  backgroundColor: "transparent",
                  color: "var(--error)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-medium)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--error)",
                  cursor: "pointer",
                  transition:
                    "background-color var(--transition-fast), color var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--error)";
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "var(--error)";
                }}
              >
                <Trash2 size={14} />
                删除知识库
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ================================================================== */}
      {/* Create KB Modal                                                     */}
      {/* ================================================================== */}
      {showCreateModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
            }}
            onClick={() => {
              if (!isCreating) {
                setShowCreateModal(false);
                setNewKbName("");
              }
            }}
          />

          {/* Modal */}
          <div
            style={{
              position: "relative",
              width: 400,
              maxWidth: "90vw",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-md)",
              padding: "var(--space-6)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-4)",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "var(--text-base)",
                  fontWeight: "var(--font-semibold)",
                  color: "var(--text-primary)",
                }}
              >
                新建知识库
              </h3>
              <button
                onClick={() => {
                  if (!isCreating) {
                    setShowCreateModal(false);
                    setNewKbName("");
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "var(--space-1)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  color: "var(--text-tertiary)",
                  backgroundColor: "transparent",
                  transition:
                    "color var(--transition-fast), background-color var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text-primary)";
                  e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-tertiary)";
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <X size={18} />
              </button>
            </div>

            <input
              type="text"
              value={newKbName}
              onChange={(e) => setNewKbName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isCreating) handleCreateKb();
              }}
              placeholder="输入知识库名称..."
              autoFocus
              style={{
                width: "100%",
                padding: "var(--space-2) var(--space-3)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-sm)",
                color: "var(--text-primary)",
                backgroundColor: "var(--bg-tertiary)",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: "var(--space-4)",
                transition: "border-color var(--transition-fast)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--interactive)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 2px var(--interactive-light)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border-primary)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-2)",
              }}
            >
              <button
                onClick={() => {
                  if (!isCreating) {
                    setShowCreateModal(false);
                    setNewKbName("");
                  }
                }}
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  transition:
                    "background-color var(--transition-fast), color var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                取消
              </button>
              <button
                onClick={handleCreateKb}
                disabled={!newKbName.trim() || isCreating}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-2) var(--space-4)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-medium)",
                  color: "#fff",
                  backgroundColor:
                    !newKbName.trim() || isCreating
                      ? "var(--text-tertiary)"
                      : "var(--interactive)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor:
                    !newKbName.trim() || isCreating
                      ? "not-allowed"
                      : "pointer",
                  opacity: isCreating ? 0.7 : 1,
                  transition:
                    "background-color var(--transition-fast), opacity var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  if (newKbName.trim() && !isCreating)
                    e.currentTarget.style.backgroundColor =
                      "var(--interactive-hover)";
                }}
                onMouseLeave={(e) => {
                  if (newKbName.trim() && !isCreating)
                    e.currentTarget.style.backgroundColor =
                      "var(--interactive)";
                }}
              >
                <Plus size={14} />
                {isCreating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
