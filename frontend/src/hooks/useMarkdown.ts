import { useMemo } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

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

// Configure DOMPurify to allow code highlighting classes
const purifyConfig: DOMPurify.Config = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "strong", "em", "del", "s",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "span", "div",
    "input", // for task lists
  ],
  ALLOWED_ATTR: [
    "href", "target", "rel",
    "class", "id",
    "checked", "disabled", "type",
    "alt", "src", "title",
  ],
  ADD_TAGS: ["code"],
};

export function useMarkdown(content: string): string {
  return useMemo(() => {
    if (!content) return "";
    try {
      const raw = marked(content, { renderer }) as string;
      return DOMPurify.sanitize(raw, purifyConfig);
    } catch {
      return DOMPurify.sanitize(content, purifyConfig);
    }
  }, [content]);
}
