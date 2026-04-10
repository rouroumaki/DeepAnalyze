import { useState, useEffect, useRef } from "react";
import { Search, Sun, Moon, Settings, Activity } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { useUIStore } from '../../store/ui';
import { useChatStore } from '../../store/chat';
import { api } from '../../api/client';
import type { SessionInfo, KnowledgeBase } from '../../types/index';
import { useKeyboard } from '../../hooks/useKeyboard';

export function Header() {
  const { isDark, toggleTheme } = useTheme();
  const setActiveView = useUIStore((s) => s.setActiveView);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<{ type: "session" | "kb"; id: string; label: string }[]>([]);
  const [healthStatus, setHealthStatus] = useState<"ok" | "error" | "loading">("loading");
  const searchRef = useRef<HTMLDivElement>(null);

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
  });

  // Search sessions + KBs
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.toLowerCase();
    Promise.all([
      api.listSessions().catch(() => [] as SessionInfo[]),
      api.listKnowledgeBases().catch(() => [] as KnowledgeBase[]),
    ]).then(([sessions, kbs]) => {
      const results: typeof searchResults = [];
      for (const s of sessions) {
        if (s.title?.toLowerCase().includes(q)) results.push({ type: "session", id: s.id, label: s.title });
      }
      for (const kb of kbs) {
        if (kb.name.toLowerCase().includes(q)) results.push({ type: "kb", id: kb.id, label: kb.name });
      }
      setSearchResults(results.slice(0, 8));
    });
  }, [searchQuery]);

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
  const healthLabel = healthStatus === "ok" ? "模型正常" : healthStatus === "error" ? "模型异常" : "连接中...";

  return (
    <header
      style={{
        height: 'var(--header-height)',
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-primary)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        gap: 'var(--space-4)',
        flexShrink: 0,
        zIndex: 'var(--z-sticky)',
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
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
        {searchOpen && searchResults.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
            background: "var(--surface-primary)", border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
            zIndex: "var(--z-dropdown)", overflow: "hidden", maxHeight: 300, overflowY: "auto",
          }}>
            {searchResults.map((r) => (
              <button key={`${r.type}-${r.id}`}
                onClick={() => {
                  if (r.type === "session") {
                    useChatStore.getState().selectSession(r.id);
                    useUIStore.getState().setActiveView("chat");
                  } else {
                    useUIStore.getState().setActiveView("knowledge");
                  }
                  setSearchOpen(false);
                  setSearchQuery("");
                }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "var(--space-2)",
                  padding: "8px 12px", border: "none", background: "transparent",
                  color: "var(--text-primary)", fontSize: "var(--text-xs)", cursor: "pointer", textAlign: "left",
                  borderBottom: "1px solid var(--border-primary)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: "var(--radius-sm)", background: "var(--bg-tertiary)", color: "var(--text-tertiary)" }}>
                  {r.type === "session" ? "会话" : "知识库"}
                </span>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        {/* Model Status */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--bg-tertiary)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
          }}
        >
          <Activity size={12} style={{ color: healthColor }} />
          <span>{healthLabel}</span>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? '切换浅色主题' : '切换深色主题'}
          style={{
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
          }}
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

        {/* Settings */}
        <button
          onClick={() => setActiveView('settings')}
          title="系统设置"
          style={{
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
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
