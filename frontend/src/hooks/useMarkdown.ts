// =============================================================================
// DeepAnalyze - Markdown Rendering Hook
// =============================================================================

import { useMemo } from "react";
import { marked } from "marked";
import hljs from "highlight.js";

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

const renderer = new marked.Renderer();

// Code blocks with syntax highlighting
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = lang && hljs.getLanguage(lang) ? lang : "";
  let highlighted: string;
  try {
    highlighted = language
      ? hljs.highlight(text, { language }).value
      : hljs.highlightAuto(text).value;
  } catch {
    highlighted = text;
  }
  return `<pre><code class="hljs${language ? ` language-${language}` : ""}">${highlighted}</code></pre>`;
};

// Custom heading renderer
renderer.heading = function ({ text, depth }: { text: string; depth: number }) {
  return `<h${depth}>${text}</h${depth}>`;
};

export function useMarkdown(content: string): string {
  return useMemo(() => {
    if (!content) return "";
    try {
      return marked(content, { renderer }) as string;
    } catch {
      return content;
    }
  }, [content]);
}
