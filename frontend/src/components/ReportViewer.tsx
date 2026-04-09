import type { ReportDetail } from "../api/client";

// ---------------------------------------------------------------------------
// Simple markdown renderer (no external library)
// ---------------------------------------------------------------------------

function renderMarkdown(content: string): React.ReactNode[] {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule: --- or *** or ___
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      elements.push(
        <hr
          key={key++}
          className="my-6 border-t border-gray-300"
        />,
      );
      i++;
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(
        <h3
          key={key++}
          className="text-lg font-semibold text-gray-800 mt-6 mb-2"
        >
          {renderInline(line.slice(4))}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2
          key={key++}
          className="text-xl font-bold text-gray-800 mt-8 mb-3"
        >
          {renderInline(line.slice(3))}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1
          key={key++}
          className="text-2xl font-bold text-gray-900 mt-8 mb-4"
        >
          {renderInline(line.slice(2))}
        </h1>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote
          key={key++}
          className="my-4 pl-4 border-l-4 border-blue-300 text-gray-600 italic bg-blue-50/30 py-2 pr-3 rounded-r"
        >
          {quoteLines.map((ql, qi) => (
            <p key={qi} className="mb-1 last:mb-0">
              {renderInline(ql)}
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*+]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-3 space-y-1.5 ml-6">
          {items.map((item, idx) => (
            <li
              key={idx}
              className="text-gray-700 text-sm leading-relaxed flex items-start"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 mr-2.5 shrink-0" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-3 space-y-1.5 ml-6 list-decimal">
          {items.map((item, idx) => (
            <li
              key={idx}
              className="text-gray-700 text-sm leading-relaxed pl-1"
            >
              {renderInline(item)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph: collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("> ") &&
      !/^[\s]*[-*+]\s/.test(lines[i]) &&
      !/^[\s]*\d+\.\s/.test(lines[i]) &&
      !/^(\s*[-*_]){3,}\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(
        <p key={key++} className="my-3 text-gray-700 text-sm leading-relaxed">
          {renderInline(paraLines.join(" "))}
        </p>,
      );
    }
  }

  return elements;
}

/** Render inline markdown: **bold**, *italic*, `code` */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Process bold first, then italic, then code
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Bold
      parts.push(
        <strong key={key++} className="font-semibold text-gray-900">
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      // Italic
      parts.push(
        <em key={key++} className="italic">
          {match[4]}
        </em>,
      );
    } else if (match[5]) {
      // Inline code
      parts.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded bg-gray-100 text-sm font-mono text-blue-700"
        >
          {match[6]}
        </code>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// ---------------------------------------------------------------------------
// ReportViewer
// ---------------------------------------------------------------------------

interface ReportViewerProps {
  report: ReportDetail;
  onBack: () => void;
}

export function ReportViewer({ report, onBack }: ReportViewerProps) {
  const formattedDate = new Date(report.updatedAt || report.createdAt).toLocaleString(
    "zh-CN",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-gray-200 bg-white">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 mb-3 cursor-pointer transition-colors"
        >
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
          返回报告列表
        </button>
        <h2 className="text-xl font-bold text-gray-900">{report.title}</h2>
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {formattedDate}
          </span>
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
            {report.tokenCount} tokens
          </span>
          <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">
            ID: {report.id.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto">
          {renderMarkdown(report.content)}
        </div>
      </div>
    </div>
  );
}
