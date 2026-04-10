import { useState, useEffect, useRef } from "react";
import { ChevronDown, Globe, Database, FileText } from "lucide-react";
import { api } from "../../api/client";
import type { KnowledgeBase } from "../../types/index";

interface ScopeSelectorProps {
  value: string;
  onChange: (scope: string) => void;
}

export function ScopeSelector({ value, onChange }: ScopeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listKnowledgeBases().then(setKbs).catch(() => {});
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentLabel = value === ""
    ? "全部范围"
    : value.startsWith("kb:")
      ? kbs.find((k) => k.id === value.slice(3))?.name ?? "知识库"
      : "指定文档";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "4px 8px",
          border: "1px solid var(--border-primary)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface-primary)",
          color: "var(--text-secondary)",
          fontSize: "var(--text-xs)",
          cursor: "pointer",
          transition: "all var(--transition-fast)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--interactive)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
      >
        {value === "" ? <Globe size={12} /> : value.startsWith("kb:") ? <Database size={12} /> : <FileText size={12} />}
        {currentLabel}
        <ChevronDown size={10} style={{ transition: "transform var(--transition-fast)", transform: open ? "rotate(180deg)" : "rotate(0)" }} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            minWidth: 180,
            background: "var(--surface-primary)",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            zIndex: "var(--z-dropdown)",
            overflow: "hidden",
          }}
        >
          <button
            onClick={() => { onChange(""); setOpen(false); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: "var(--space-2)",
              padding: "8px 12px", border: "none",
              background: value === "" ? "var(--bg-hover)" : "transparent",
              color: "var(--text-primary)", fontSize: "var(--text-xs)", cursor: "pointer", textAlign: "left",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = value === "" ? "var(--bg-hover)" : "transparent"; }}
          >
            <Globe size={14} />
            全部范围
          </button>
          {kbs.map((kb) => (
            <button
              key={kb.id}
              onClick={() => { onChange(`kb:${kb.id}`); setOpen(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "var(--space-2)",
                padding: "8px 12px", border: "none", borderTop: "1px solid var(--border-primary)",
                background: value === `kb:${kb.id}` ? "var(--bg-hover)" : "transparent",
                color: "var(--text-primary)", fontSize: "var(--text-xs)", cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = value === `kb:${kb.id}` ? "var(--bg-hover)" : "transparent"; }}
            >
              <Database size={14} />
              {kb.name}
              <span style={{ color: "var(--text-tertiary)", marginLeft: "auto" }}>{kb.documentCount} 文档</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
