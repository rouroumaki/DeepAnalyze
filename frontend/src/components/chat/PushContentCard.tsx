// =============================================================================
// DeepAnalyze - PushContentCard
// Renders structured content pushed by the Agent via push_content tool
// =============================================================================

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Copy, Table, FileText, Code, File } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { PushedContent } from "../../types/index";

const TYPE_ICONS: Record<string, typeof Table> = {
  table: Table,
  text: FileText,
  code: Code,
  file: File,
  markdown: FileText,
};

const TYPE_COLORS: Record<string, string> = {
  table: "var(--interactive)",
  text: "var(--text-secondary)",
  code: "var(--success)",
  file: "var(--warning)",
  markdown: "var(--text-secondary)",
};

// Markdown render config (same as useMarkdown)
marked.setOptions({ breaks: true, gfm: true });

const purifyConfig = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "strong", "em", "del", "s",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "span", "div",
    "input",
  ],
  ALLOWED_ATTR: [
    "href", "target", "rel",
    "class", "id",
    "checked", "disabled", "type",
    "alt", "src", "title",
  ],
  ADD_TAGS: ["code"],
};

export function PushContentCard({ item }: { item: PushedContent }) {
  // Markdown type is always expanded and rendered inline
  const isMarkdown = item.type === "markdown";
  const [expanded, setExpanded] = useState(isMarkdown || item.data.length < 2000);
  const [copied, setCopied] = useState(false);

  const Icon = TYPE_ICONS[item.type] || FileText;
  const color = TYPE_COLORS[item.type] || "var(--text-secondary)";

  // Parse markdown content into sanitized HTML
  const markdownHtml = useMemo(() => {
    if (!isMarkdown) return "";
    try {
      const raw = marked(item.data) as string;
      return DOMPurify.sanitize(raw, purifyConfig);
    } catch {
      return DOMPurify.sanitize(item.data, purifyConfig);
    }
  }, [isMarkdown, item.data]);

  const handleCopy = () => {
    navigator.clipboard.writeText(item.data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderContent = () => {
    // Markdown: render as rich HTML inline, no collapse
    if (isMarkdown) {
      return (
        <div
          className="markdown-content"
          style={{
            padding: "var(--space-3) var(--space-4)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-relaxed)",
          }}
          dangerouslySetInnerHTML={{ __html: markdownHtml }}
        />
      );
    }

    if (item.type === "table") {
      try {
        const lines = item.data.split("\n").filter(Boolean);
        if (lines.length > 0) {
          const headers = lines[0].split(item.data.includes("\t") ? "\t" : ",");
          const rows = lines.slice(1, expanded ? undefined : 20).map((line) =>
            line.split(item.data.includes("\t") ? "\t" : ",")
          );

          return (
            <div style={{ overflowX: "auto" }}>
              <table style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "var(--text-xs)",
              }}>
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} style={{
                        padding: "4px 8px",
                        borderBottom: "2px solid var(--border-primary)",
                        textAlign: "left",
                        fontWeight: "var(--font-semibold)",
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                      }}>
                        {h.trim()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri}>
                      {headers.map((_, ci) => (
                        <td key={ci} style={{
                          padding: "3px 8px",
                          borderBottom: "1px solid var(--border-secondary)",
                          color: "var(--text-secondary)",
                          whiteSpace: "nowrap",
                          maxWidth: 300,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}>
                          {(row[ci] || "").trim()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!expanded && lines.length > 20 && (
                <div style={{ padding: "var(--space-2)", textAlign: "center" }}>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                    显示前 20 行（共 {lines.length - 1} 行）
                  </span>
                </div>
              )}
            </div>
          );
        }
      } catch {
        // Fall through to code display
      }
    }

    if (item.type === "code") {
      return (
        <pre style={{
          margin: 0,
          padding: "var(--space-3)",
          backgroundColor: "var(--bg-tertiary)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--text-xs)",
          lineHeight: 1.5,
          overflowX: "auto",
          maxHeight: expanded ? undefined : 300,
          overflow: expanded ? undefined : "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          <code>
            {expanded ? item.data : item.data.slice(0, 5000)}
            {!expanded && item.data.length > 5000 && "\n... (点击展开查看全部)"}
          </code>
        </pre>
      );
    }

    // text / file
    return (
      <div style={{
        padding: "var(--space-3)",
        fontSize: "var(--text-sm)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: expanded ? undefined : 300,
        overflow: expanded ? undefined : "auto",
        lineHeight: "var(--leading-relaxed)",
      }}>
        {expanded ? item.data : item.data.slice(0, 5000)}
        {!expanded && item.data.length > 5000 && "... (点击展开查看全部)"}
      </div>
    );
  };

  // Markdown type: render as a result card with clean border, no collapse toggle
  if (isMarkdown) {
    return (
      <div style={{
        border: "1px solid var(--border-primary)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        marginTop: 4,
        background: "var(--surface-primary)",
      }}>
        {/* Compact header with title only */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-1) var(--space-3)",
          backgroundColor: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-primary)",
        }}>
          <Icon size={13} style={{ color, flexShrink: 0 }} />
          <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)", color: "var(--text-secondary)", flex: 1 }}>
            {item.title}
          </span>
          <button
            onClick={handleCopy}
            title="复制内容"
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: 2,
              color: copied ? "var(--success)" : "var(--text-tertiary)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <Copy size={12} />
          </button>
        </div>
        {/* Markdown content always visible */}
        {renderContent()}
      </div>
    );
  }

  // Non-markdown types: collapsible card
  return (
    <div style={{
      border: "1px solid var(--border-primary)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      marginTop: 4,
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          backgroundColor: "var(--bg-secondary)",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Icon size={14} style={{ color, flexShrink: 0 }} />
        <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", color: "var(--text-primary)", flex: 1 }}>
          {item.title}
        </span>
        {item.format && (
          <span style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            padding: "1px 6px",
            backgroundColor: "var(--bg-tertiary)",
            borderRadius: "var(--radius-sm)",
          }}>
            {item.format}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          title="复制内容"
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            padding: 2,
            color: copied ? "var(--success)" : "var(--text-tertiary)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Copy size={12} />
        </button>
      </div>

      {/* Content */}
      {expanded && renderContent()}
    </div>
  );
}
