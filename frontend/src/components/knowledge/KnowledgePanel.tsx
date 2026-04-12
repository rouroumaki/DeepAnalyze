// =============================================================================
// DeepAnalyze - KnowledgePanel Component
// Knowledge base browser with search, document management, and wiki browsing
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import { useFileUpload } from "../../hooks/useFileUpload";
import type { KnowledgeBase, DocumentInfo } from "../../types/index";
import { WikiBrowser } from "./WikiBrowser";
import { EntityPage } from "./EntityPage";
import { DropZone } from "../ui/DropZone";
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
} from "lucide-react";

interface KnowledgePanelProps {
  kbId: string;
  onKbIdChange: (id: string) => void;
}

type TabId = "documents" | "wiki" | "search" | "settings";

type SearchMode = "semantic" | "exact" | "hybrid";

interface HealthCheckResult {
  name: string;
  status: "ok" | "error" | "warning";
  message: string;
}

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
    icon: <Clock size={14} />,
  },
  compiling: {
    label: "编译中",
    color: "var(--warning)",
    icon: <Clock size={14} />,
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
  const fileUpload = useFileUpload();

  // --- Data state ---
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{
      docId: string;
      level: string;
      content: string;
      score: number;
    }>
  >([]);

  // --- UI state ---
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("documents");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [navigatingEntity, setNavigatingEntity] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>("semantic");
  const [healthResults, setHealthResults] = useState<HealthCheckResult[]>([]);
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingKbs, setIsLoadingKbs] = useState(true);

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

  // --- Handlers ---
  const handleSearch = async () => {
    if (!kbId || !searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const result = await api.searchWiki(kbId, searchQuery, searchMode);
      setSearchResults(result.results);
    } catch {
      toastError("搜索失败");
    } finally {
      setIsSearching(false);
    }
  };


  const refreshDocuments = useCallback(async () => {
    if (!kbId) return;
    try {
      const docs = await api.listDocuments(kbId);
      setDocuments(docs);
    } catch {
      // silently refresh
    }
  }, [kbId]);

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
    { id: "search", label: "搜索", icon: <Search size={14} /> },
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
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                {documents.length > 0 ? `${documents.length} 个文档` : ""}
              </span>
              <button
                onClick={async () => {
                  if (!kbId) { toastError("请先选择知识库"); return; }
                  const files = await fileUpload.selectFiles(".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx,.html,.htm", true);
                  if (files && files.length > 0) {
                    const results = await fileUpload.uploadToKb(kbId);
                    if (results.length > 0) {
                      success(`成功上传 ${results.length} 个文件`);
                      refreshDocuments();
                    }
                  }
                }}
                disabled={fileUpload.hasPending}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-2) var(--space-3)",
                  backgroundColor: fileUpload.hasPending ? "var(--text-tertiary)" : "var(--interactive)",
                  color: "#fff",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-medium)",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  cursor: fileUpload.hasPending ? "not-allowed" : "pointer",
                  opacity: fileUpload.hasPending ? 0.6 : 1,
                  transition: "background-color var(--transition-fast), opacity var(--transition-fast)",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!fileUpload.hasPending)
                    e.currentTarget.style.backgroundColor = "var(--interactive-hover)";
                }}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--interactive)")
                }
              >
                {fileUpload.hasPending ? (
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <Upload size={14} />
                )}
                {fileUpload.hasPending ? "上传中..." : "上传文档"}
              </button>
            </div>

            {/* Upload progress indicators */}
            {fileUpload.uploads.filter((u) => u.status === "uploading" || u.status === "error").map((upload) => (
              <div
                key={upload.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  padding: "var(--space-3) var(--space-4)",
                  backgroundColor: upload.status === "error" ? "var(--error-light)" : "var(--bg-tertiary)",
                  border: upload.status === "error" ? "1px solid var(--error)" : "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-lg)",
                }}
              >
                {upload.status === "uploading" ? (
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite", color: "var(--interactive)" }} />
                ) : (
                  <AlertCircle size={14} style={{ color: "var(--error)" }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "var(--text-sm)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {upload.file.name}
                  </p>
                  {upload.status === "uploading" && (
                    <div style={{ marginTop: "var(--space-1)", height: 4, backgroundColor: "var(--border-primary)", borderRadius: 2 }}>
                      <div style={{ width: `${upload.progress}%`, height: "100%", backgroundColor: "var(--interactive)", borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                  )}
                  {upload.status === "error" && (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--error)", margin: "var(--space-1) 0 0" }}>
                      上传失败
                    </p>
                  )}
                </div>
              </div>
            ))}

            {documents.length === 0 && fileUpload.uploads.length === 0 ? (
              /* Empty state with DropZone */
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", alignItems: "center" }}>
                <DropZone
                  onFiles={async (files) => {
                    if (!kbId) { toastError("请先选择知识库"); return; }
                    fileUpload.addFiles(files);
                    const results = await fileUpload.uploadToKb(kbId);
                    if (results.length > 0) {
                      success(`成功上传 ${results.length} 个文件`);
                      refreshDocuments();
                    }
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
                const statusCfg = STATUS_CONFIG[doc.status] ?? {
                  label: doc.status,
                  color: "var(--text-tertiary)",
                  icon: <FileText size={14} />,
                };
                return (
                  <div
                    key={doc.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-3)",
                      padding: "var(--space-3) var(--space-4)",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: "var(--radius-lg)",
                    }}
                  >
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
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        color: statusCfg.color,
                        fontSize: "var(--text-xs)",
                        fontWeight: "var(--font-medium)",
                        flexShrink: 0,
                      }}
                    >
                      {statusCfg.icon}
                      {statusCfg.label}
                    </div>
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
        ) : activeTab === "search" ? (
          /* Search Tab */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            {/* Search mode selector */}
            <div
              style={{
                display: "flex",
                gap: "var(--space-1)",
                padding: "2px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-primary)",
              }}
            >
              {([
                { value: "semantic" as SearchMode, label: "语义" },
                { value: "exact" as SearchMode, label: "精确" },
                { value: "hybrid" as SearchMode, label: "混合" },
              ]).map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setSearchMode(mode.value)}
                  style={{
                    flex: 1,
                    padding: "var(--space-1) var(--space-2)",
                    fontSize: "var(--text-xs)",
                    fontWeight: "var(--font-medium)",
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                    backgroundColor:
                      searchMode === mode.value ? "var(--interactive)" : "transparent",
                    color:
                      searchMode === mode.value ? "#fff" : "var(--text-tertiary)",
                  }}
                  onMouseEnter={(e) => {
                    if (searchMode !== mode.value) {
                      e.currentTarget.style.color = "var(--text-secondary)";
                      e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (searchMode !== mode.value) {
                      e.currentTarget.style.color = "var(--text-tertiary)";
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {/* Search input row */}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <div
                style={{
                  flex: 1,
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Search
                  size={16}
                  style={{
                    position: "absolute",
                    left: "var(--space-3)",
                    color: "var(--text-tertiary)",
                    pointerEvents: "none",
                  }}
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="搜索知识库内容..."
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-4) var(--space-2) var(--space-10)",
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "var(--radius-lg)",
                    fontSize: "var(--text-sm)",
                    color: "var(--text-primary)",
                    outline: "none",
                    transition: "border-color var(--transition-fast)",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--interactive)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 2px var(--interactive-light)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--border-primary)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={isSearching}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-2) var(--space-4)",
                  backgroundColor: "var(--interactive)",
                  color: "#fff",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-medium)",
                  borderRadius: "var(--radius-lg)",
                  border: "none",
                  cursor: isSearching ? "not-allowed" : "pointer",
                  opacity: isSearching ? 0.5 : 1,
                  transition:
                    "background-color var(--transition-fast), opacity var(--transition-fast)",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!isSearching)
                    e.currentTarget.style.backgroundColor =
                      "var(--interactive-hover)";
                }}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    "var(--interactive)")
                }
              >
                <Search size={14} />
                {isSearching ? "搜索中..." : "搜索"}
              </button>
            </div>

            {/* Search results */}
            {searchResults.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                }}
              >
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-tertiary)",
                    margin: 0,
                  }}
                >
                  找到 {searchResults.length} 条结果
                </p>
                {searchResults.map((result, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "var(--space-3) var(--space-4)",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: "var(--radius-lg)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        marginBottom: "var(--space-1)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          fontWeight: "var(--font-semibold)",
                          padding: "2px var(--space-1)",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--interactive-light)",
                          color: "var(--interactive)",
                        }}
                      >
                        {result.level}
                      </span>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        Score: {result.score.toFixed(3)}
                      </span>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        Doc: {result.docId}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "var(--text-sm)",
                        color: "var(--text-secondary)",
                        margin: 0,
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {result.content}
                    </p>
                  </div>
                ))}
              </div>
            ) : searchQuery && !isSearching ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "var(--space-8) 0",
                  color: "var(--text-tertiary)",
                  fontSize: "var(--text-sm)",
                }}
              >
                无搜索结果
              </div>
            ) : null}
          </div>
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
