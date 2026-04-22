// =============================================================================
// DeepAnalyze - Tool Setup
// =============================================================================
// Creates a fully configured ToolRegistry with all custom DeepAnalyze tools
// (kb_search, wiki_browse, expand, report_generate, timeline_build, graph_build)
// registered and wired to their backends.
// =============================================================================

import { ToolRegistry } from "./tool-registry.js";
import { Retriever } from "../../wiki/retriever.js";
import { Linker } from "../../wiki/linker.js";
import { Expander } from "../../wiki/expander.js";
import type { EmbeddingManager } from "../../models/embedding.js";
import type { Indexer } from "../../wiki/indexer.js";
import type { ModelRouter } from "../../models/router.js";
import { getRepos } from "../../store/repos/index.js";
import { createReportTool } from "../../tools/ReportTool/index.js";
import { createTimelineTool } from "../../tools/TimelineTool/index.js";
import { createGraphTool } from "../../tools/GraphTool/index.js";

// ---------------------------------------------------------------------------
// Dependencies for tool registration
// ---------------------------------------------------------------------------

/** All external dependencies needed to set up the tool registry. */
export interface ToolSetupDeps {
  retriever: Retriever;
  linker: Linker;
  expander: Expander;
  embeddingManager: EmbeddingManager;
  indexer: Indexer;
  modelRouter: ModelRouter;
  /** Root data directory for wiki content files. */
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

/**
 * Create a ToolRegistry with all DeepAnalyze tools registered and wired to
 * their real backend implementations.
 *
 * The returned registry includes:
 * - think (built-in, always present)
 * - finish (built-in, always present)
 * - kb_search (Retriever-backed semantic + BM25 + link search)
 * - wiki_browse (page listing, content reading, link traversal)
 * - expand (layer-by-layer content expansion L0 -> L1 -> L2)
 * - report_generate (structured analysis report generation)
 * - timeline_build (chronological event extraction from wiki pages)
 * - graph_build (entity relationship graph from wiki pages and links)
 */
export async function createConfiguredToolRegistry(deps: ToolSetupDeps): Promise<ToolRegistry> {
  const registry = new ToolRegistry();

  // -----------------------------------------------------------------------
  // kb_search tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "kb_search",
    description:
      "使用语义和关键词匹配搜索知识库。返回带摘录的排序结果。" +
      "结合向量相似度、BM25 全文搜索和链接遍历，实现全面检索。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索查询文本",
        },
        kbIds: {
          type: "array",
          items: { type: "string" },
          description:
            "要搜索的知识库 ID 列表。省略则搜索所有知识库。",
        },
        topK: {
          type: "number",
          description: "返回结果的最大数量（默认：10）",
        },
        linkedFrom: {
          type: "string",
          description:
            "链接遍历的起始页面 ID（添加关联结果）。",
        },
        pageTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "按页面类型过滤结果（abstract, overview, fulltext, structure_md, structure_dt, entity, concept, report）。",
        },
        minScore: {
          type: "number",
          description: "最低相关性分数阈值（0-1 范围）。",
        },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>) {
      const query = input.query as string;
      const kbIds = (input.kbIds as string[]) || [];

      if (kbIds.length === 0) {
        // When no KB IDs are specified, search across all knowledge bases.
        // Retrieve all KB IDs from the database.
        const repos = await getRepos();
        const allKbs = await repos.knowledgeBase.list();
        const allKbIds = allKbs.map((kb) => kb.id);

        if (allKbIds.length === 0) {
          return {
            results: [],
            total: 0,
            message: "No knowledge bases found.",
          };
        }

        return deps.retriever.search(query, {
          kbIds: allKbIds,
          topK: (input.topK as number) || 10,
          linkedFrom: input.linkedFrom as string | undefined,
          pageTypes: input.pageTypes as string[] | undefined,
          minScore: input.minScore as number | undefined,
        });
      }

      return deps.retriever.search(query, {
        kbIds,
        topK: (input.topK as number) || 10,
        linkedFrom: input.linkedFrom as string | undefined,
        pageTypes: input.pageTypes as string[] | undefined,
        minScore: input.minScore as number | undefined,
      });
    },
  });

  // -----------------------------------------------------------------------
  // wiki_browse tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "wiki_browse",
    description:
      "浏览 Wiki 页面并跟踪相关文档之间的链接。" +
      "可通过 ID 查看特定页面、列出知识库中的页面，" +
      "或按类型浏览页面。",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "要查看的特定页面 ID。返回页面内容和元数据。",
        },
        kbId: {
          type: "string",
          description:
            "知识库 ID。返回该知识库中所有页面的列表。",
        },
        pageType: {
          type: "string",
          description:
            "列出知识库页面时按类型过滤（abstract, overview, fulltext, structure_md, structure_dt, entity, concept, report）。",
        },
      },
    },
    async execute(input: Record<string, unknown>) {
      // Mode 1: View a specific page by ID
      if (input.pageId) {
        const pageId = input.pageId as string;
        const repos = await getRepos();
        const page = await repos.wikiPage.getById(pageId);

        if (!page) {
          return { error: `Page not found: ${pageId}` };
        }

        const content = page.content || "[Content could not be read]";

        return {
          id: page.id,
          kbId: page.kb_id,
          docId: page.doc_id,
          pageType: page.page_type,
          title: page.title,
          tokenCount: page.token_count,
          content,
        };
      }

      // Mode 2: List pages in a knowledge base
      if (input.kbId) {
        const kbId = input.kbId as string;
        const pageType = input.pageType as string | undefined;
        const repos = await getRepos();
        const pages = await repos.wikiPage.getByKbAndType(kbId, pageType);

        return {
          kbId,
          total: pages.length,
          pages: pages.map((p) => ({
            id: p.id,
            docId: p.doc_id,
            pageType: p.page_type,
            title: p.title,
            tokenCount: p.token_count,
          })),
        };
      }

      return {
        error:
          'Provide either "pageId" to view a specific page, or "kbId" to list pages in a knowledge base.',
      };
    },
  });

  // -----------------------------------------------------------------------
  // expand tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "expand",
    description:
      "从摘要逐层深入到详细内容。逐层展开 " +
      "L0（摘要）-> L1（结构概述）-> L2（全文）。" +
      "用于获取文档或页面的更多细节。" +
      "每次调用返回 tokenCount 字段表示内容的 token 数量，可用于判断内容是否完整。" +
      "可通过多次调用反复深入阅读，直到充分理解所需信息。",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "要展开的页面 ID。返回当前层级的内容。",
        },
        docId: {
          type: "string",
          description: "要展开到特定层级的文档 ID。",
        },
        targetLevel: {
          type: "string",
          enum: ["L0", "L1", "L2"],
          description:
            "按文档 ID 展开时的目标层级。L0=摘要，L1=结构，L2=全文。",
        },
        format: {
          type: "string",
          enum: ["md", "dt"],
          description:
            "L1 格式选择：'md' 为 Markdown（人类可读），'dt' 为 DocTags（LLM 友好）。默认：'dt'。",
        },
        heading: {
          type: "string",
          description:
            "要提取的页面内特定章节标题。",
        },
        tokenBudget: {
          type: "number",
          description:
            "按文档 ID 展开时返回的最大 token 数。自动选择能容纳的最深层级内容。注意：仅返回单个层级的内容，不跨层累积。",
        },
      },
    },
    async execute(input: Record<string, unknown>) {
      try {
        // Mode 1: Expand a specific section by heading
        if (input.heading && input.pageId) {
          const result = await deps.expander.expandSection(
            input.pageId as string,
            input.heading as string,
          );

          if (!result) {
            return {
              error: `Section "${input.heading}" not found in page ${input.pageId}`,
            };
          }

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
          };
        }

        // Mode 2: Expand with token budget (automatically picks level)
        if (input.docId && input.tokenBudget) {
          const result = await deps.expander.expandWithBudget(
            input.docId as string,
            input.tokenBudget as number,
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        // Mode 3: Expand to a specific target level by docId
        if (input.docId && input.targetLevel) {
          const result = await deps.expander.expandToLevel(
            input.docId as string,
            input.targetLevel as "L0" | "L1" | "L2",
            input.format as "md" | "dt" | undefined,
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        // Mode 4: Expand a page by pageId (returns current level + child pages)
        if (input.pageId) {
          const result = await deps.expander.expand(
            input.pageId as string,
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        return {
          error:
            'Provide at least "pageId" or "docId". Use "targetLevel" or "tokenBudget" with docId, or "heading" with pageId.',
        };
      } catch (err) {
        return {
          error: `Expand failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });

  // -----------------------------------------------------------------------
  // report_generate tool
  // -----------------------------------------------------------------------

  registry.register(createReportTool({ dataDir: deps.dataDir }));

  // -----------------------------------------------------------------------
  // timeline_build tool
  // -----------------------------------------------------------------------

  registry.register(createTimelineTool({ retriever: deps.retriever, dataDir: deps.dataDir }));

  // -----------------------------------------------------------------------
  // graph_build tool — DISABLED per design decision
  // -----------------------------------------------------------------------
  // registry.register(createGraphTool({ linker: deps.linker, retriever: deps.retriever, dataDir: deps.dataDir }));

  // -----------------------------------------------------------------------
  // read_file tool — read files from the data directory
  // -----------------------------------------------------------------------

  registry.register({
    name: "read_file",
    description:
      "读取文件内容。以文本形式返回文件内容。" +
      "可用于检查上传的文档、配置文件、日志或数据目录中的任何文件。" +
      "数据目录外的文件请使用 bash 工具执行 'cat <路径>'。" +
      "支持文本文件、Markdown、CSV、JSON 等格式。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径（相对于数据目录，或数据目录内的绝对路径）",
        },
        offset: {
          type: "number",
          description: "起始行号（从0开始，默认：0）",
        },
        limit: {
          type: "number",
          description: "最大读取行数（默认：2000）",
        },
      },
      required: ["path"],
    },
    async execute(input: Record<string, unknown>) {
      const { readFileSync, existsSync } = await import("node:fs");
      const { resolve, join } = await import("node:path");
      const rawPath = input.path as string;
      const offset = (input.offset as number) || 0;
      const limit = (input.limit as number) || 2000;

      // Resolve path relative to data directory for safety
      const safePath = resolve(deps.dataDir, rawPath.startsWith("/") ? rawPath.slice(1) : rawPath);
      if (!safePath.startsWith(resolve(deps.dataDir))) {
        return { error: "Access denied: path outside data directory" };
      }

      if (!existsSync(safePath)) {
        return { error: `File not found: ${rawPath}` };
      }

      try {
        const content = readFileSync(safePath, "utf-8");
        const lines = content.split("\n");
        const sliced = lines.slice(offset, offset + limit);
        return {
          path: rawPath,
          totalLines: lines.length,
          showingLines: `${offset}-${Math.min(offset + limit, lines.length)}`,
          content: sliced.join("\n"),
        };
      } catch (err) {
        return { error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // -----------------------------------------------------------------------
  // grep tool — search file contents
  // -----------------------------------------------------------------------

  registry.register({
    name: "grep",
    description:
      "在数据目录的文件中搜索模式。" +
      "返回匹配的行及文件路径和行号。" +
      "支持基本文本搜索和正则表达式。",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "搜索模式（文本或正则表达式）",
        },
        path: {
          type: "string",
          description: "要搜索的目录或文件（相对于数据目录）。默认：整个数据目录。",
        },
        maxResults: {
          type: "number",
          description: "返回匹配行的最大数量（默认：50）",
        },
      },
      required: ["pattern"],
    },
    async execute(input: Record<string, unknown>) {
      const { execSync } = await import("node:child_process");
      const { resolve } = await import("node:path");
      const pattern = input.pattern as string;
      const searchPath = input.path ? resolve(deps.dataDir, input.path as string) : deps.dataDir;
      const maxResults = (input.maxResults as number) || 50;

      if (!searchPath.startsWith(resolve(deps.dataDir))) {
        return { error: "Access denied: path outside data directory" };
      }

      try {
        const escapedPattern = pattern.replace(/'/g, "'\\''");
        const result = execSync(
          `grep -rn --include='*.md' --include='*.txt' --include='*.csv' --include='*.json' --include='*.yaml' --include='*.yml' -E '${escapedPattern}' '${searchPath}' 2>/dev/null | head -${maxResults}`,
          { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024, timeout: 10000 },
        );

        const lines = result.trim().split("\n").filter(Boolean);
        return {
          pattern,
          matches: lines.length,
          results: lines.map((line) => {
            const colonIdx = line.indexOf(":");
            const secondColon = line.indexOf(":", colonIdx + 1);
            if (colonIdx > 0 && secondColon > 0) {
              return {
                file: line.substring(0, colonIdx).replace(deps.dataDir + "/", ""),
                line: parseInt(line.substring(colonIdx + 1, secondColon), 10),
                content: line.substring(secondColon + 1),
              };
            }
            return { raw: line };
          }),
        };
      } catch (err: unknown) {
        // grep returns exit code 1 when no matches found
        const execErr = err as { status?: number };
        if (execErr.status === 1) {
          return { pattern, matches: 0, results: [] };
        }
        return { error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // -----------------------------------------------------------------------
  // glob tool — find files by pattern
  // -----------------------------------------------------------------------

  registry.register({
    name: "glob",
    description:
      "在数据目录中按模式查找文件。" +
      "返回匹配的文件路径列表。支持 glob 模式，如 *.pdf、**/*.md 等。",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob 匹配模式（如 '**/*.md'、'*.pdf'、'wiki/**/*.md'）",
        },
        path: {
          type: "string",
          description: "搜索的基础目录（相对于数据目录）。默认：数据根目录。",
        },
      },
      required: ["pattern"],
    },
    async execute(input: Record<string, unknown>) {
      const { glob } = await import("node:fs/promises");
      const { resolve, join } = await import("node:path");
      const pattern = input.pattern as string;
      const basePath = input.path ? resolve(deps.dataDir, input.path as string) : deps.dataDir;

      if (!basePath.startsWith(resolve(deps.dataDir))) {
        return { error: "Access denied: path outside data directory" };
      }

      try {
        const matches: string[] = [];
        for await (const entry of glob(pattern, { cwd: basePath })) {
          matches.push(entry);
        }
        return {
          pattern,
          base: input.path || "",
          totalFiles: matches.length,
          files: matches.slice(0, 200),
        };
      } catch (err) {
        return { error: `Glob failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // -----------------------------------------------------------------------
  // bash tool — execute shell commands
  // -----------------------------------------------------------------------

  registry.register({
    name: "bash",
    description:
      "执行 Shell 命令并返回输出。请谨慎使用。" +
      "工作目录为项目数据目录。" +
      "命令超时时间为 30 秒。",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "要执行的 Shell 命令",
        },
        timeout: {
          type: "number",
          description: "超时时间（秒，默认：30，最大：120）",
        },
      },
      required: ["command"],
    },
    async execute(input: Record<string, unknown>) {
      const { execSync } = await import("node:child_process");
      const command = input.command as string;
      const timeoutSec = Math.min((input.timeout as number) || 30, 120);

      try {
        const result = execSync(command, {
          encoding: "utf-8",
          cwd: deps.dataDir,
          timeout: timeoutSec * 1000,
          maxBuffer: 5 * 1024 * 1024,
        });
        return { exitCode: 0, output: result.trim() };
      } catch (err: unknown) {
        const execErr = err as { status?: number; stdout?: string; stderr?: string };
        return {
          exitCode: execErr.status ?? 1,
          output: (execErr.stdout as string || "").trim(),
          error: (execErr.stderr as string || "").trim() || (err instanceof Error ? err.message : String(err)),
        };
      }
    },
  });

  // -----------------------------------------------------------------------
  // web_search tool — search the web
  // -----------------------------------------------------------------------

  registry.register({
    name: "web_search",
    description:
      "搜索网络获取信息。返回包含标题、URL 和摘要的搜索结果。" +
      "适用于查找知识库中没有的最新信息。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索查询",
        },
        maxResults: {
          type: "number",
          description: "返回结果的最大数量（默认：10）",
        },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>) {
      const args = input as { query: string; maxResults?: number };
      const backend = process.env.SEARCH_BACKEND ?? "searxng";
      const maxResults = args.maxResults ?? 10;

      try {
        if (backend === "serper") {
          const apiKey = process.env.SERPER_API_KEY;
          if (!apiKey) {
            return "Web search (Serper) is not configured. Set SERPER_API_KEY environment variable.";
          }

          const resp = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
              "X-API-KEY": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              q: args.query,
              num: maxResults,
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (!resp.ok) {
            return `Search request failed: HTTP ${resp.status}`;
          }

          const data = await resp.json() as {
            organic?: Array<{ title: string; link: string; snippet: string }>;
          };

          const results = (data.organic ?? []).slice(0, maxResults);
          if (results.length === 0) return `No results found for "${args.query}".`;

          return results
            .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.link}\n    ${r.snippet}`)
            .join("\n\n");
        } else {
          // SearXNG (self-hosted)
          const searxngUrl = process.env.SEARXNG_URL ?? "http://localhost:8888";
          const url = `${searxngUrl}/search?q=${encodeURIComponent(args.query)}&format=json&categories=general`;

          const resp = await fetch(url, {
            signal: AbortSignal.timeout(15000),
          });

          if (!resp.ok) {
            return `Search request failed: HTTP ${resp.status}. Check SearXNG at ${searxngUrl}`;
          }

          const data = await resp.json() as {
            results?: Array<{ title: string; url: string; content: string }>;
          };

          const results = (data.results ?? []).slice(0, maxResults);
          if (results.length === 0) return `No results found for "${args.query}".`;

          return results
            .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content}`)
            .join("\n\n");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
          return `Search request timed out for "${args.query}".`;
        }
        return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // -----------------------------------------------------------------------
  // Multimedia generation tools (TTS, image, video, music)
  // -----------------------------------------------------------------------

  const { CapabilityDispatcher } = await import("../../models/capability-dispatcher.js");
  const dispatcher = new CapabilityDispatcher();

  registry.register({
    name: "tts_generate",
    description:
      "从文本生成语音音频。将文本输入转换为自然语音。" +
      "返回音频文件路径和元数据。支持中文和英文。",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要转换为语音的文本",
        },
        voice: {
          type: "string",
          description: "语音名称（默认：male-qn-qingse）",
        },
        speed: {
          type: "number",
          description: "语速（默认：1.0）",
        },
      },
      required: ["text"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const result = await dispatcher.textToSpeech(input.text as string, {
          voice: input.voice as string | undefined,
          speed: input.speed as number | undefined,
        });

        // Save audio to data directory
        const { writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const filename = `tts-${Date.now()}.mp3`;
        const filePath = join(deps.dataDir, "generated", filename);
        writeFileSync(filePath, Buffer.from(result.audio));

        return {
          success: true,
          filePath: `generated/${filename}`,
          contentType: result.contentType,
          sizeBytes: result.audio.byteLength,
        };
      } catch (err) {
        return { error: `TTS generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  registry.register({
    name: "image_generate",
    description:
      "根据文本描述生成图片。根据提示词创建视觉内容。" +
      "返回图片文件路径。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "图片生成提示词，描述所需图片",
        },
        width: {
          type: "number",
          description: "图片宽度（像素）",
        },
        height: {
          type: "number",
          description: "图片高度（像素）",
        },
      },
      required: ["prompt"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const result = await dispatcher.generateImage(input.prompt as string, {
          width: input.width as number | undefined,
          height: input.height as number | undefined,
        });

        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = join(deps.dataDir, "generated");
        mkdirSync(dir, { recursive: true });
        const filename = `image-${Date.now()}.png`;
        writeFileSync(join(dir, filename), Buffer.from(result.image));

        return {
          success: true,
          filePath: `generated/${filename}`,
          contentType: result.contentType,
          sizeBytes: result.image.byteLength,
        };
      } catch (err) {
        return { error: `Image generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  registry.register({
    name: "video_generate",
    description:
      "根据文本提示生成视频。创建 AI 视频（可能需要几分钟）。" +
      "返回视频文件 URL 或路径。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "视频生成提示词，描述所需的视频内容",
        },
      },
      required: ["prompt"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const result = await dispatcher.generateVideo(input.prompt as string);

        return {
          success: true,
          fileUrl: result.fileUrl,
          contentType: result.contentType,
        };
      } catch (err) {
        return { error: `Video generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  registry.register({
    name: "music_generate",
    description:
      "根据文本提示生成音乐。根据描述创建音频文件。" +
      "返回音频文件路径。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "音乐生成提示词，描述所需的音乐风格/情绪",
        },
        duration: {
          type: "number",
          description: "所需时长（秒）",
        },
      },
      required: ["prompt"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const result = await dispatcher.generateMusic(input.prompt as string, {
          duration: input.duration as number | undefined,
        });

        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = join(deps.dataDir, "generated");
        mkdirSync(dir, { recursive: true });
        const filename = `music-${Date.now()}.mp3`;
        writeFileSync(join(dir, filename), Buffer.from(result.audio));

        return {
          success: true,
          filePath: `generated/${filename}`,
          contentType: result.contentType,
          sizeBytes: result.audio.byteLength,
        };
      } catch (err) {
        return { error: `Music generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  return registry;
}

// ---------------------------------------------------------------------------
// workflow_run tool registration (for multi-agent workflows)
// ---------------------------------------------------------------------------

/** Dependencies needed to register the workflow_run tool. */
export interface WorkflowRunDeps {
  runner: any;
  toolRegistry: ToolRegistry;
  getTeamManager: () => Promise<any>;
  emitWs: (event: any) => void;
}

/**
 * Register the workflow_run tool on an existing ToolRegistry.
 *
 * This is called during orchestrator initialization (after the AgentRunner
 * and ToolRegistry have been created) to enable multi-agent workflow execution.
 */
export async function registerWorkflowRunTool(registry: ToolRegistry, deps: WorkflowRunDeps): Promise<void> {
  const { createWorkflowRunTool } = await import("./tools/workflow-run.js");
  registry.register(createWorkflowRunTool({
    runner: deps.runner,
    toolRegistry: deps.toolRegistry,
    onEvent: deps.emitWs,
  }));
}
