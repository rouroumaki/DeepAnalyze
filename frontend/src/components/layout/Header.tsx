import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search, Sun, Moon, Settings,
  History, Puzzle, Zap, Clock,
} from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { useUIStore, type PanelContentType } from '../../store/ui';
import { useChatStore } from '../../store/chat';
import { api } from '../../api/client';
import type { SessionInfo, KnowledgeBase } from '../../types/index';
import { useKeyboard } from '../../hooks/useKeyboard';

// ---------------------------------------------------------------------------
// Search result types
// ---------------------------------------------------------------------------

type SearchItemType =
  | { kind: "session"; id: string; label: string }
  | { kind: "document"; id: string; label: string; kbId: string; kbName: string }
  | { kind: "wiki"; id: string; label: string; kbId: string; kbName: string };

// ---------------------------------------------------------------------------
// Header action buttons config
// ---------------------------------------------------------------------------

const headerActions: { id: PanelContentType; icon: typeof History; title: string }[] = [
  { id: 'sessions', icon: History, title: '会话历史' },
  { id: 'plugins', icon: Puzzle, title: '插件管理' },
  { id: 'skills', icon: Zap, title: '技能库' },
  { id: 'cron', icon: Clock, title: '定时任务' },
  { id: 'settings', icon: Settings, title: '设置' },
];

// ---------------------------------------------------------------------------
// Header component
// ---------------------------------------------------------------------------

