// =============================================================================
// DeepAnalyze - KnowledgePanel Component
// Knowledge base browser with search, document management, and wiki browsing
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import type { KnowledgeBase, DocumentInfo } from "../../types/index";
import { useChatStore } from "../../store/chat";

interface KnowledgePanelProps {
  kbId: string;
  onKbIdChange: (id: string) => void;
}

export function KnowledgePanel({ kbId, onKbIdChange }: KnowledgePanelProps) {
  const { success, error } = useToast();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ docId: string; level: string; content: string; score: number }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [activeSection, setActiveSection] = useState<"browse" | "search" | "upload">("browse");

  // Load knowledge bases
  const loadKnowledgeBases = useCallback(async () => {
    try {
      const kbs = await api.listKnowledgeBases();
      setKnowledgeBases(kbs);
      if (kbs.length > 0 && !kbId) {
        onKbIdChange(kbs[0].id);
      }
    } catch {
      // Endpoint may not exist yet
    }
  }, [kbId, onKbIdChange]);

  useEffect(() => { loadKnowledgeBases(); }, [loadKnowledgeBases]);

  // Load documents when kb changes
  useEffect(() => {
    if (!kbId) { setDocuments([]); return; }
    api.listDocuments(kbId).then(setDocuments).catch(() => setDocuments([]));
  }, [kbId]);

  const handleSearch = async () => {
    if (!kbId || !searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const result = await api.searchWiki(kbId, searchQuery);
      setSearchResults(result.results);
    } catch {
      error("搜索失败");
    } finally {
      setIsSearching(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!kbId) { error("请先选择知识库"); return; }
    setIsUploading(true);
    try {
      await api.uploadDocument(kbId, file);
      success(`文件 ${file.name} 上传成功`);
      // Refresh documents
      const docs = await api.listDocuments(kbId);
      setDocuments(docs);
    } catch {
      error("上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  const statusColors: Record<string, string> = {
    uploaded: "text-da-text-muted",
    parsing: "text-da-amber",
    compiling: "text-da-amber",
    ready: "text-da-green",
    error: "text-da-red",
  };

  const statusLabels: Record<string, string> = {
    uploaded: "已上传",
    parsing: "解析中",
    compiling: "编译中",
    ready: "就绪",
    error: "错误",
  };

  return (
    <div className="h-full flex flex-col bg-da-bg">
      {/* KB Selector */}
      <div className="shrink-0 border-b border-da-border px-4 py-3 bg-da-bg-secondary">
        <div className="flex items-center gap-3">
          <select
            value={kbId}
            onChange={(e) => onKbIdChange(e.target.value)}
            className="flex-1 px-3 py-2 border border-da-border rounded-lg text-sm bg-da-surface text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent/30"
          >
            <option value="">-- 选择知识库 --</option>
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name} ({kb.documentCount} 文档)</option>
            ))}
          </select>
          <button
            onClick={() => {
              const name = prompt("知识库名称:");
              if (name) {
                api.createKnowledgeBase(name).then((kb) => {
                  success("知识库已创建");
                  loadKnowledgeBases();
                  onKbIdChange(kb.id);
                }).catch(() => error("创建失败"));
              }
            }}
            className="px-3 py-2 bg-da-accent hover:bg-da-accent-hover text-white text-sm rounded-lg cursor-pointer transition-colors"
          >
            新建
          </button>
        </div>

        {/* Section tabs */}
        <div className="flex items-center gap-1 mt-3">
          {[
            { id: "browse" as const, label: "文档" },
            { id: "search" as const, label: "检索" },
            { id: "upload" as const, label: "上传" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                activeSection === tab.id
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
      <div className="flex-1 overflow-y-auto p-4">
        {!kbId ? (
          <div className="text-center py-12 text-da-text-muted">
            <p>请选择或创建一个知识库</p>
          </div>
        ) : activeSection === "browse" ? (
          /* Document list */
          <div className="space-y-2">
            {documents.length === 0 ? (
              <div className="text-center py-12 text-da-text-muted">
                <p>暂无文档</p>
                <p className="text-xs mt-1">点击"上传"标签添加文档</p>
              </div>
            ) : (
              documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-3 bg-da-surface border border-da-border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-da-text truncate">{doc.filename}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-da-text-muted">{doc.fileType}</span>
                      <span className="text-[10px] text-da-text-muted">
                        {(doc.fileSize / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs font-medium ${statusColors[doc.status] ?? "text-da-text-muted"}`}>
                    {statusLabels[doc.status] ?? doc.status}
                  </span>
                  <button
                    onClick={() => api.deleteDocument(kbId, doc.id).then(() => {
                      success("文档已删除");
                      api.listDocuments(kbId).then(setDocuments);
                    }).catch(() => error("删除失败"))}
                    className="text-da-text-muted hover:text-da-red cursor-pointer text-xs"
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        ) : activeSection === "search" ? (
          /* Wiki Search */
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="搜索知识库内容..."
                className="flex-1 px-4 py-2.5 bg-da-surface border border-da-border rounded-lg text-sm text-da-text placeholder-da-text-muted focus:outline-none focus:ring-2 focus:ring-da-accent/30"
              />
              <button
                onClick={handleSearch}
                disabled={isSearching}
                className="px-4 py-2.5 bg-da-accent hover:bg-da-accent-hover text-white text-sm rounded-lg cursor-pointer disabled:opacity-50 transition-colors"
              >
                {isSearching ? "搜索中..." : "搜索"}
              </button>
            </div>

            {searchResults.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-da-text-muted">找到 {searchResults.length} 条结果</p>
                {searchResults.map((result, i) => (
                  <div key={i} className="px-4 py-3 bg-da-surface border border-da-border rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-da-accent/10 text-da-accent">
                        {result.level}
                      </span>
                      <span className="text-xs text-da-text-muted">Score: {result.score.toFixed(3)}</span>
                      <span className="text-xs text-da-text-muted">Doc: {result.docId}</span>
                    </div>
                    <p className="text-sm text-da-text-secondary line-clamp-3">{result.content}</p>
                  </div>
                ))}
              </div>
            ) : searchQuery && !isSearching ? (
              <div className="text-center py-8 text-da-text-muted text-sm">无搜索结果</div>
            ) : null}
          </div>
        ) : (
          /* Upload */
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-da-border rounded-xl p-12 text-center hover:border-da-accent/40 transition-colors"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files);
                files.forEach((f) => handleUpload(f));
              }}
            >
              <svg className="w-12 h-12 mx-auto mb-3 text-da-text-muted opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-da-text-secondary text-sm mb-2">拖拽文件到此处上传</p>
              <p className="text-da-text-muted text-xs mb-4">支持 PDF, Word, Excel, PPT, Markdown 等格式</p>
              <label className="inline-block px-4 py-2 bg-da-accent hover:bg-da-accent-hover text-white text-sm rounded-lg cursor-pointer transition-colors">
                选择文件
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.csv"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    files.forEach((f) => handleUpload(f));
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {isUploading && (
              <div className="text-center text-sm text-da-text-muted">
                <svg className="w-5 h-5 animate-spin mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                上传中...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