export function Header() {
  const { isDark, toggleTheme } = useTheme();
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const rightPanelContentType = useUIStore((s) => s.rightPanelContentType);
  const setCurrentKbId = useUIStore((s) => s.setCurrentKbId);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchItemType[]>([]);
  const [searching, setSearching] = useState(false);
  const [healthStatus, setHealthStatus] = useState<"ok" | "error" | "loading">("loading");
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Health polling
  useEffect(() => {
    const check = () => {
      api.health().then((info) => {
        setHealthStatus(info.status === "ok" ? "ok" : "error");
      }).catch(() => setHealthStatus("error"));
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // Ctrl+K shortcut
  useKeyboard({ key: "k", ctrl: true }, () => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  });

  // Debounced search: sessions + knowledge API
  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const q = query.toLowerCase();

    try {
      const [sessions, kbs] = await Promise.all([
        api.listSessions().catch(() => [] as SessionInfo[]),
        api.listKnowledgeBases().catch(() => [] as KnowledgeBase[]),
      ]);

      const results: SearchItemType[] = [];

      // 1. Session matches
      for (const s of sessions) {
        if (s.title?.toLowerCase().includes(q)) {
          results.push({ kind: "session", id: s.id, label: s.title ?? "未命名" });
        }
      }

      // 2. For each KB, run document title match + wiki search in parallel
      const kbSearchPromises = kbs.map(async (kb) => {
        const kbResults: SearchItemType[] = [];

        // Search documents in this KB
        try {
          const docs = await api.listDocuments(kb.id);
          for (const doc of docs) {
            if (doc.filename.toLowerCase().includes(q)) {
              kbResults.push({
                kind: "document",
                id: doc.id,
                label: doc.filename,
                kbId: kb.id,
                kbName: kb.name,
              });
            }
          }
        } catch {
          // ignore per-KB errors
        }

        // Search wiki in this KB
        try {
          const wikiRes = await api.searchWiki(kb.id, query, undefined, 3);
          for (const wr of wikiRes.results) {
            kbResults.push({
              kind: "wiki",
              id: wr.docId,
              label: wr.metadata?.title as string || wr.level || wr.docId,
              kbId: kb.id,
              kbName: kb.name,
            });
          }
        } catch {
          // ignore per-KB errors
        }

        return kbResults;
      });

      const kbResults = await Promise.all(kbSearchPromises);
      for (const kbr of kbResults) {
        results.push(...kbr);
      }

      setSearchResults(results.slice(0, 12));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounce input by 300ms
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      doSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, doSearch]);

  // Click outside to close search dropdown
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  const healthColor = healthStatus === "ok" ? "var(--success)" : healthStatus === "error" ? "var(--error)" : "var(--warning)";

  const handleResultClick = (r: SearchItemType) => {
    if (r.kind === "session") {
      useChatStore.getState().selectSession(r.id);
      useUIStore.getState().setActiveView("chat");
    } else {
      // document or wiki -> switch to knowledge view
      setCurrentKbId(r.kbId);
      useUIStore.getState().setActiveView("knowledge");
    }
    setSearchOpen(false);
    setSearchQuery("");
  };

  // Group results by kind for display
  const sessionResults = searchResults.filter((r) => r.kind === "session");
  const documentResults = searchResults.filter((r) => r.kind === "document");
  const wikiResults = searchResults.filter((r) => r.kind === "wiki");
  const hasResults = searchResults.length > 0;

  // Action button style helper
  const actionBtnBase: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all var(--transition-fast)',
    position: 'relative' as const,
    flexShrink: 0,
  };

  const handleActionEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'var(--bg-tertiary)';
    e.currentTarget.style.color = 'var(--text-primary)';
  };
  const handleActionLeave = (e: React.MouseEvent<HTMLButtonElement>, isActive: boolean) => {
    e.currentTarget.style.background = isActive ? 'var(--bg-tertiary)' : 'transparent';
    e.currentTarget.style.color = isActive ? 'var(--interactive)' : 'var(--text-secondary)';
  };

  // Helper to render a group of results
  const renderGroup = (label: string, items: SearchItemType[]) => {
    if (items.length === 0) return null;
    return (
      <>
        <div style={{
          padding: "6px 12px",
          fontSize: 10,
          fontWeight: 600,
          color: "var(--text-tertiary)",
          textTransform: "uppercase" as const,
          letterSpacing: "0.05em",
          borderBottom: "1px solid var(--border-primary)",
        }}>
          {label}
        </div>
        {items.map((r) => {
          const kbLabel = r.kind !== "session" ? r.kbName : "";
          return (
            <button
              key={`${r.kind}-${r.id}-${r.kind !== "session" ? r.kbId : ""}`}
              onClick={() => handleResultClick(r)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "var(--space-2)",
                padding: "8px 12px", border: "none", background: "transparent",
                color: "var(--text-primary)", fontSize: "var(--text-xs)", cursor: "pointer", textAlign: "left",
                borderBottom: "1px solid var(--border-primary)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                fontSize: 9, padding: "1px 4px", borderRadius: "var(--radius-sm)",
                background: "var(--bg-tertiary)", color: "var(--text-tertiary)",
                whiteSpace: "nowrap" as const,
              }}>
                {r.kind === "session" ? "会话" : r.kind === "document" ? "文档" : "Wiki"}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {r.label}
              </span>
              {r.kind !== "session" && (
                <span style={{ fontSize: 9, color: "var(--text-tertiary)", marginLeft: "auto", flexShrink: 0 }}>
                  {kbLabel}
                </span>
              )}
            </button>
          );
        })}
      </>
    );
  };

  return (
    <header
      style={{
        height: 'var(--header-height)',
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-primary)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        gap: 'var(--space-3)',
        flexShrink: 0,
        zIndex: 'var(--z-sticky)',
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        {/* Health dot */}
        <div
          title={healthStatus === "ok" ? "模型正常" : healthStatus === "error" ? "模型异常" : "连接中..."}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: healthColor,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          D
        </div>
        <span
          style={{
            fontWeight: 600,
            fontSize: 'var(--text-lg)',
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
          }}
        >
          DeepAnalyze
        </span>
      </div>

      {/* Search Bar */}
      <div
        ref={searchRef}
        style={{
          flex: 1,
          maxWidth: 480,
          margin: '0 auto',
          position: 'relative',
        }}
      >
        <Search
          size={16}
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-tertiary)',
            pointerEvents: 'none',
          }}
        />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="搜索会话、文档、Wiki..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
          onFocus={(e) => {
            setSearchOpen(true);
            e.currentTarget.style.borderColor = 'var(--border-focus)';
            e.currentTarget.style.background = 'var(--bg-primary)';
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(51, 65, 85, 0.1)';
          }}
          style={{
            width: '100%',
            height: 34,
            padding: '0 var(--space-4) 0 36px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-full)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
            transition: 'all var(--transition-fast)',
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-primary)';
            e.currentTarget.style.background = 'var(--bg-tertiary)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        {searchOpen && (searchQuery.trim().length > 0) && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
            background: "var(--surface-primary)", border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
            zIndex: "var(--z-dropdown)", overflow: "hidden", maxHeight: 400, overflowY: "auto",
          }}>
            {searching ? (
              <div style={{ padding: "var(--space-3)", textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                搜索中...
              </div>
            ) : !hasResults ? (
              <div style={{ padding: "var(--space-3)", textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                未找到匹配
              </div>
            ) : (
              <>
                {renderGroup("会话", sessionResults)}
                {renderGroup("文档", documentResults)}
                {renderGroup("Wiki", wikiResults)}
              </>
            )}
          </div>
        )}
      </div>

      {/* Right Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        {/* Panel action buttons */}
        {headerActions.map(({ id, icon: Icon, title }) => {
          const isActive = rightPanelContentType === id;
          return (
            <button
              key={id}
              onClick={() => openRightPanel(id)}
              title={title}
              style={{
                ...actionBtnBase,
                background: isActive ? 'var(--bg-tertiary)' : 'transparent',
                color: isActive ? 'var(--interactive)' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => handleActionEnter(e)}
              onMouseLeave={(e) => handleActionLeave(e, isActive)}
            >
              <Icon size={18} />
            </button>
          );
        })}

        {/* Divider */}
        <div style={{
          width: 1,
          height: 20,
          background: 'var(--border-primary)',
          margin: '0 var(--space-1)',
          flexShrink: 0,
        }} />

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? '切换浅色主题' : '切换深色主题'}
          style={actionBtnBase}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
