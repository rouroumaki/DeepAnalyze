// =============================================================================
// DeepAnalyze - Tool Setup
// =============================================================================
// Creates a fully configured ToolRegistry with all custom DeepAnalyze tools
// (kb_search, wiki_browse, expand, report_generate, timeline_build, graph_build)
// registered and wired to their backends.
// =============================================================================

import { ToolRegistry, DEFERRED_TOOLS } from "./tool-registry.js";
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
import { AgentPluginManager } from "./plugin-manager.js";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Dependencies for tool registration
// ---------------------------------------------------------------------------

/** All external dependencies needed to set up the tool registry. */
// ---------------------------------------------------------------------------
// Tools blocked for sub-agents to prevent recursive spawning
// ---------------------------------------------------------------------------

export const SUB_AGENT_BLOCKED_TOOLS = new Set([
  "workflow_run",
]);

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
      "语义搜索知识库文档。返回按相关性排序的匹配页面列表（默认最多8-10条）。" +
      "底层使用向量相似度 + BM25 全文搜索。默认排除报告类页面。" +
      "注意：这是近似检索，不保证覆盖所有相关文档。如果需要完整文档列表，用 wiki_browse(listDocuments=true) 或 run_sql。" +
      "适合：快速定位特定主题的文档、补充性语义查询。" +
      "不适合：获取完整文档列表、精确文本匹配（用 doc_grep）、阅读完整内容（用 expand）。",
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
      // Default to excluding report pages — agent should analyze source documents, not prior reports
      const pageTypes = (input.pageTypes as string[]) || undefined;
      const excludeReports = input.excludeReports !== false; // default true
      const effectivePageTypes = pageTypes ?? (excludeReports
        ? ["abstract", "overview", "fulltext", "structure_md", "structure_dt", "entity", "concept"]
        : undefined);

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
          pageTypes: effectivePageTypes,
          minScore: input.minScore as number | undefined,
        });
      }

      return deps.retriever.search(query, {
        kbIds,
        topK: (input.topK as number) || 10,
        linkedFrom: input.linkedFrom as string | undefined,
        pageTypes: effectivePageTypes,
        minScore: input.minScore as number | undefined,
      });
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  });

  // -----------------------------------------------------------------------
  // wiki_browse tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "wiki_browse",
    description:
      "浏览知识库中的文档和 Wiki 页面。" +
      "提供 listDocuments=true + kbId：返回该知识库所有文档的分类列表，每篇附带 docId、文件名和 L0 摘要。" +
      "提供 pageId：返回特定页面的完整内容（id, docId, pageType, title, tokenCount, content）。" +
      "提供 kbId（可选 pageType）：列出该知识库的所有页面（id, docId, pageType, title, tokenCount）。",
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
        listDocuments: {
          type: "boolean",
          description:
            "设为 true 时，列出知识库中所有文档（去重），每个文档附带其 L0 摘要页的摘要内容和页面ID。适用于全面了解知识库内容。",
        },
      },
    },
    async execute(input: Record<string, unknown>) {
      const repos = await getRepos();

      // Mode: List distinct documents with L0 abstracts
      if (input.listDocuments && input.kbId) {
        const kbId = input.kbId as string;

        // Get all documents in the KB
        const docs = await repos.document.getByKbId(kbId);

        // Get all abstract (L0) pages for quick summary
        const abstractPages = await repos.wikiPage.getByKbAndType(kbId, "abstract");

        // Build a map: docId -> abstract page
        const abstractMap = new Map<string, { pageId: string; content: string }>();
        for (const p of abstractPages) {
          if (!abstractMap.has(p.doc_id)) {
            abstractMap.set(p.doc_id, {
              pageId: p.id,
              content: (p.content || "").slice(0, 300),
            });
          }
        }

        // Auto-categorize documents by directory and file type
        const categories = new Map<string, { type: string; count: number; docIds: string[]; sampleFiles: string[] }>();

        // Generic file type labels by extension
        const fileTypeLabel = (ext: string): string => {
          const e = ext.toLowerCase();
          if (["pdf"].includes(e)) return "PDF";
          if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"].includes(e)) return "Image";
          if (["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(e)) return "Audio";
          if (["mp4", "avi", "mkv", "mov", "wmv", "webm"].includes(e)) return "Video";
          if (["xlsx", "xls", "csv", "tsv"].includes(e)) return "Spreadsheet";
          if (["doc", "docx"].includes(e)) return "Word";
          if (["ppt", "pptx"].includes(e)) return "Presentation";
          if (["txt", "md", "rtf"].includes(e)) return "Text";
          if (["json", "xml", "yaml", "yml"].includes(e)) return "Data";
          if (["zip", "tar", "gz", "rar", "7z"].includes(e)) return "Archive";
          return e.toUpperCase() || "Unknown";
        };

        // Classify by parent directory first (most useful grouping), then by file type
        const classifyDoc = (d: { id: string; filename: string; file_type: string }) => {
          const parts = d.filename.replace(/\\/g, "/").split("/");
          // If file is inside a subdirectory (depth >= 2), use the immediate parent folder name
          if (parts.length >= 3) {
            return parts[parts.length - 2]; // parent folder name
          }
          // Otherwise group by file type
          return fileTypeLabel(d.file_type);
        };

        for (const d of docs) {
          const cat = classifyDoc(d);
          if (!categories.has(cat)) {
            categories.set(cat, { type: cat, count: 0, docIds: [], sampleFiles: [] });
          }
          const entry = categories.get(cat)!;
          entry.count++;
          entry.docIds.push(d.id);
          if (entry.sampleFiles.length < 3) {
            entry.sampleFiles.push(d.filename.split("/").pop() || d.filename);
          }
        }

        return {
          kbId,
          totalDocuments: docs.length,
          categories: Array.from(categories.values()).map((c) => ({
            type: c.type,
            count: c.count,
            sampleFiles: c.sampleFiles,
          })),
          documents: docs.map((d) => {
            const abstract = abstractMap.get(d.id);
            // Strip dataDir prefix from filePath so it's relative to the bash CWD.
            // DB stores "data/original/..." but bash runs with cwd="data/",
            // so agents need "original/..." to avoid double-prefixing.
            const rawPath = d.file_path || "";
            const dataDirPrefix = deps.dataDir + "/";
            const relativePath = rawPath.startsWith(dataDirPrefix)
              ? rawPath.slice(dataDirPrefix.length)
              : rawPath;
            return {
              docId: d.id,
              filename: d.filename,
              filePath: relativePath || undefined,
              fileType: d.file_type,
              status: d.status,
              abstractPageId: abstract?.pageId,
              abstract: abstract?.content,
            };
          }),
        };
      }

      // Mode 1: View a specific page by ID
      if (input.pageId) {
        const pageId = input.pageId as string;
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
          'Provide "kbId" to list pages, "pageId" to view a page, or "kbId" + "listDocuments=true" to list all documents.',
      };
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  });

  // -----------------------------------------------------------------------
  // expand tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "expand",
    description:
      "逐层展开文档内容。知识库文档按三层结构组织：\n" +
      "- L0（摘要层，~125 tokens）：文档主题、核心要点、标签。适合快速分类和路由\n" +
      "- L1（主要内容层）：绝大部分可分析的数据都在这一层\n" +
      "- L2（原始数据层）：各类型的原始格式化数据\n\n" +
      "**各文件类型的数据分布：**\n" +
      "- PDF/DOCX：L1 包含完整全文（Markdown），与 L2 内容相同，分析时只看 L1 即可\n" +
      "- 图片（JPG/PNG）：L1 包含 VLM 视觉描述和 OCR 文本；如 VLM 未配置则 L1 为空，需看 L2 的原始描述数据\n" +
      "- 音频（MP3）：L1 包含按说话者分组的转写文本；L2 基本相同\n" +
      "- 视频（MP4）：L1 包含按场景分割的描述和对话转写；如 VLM 未配置则 L1 为空，需看 L2\n" +
      "- Excel：小表格（≤1000行）L1/L2 有完整内容；**大表格（>1000行）L1 为空，L2 是海量原始 CSV**，必须使用 bash + pandas 读取原始文件分析（文件路径从 wiki_browse listDocuments 返回的 filePath 字段获取）\n\n" +
      "批量模式：提供 docIds 数组 + kbId 一次获取多个文档的 L0 或 L1 内容（通过 targetLevel 指定）。" +
      "单文档模式：提供 docId + targetLevel 展开到指定层级。",
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
        docIds: {
          type: "array",
          items: { type: "string" },
          description: "批量展开多个文档 ID。返回每个文档的 L1 结构概述。提供 kbId 时使用高效批量查询（推荐）。",
        },
        kbId: {
          type: "string",
          description: "知识库 ID。批量展开(docIds)时提供此参数可使用高效批量查询，显著减少 DB 访问次数。从 wiki_browse 的返回中获取。",
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
            "L1 格式选择：'md' 为 Markdown（人类可读），'dt' 为 DocTags（LLM 友好）。默认：'md'。",
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
        // Mode 0: Batch expand multiple documents
        if (Array.isArray(input.docIds) && input.docIds.length > 0) {
          const docIds = input.docIds as string[];
          const format = (input.format as "md" | "dt" | undefined) || "md";
          const kbId = input.kbId as string | undefined;
          const targetLevel = (input.targetLevel as "L0" | "L1" | undefined) || "L1";

          // Use optimized batch method when kbId is provided (2-4 DB queries vs N×4)
          if (kbId) {
            const batchResults = await deps.expander.batchExpand(kbId, docIds, format, targetLevel);
            const foundIds = new Set(batchResults.map(r => r.docId));
            const results: Array<{ docId: string; title: string; level: string; content: string; tokenCount: number } | { docId: string; error: string }> = batchResults.map(r => ({
              docId: r.docId,
              title: r.title,
              level: targetLevel,
              content: r.content,
              tokenCount: r.tokenCount,
            }));
            // Add error entries for docs not found
            for (const docId of docIds) {
              if (!foundIds.has(docId)) {
                results.push({ docId, error: `No ${targetLevel} page found` });
              }
            }
            return { mode: "batch", totalDocs: docIds.length, results };
          }

          // Fallback: individual expand when no kbId (slower but works)
          const results = await Promise.all(
            docIds.map(async (docId) => {
              try {
                const result = await deps.expander.expandToLevel(docId, targetLevel === "L0" ? "L0" : "L1", format);
                return {
                  docId: result.docId,
                  title: result.title,
                  level: result.level,
                  content: result.content,
                  tokenCount: result.tokenCount,
                };
              } catch {
                return { docId, error: "Expand failed" };
              }
            }),
          );
          return {
            mode: "batch",
            totalDocs: docIds.length,
            results,
          };
        }

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
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  });

  // -----------------------------------------------------------------------
  // report_generate tool
  // -----------------------------------------------------------------------

  const reportTool = createReportTool({ dataDir: deps.dataDir });
  registry.register({
    ...reportTool,
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  });

  // -----------------------------------------------------------------------
  // timeline_build tool
  // -----------------------------------------------------------------------

  const timelineTool = createTimelineTool({ retriever: deps.retriever, dataDir: deps.dataDir });
  registry.register({
    ...timelineTool,
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    shouldDefer: true,
  });

  // -----------------------------------------------------------------------
  // push_content tool — push structured data directly to user frontend
  // -----------------------------------------------------------------------

  registry.register({
    name: "push_content",
    description:
      "将结构化内容卡片推送到用户界面。**仅用于以下场景**：" +
      "① 大型表格数据（type=table，CSV/TSV 格式，适合展示对比矩阵、统计汇总）" +
      "② 需要快速合并展示的多段内容（如把多个子 Agent 结果合并为一个卡片）" +
      "③ 代码片段、文件引用等需要特殊格式化的内容。" +
      "**不要用于普通分析文本**——你的分析结论、报告正文应直接以文字输出，用户会实时看到流式显示。" +
      "type=markdown 可推送富文本卡片，type=table 推送表格数据。\n\n" +
      "**快速推送文件**：提供 filePath 参数可直接读取并推送文件内容，无需先用 read_file 读入上下文。" +
      "适用于推送子Agent生成的分析文件、报告文件等。data 和 filePath 二选一，同时提供时 filePath 优先。",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["table", "text", "code", "file", "markdown"],
          description: "内容类型：table=表格数据, text=纯文本, code=代码块, file=文件引用, markdown=Markdown格式",
        },
        title: {
          type: "string",
          description: "内容标题（显示在卡片顶部）",
        },
        data: {
          type: "string",
          description: "内容数据。table类型传入CSV或JSON字符串；code类型传入代码；text/markdown类型传入文本内容。与 filePath 二选一。",
        },
        filePath: {
          type: "string",
          description: "要推送的文件路径。工具会直接读取文件内容并推送，无需先读入上下文。适用于推送子Agent生成的分析报告文件。支持 data 目录下的相对路径（如 tmp/paper_analysis.md）或绝对路径。与 data 二选一，同时提供时 filePath 优先。",
        },
        format: {
          type: "string",
          description: "格式提示（如 csv, json, python, sql, markdown 等）",
        },
      },
      required: ["type", "title"],
    },
    async execute(input: Record<string, unknown>) {
      const contentType = input.type as string;
      const title = input.title as string;
      const format = input.format as string | undefined;
      let data = input.data as string | undefined;
      const filePath = input.filePath as string | undefined;

      // If filePath is provided, read the file directly
      if (filePath) {
        try {
          const { readFile } = await import("node:fs/promises");
          const { resolve, isAbsolute } = await import("node:path");
          const resolvedPath = isAbsolute(filePath)
            ? filePath
            : resolve(process.cwd(), "data", filePath);
          const content = await readFile(resolvedPath, "utf-8");
          data = content;
        } catch (err) {
          return {
            error: `Failed to read file: ${filePath} — ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      if (!data) {
        return { error: "No data provided. Either 'data' or 'filePath' must be supplied." };
      }

      return {
        pushed: true,
        type: contentType,
        title,
        data: data.slice(0, 500_000), // Cap at 500KB to avoid oversized payloads
        format,
        timestamp: new Date().toISOString(),
      };
    },
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  });

  // -----------------------------------------------------------------------
  // agent_todo tool — task list management
  // -----------------------------------------------------------------------

  registry.register({
    name: "agent_todo",
    description:
      "任务清单管理工具。用于规划和跟踪复杂任务的执行进度。" +
      "当任务需要多个步骤或多轮搜索时，先用此工具制定清单，再逐一完成并更新状态。" +
      "这确保你不会遗漏任何步骤，用户也能实时看到你的工作进度。" +
      "建议：涉及 3 个以上子步骤的任务都应先创建清单。" +
      "action=create 批量创建（提供 todos 数组）或单条创建（提供 subject）。" +
      "action=update 更新任务状态（提供 id 和 status：pending/in_progress/completed）。" +
      "action=list 查看当前清单。",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "list"],
          description: "操作类型：create 创建任务，update 更新状态，list 查看清单",
        },
        id: {
          type: "string",
          description: "任务 ID（update 操作必填）",
        },
        subject: {
          type: "string",
          description: "任务标题（create 操作必填）",
        },
        description: {
          type: "string",
          description: "任务详情（create 操作可选）",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
          description: "任务状态（update 操作必填）",
        },
        todos: {
          type: "array",
          description: "批量设置完整任务清单（可选，覆盖式更新）",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              subject: { type: "string" },
              description: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["id", "subject", "status"],
          },
        },
      },
      required: ["action"],
    },
    async execute(input: Record<string, unknown>) {
      const action = input.action as string;

      // Bulk set mode: Agent provides the full todo list
      if (action === "create" && Array.isArray(input.todos)) {
        const todos = input.todos as Array<{
          id: string;
          subject: string;
          description?: string;
          status: string;
        }>;

        const lines = todos.map((t) => {
          const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : "⬜";
          return `${icon} [${t.id}] ${t.subject}${t.description ? ` — ${t.description}` : ""} (${t.status})`;
        });

        return {
          action: "bulk_set",
          total: todos.length,
          completed: todos.filter((t) => t.status === "completed").length,
          inProgress: todos.filter((t) => t.status === "in_progress").length,
          pending: todos.filter((t) => t.status === "pending").length,
          todos: lines.join("\n"),
        };
      }

      // Single create
      if (action === "create") {
        const id = input.id as string || `task-${Date.now()}`;
        const subject = input.subject as string;
        const description = input.description as string | undefined;
        const status = "pending";

        if (!subject) {
          return { error: "subject is required for create action" };
        }

        const icon = "⬜";
        return {
          action: "created",
          todo: `${icon} [${id}] ${subject}${description ? ` — ${description}` : ""} (${status})`,
        };
      }

      // Update
      if (action === "update") {
        const id = input.id as string;
        const status = input.status as string;

        if (!id || !status) {
          return { error: "id and status are required for update action" };
        }

        const icon = status === "completed" ? "✅" : status === "in_progress" ? "🔄" : "⬜";
        return {
          action: "updated",
          todo: `${icon} [${id}] status → ${status}`,
        };
      }

      // List
      if (action === "list") {
        return {
          action: "list",
          message: "Use the todos in your context to review task progress. Create or update tasks as needed.",
        };
      }

      return { error: `Unknown action: ${action}` };
    },
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  });

  // -----------------------------------------------------------------------
  // doc_grep tool — regex search across wiki page content
  // -----------------------------------------------------------------------

  registry.register({
    name: "doc_grep",
    description:
      "正则搜索知识库中 wiki 页面的实际内容文本。" +
      "支持精确匹配人名、日期、编号、金额、特定短语等。" +
      "返回匹配的页面列表及匹配行上下文。" +
      "与 kb_search（语义搜索）互补，适用于需要精确字符串匹配的场景。" +
      "适用场景：精确匹配人名、日期、编号、金额等。kb_search 找不到时试试 doc_grep。",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "正则表达式模式。如：'合同编号.*2024'、'张某|赵某'、'¥\\d+\\.\\d{2}'",
        },
        kbIds: {
          type: "array",
          items: { type: "string" },
          description: "搜索的知识库 ID 列表。省略则搜索所有知识库。",
        },
        pageTypes: {
          type: "array",
          items: { type: "string" },
          description: "页面类型过滤（abstract, overview, fulltext, structure_md 等）。默认搜索所有非 report 类型。",
        },
        maxResults: {
          type: "number",
          description: "最大返回结果数（默认 30）",
        },
      },
      required: ["pattern"],
    },
    async execute(input: Record<string, unknown>) {
      const pattern = input.pattern as string;
      const kbIds = (input.kbIds as string[]) || [];
      const pageTypes = (input.pageTypes as string[]) || undefined;
      const maxResults = (input.maxResults as number) || 30;

      if (!pattern) {
        return { error: "pattern is required" };
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, "i");
      } catch {
        return { error: `Invalid regex pattern: ${pattern}` };
      }

      const repos = await getRepos();

      // Determine which KBs to search
      let searchKbIds = kbIds;
      if (searchKbIds.length === 0) {
        const allKbs = await repos.knowledgeBase.list();
        searchKbIds = allKbs.map((kb) => kb.id);
      }

      // Build page type filter — default exclude report pages
      const effectivePageTypes = pageTypes ?? [
        "abstract", "overview", "fulltext",
        "structure_md", "structure_dt", "entity", "concept",
      ];

      const allMatches: Array<{
        pageId: string;
        docId: string;
        kbId: string;
        pageType: string;
        title: string;
        matchedLines: string[];
      }> = [];

      for (const kbId of searchKbIds) {
        if (allMatches.length >= maxResults) break;

        for (const pt of effectivePageTypes) {
          if (allMatches.length >= maxResults) break;

          const pages = await repos.wikiPage.getByKbAndType(kbId, pt);

          for (const page of pages) {
            if (allMatches.length >= maxResults) break;

            const content = page.content || "";
            const lines = content.split("\n");
            const matchedLines: string[] = [];

            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                // Include 1 line of context before and after
                const start = Math.max(0, i - 1);
                const end = Math.min(lines.length, i + 2);
                const contextBlock = lines.slice(start, end).join("\n");
                matchedLines.push(`L${i + 1}: ${contextBlock}`);
              }
            }

            if (matchedLines.length > 0) {
              allMatches.push({
                pageId: page.id,
                docId: page.doc_id,
                kbId: page.kb_id,
                pageType: page.page_type,
                title: page.title,
                matchedLines: matchedLines.slice(0, 5), // Max 5 matched lines per page
              });
            }
          }
        }
      }

      return {
        pattern,
        totalMatches: allMatches.length,
        matches: allMatches,
      };
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  });

  // -----------------------------------------------------------------------
  // ask_user tool — agent asks user a question during analysis
  // -----------------------------------------------------------------------

  registry.register({
    name: "ask_user",
    description:
      "向用户提出问题并等待回答。用于任务范围确认、歧义消除、分析方向选择等场景。" +
      "例如：" +
      "1) '找到大量相关文档，需要分析全部还是只分析特定类别？' " +
      "2) '搜索到多个同名结果，你指的是哪一个？' " +
      "3) '初步分析已完成，是否需要继续深入某个方向？'" +
      "调用后会暂停当前任务，等待用户回复后继续。",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "要向用户提出的问题",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "可选的预设选项（最多 4 个），用户可以直接选择",
        },
      },
      required: ["question"],
    },
    async execute(input: Record<string, unknown>) {
      const question = input.question as string;
      const options = input.options as string[] | undefined;

      if (!question) {
        return { error: "question is required" };
      }

      // Access the ask_user callback from the execution context set by the route handler
      const ctx = registry.getExecutionContext();
      const askUserFn = ctx.askUserCallback as
        | ((question: string, options?: string[]) => Promise<string>)
        | undefined;

      if (!askUserFn) {
        return {
          answer: null,
          error: "ask_user not available in this context (no user connection)",
          fallback: "Proceed with best judgment",
        };
      }

      try {
        const answer = await askUserFn(question, options);
        return { answer };
      } catch (err) {
        return {
          answer: null,
          error: `ask_user failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  });

  // -----------------------------------------------------------------------
  // write_file tool — create or overwrite files in the data directory
  // -----------------------------------------------------------------------

  registry.register({
    name: "write_file",
    description:
      "创建或覆盖文件。将内容写入数据目录中的指定文件。" +
      "自动创建所需的中间目录。" +
      "可用于生成代码、配置文件、数据导出、临时文件等。" +
      "对于大段输出内容，优先用 write_file 保存到文件再告知用户——这防止上下文窗口被填满，也方便其他Agent读取合并。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径（相对于数据目录）",
        },
        content: {
          type: "string",
          description: "要写入的文件内容",
        },
      },
      required: ["path", "content"],
    },
    async execute(input: Record<string, unknown>) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { resolve, dirname } = await import("node:path");
      const rawPath = input.path as string;
      const content = input.content as string;

      const safePath = resolve(deps.dataDir, rawPath.startsWith("/") ? rawPath.slice(1) : rawPath);
      if (!safePath.startsWith(resolve(deps.dataDir))) {
        return { error: "Access denied: path outside data directory" };
      }

      try {
        mkdirSync(dirname(safePath), { recursive: true });
        writeFileSync(safePath, content, "utf-8");
        return {
          success: true,
          path: rawPath,
          bytesWritten: Buffer.byteLength(content, "utf-8"),
        };
      } catch (err) {
        return { error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  });

  // -----------------------------------------------------------------------
  // edit_file tool — edit files with old_string/new_string replacement
  // -----------------------------------------------------------------------

  registry.register({
    name: "edit_file",
    description:
      "编辑数据目录中的文件。通过精确匹配 old_string 并替换为 new_string 来修改文件内容。" +
      "old_string 必须与文件中的内容完全匹配（包括缩进）。" +
      "如果 old_string 在文件中出现多次，必须提供足够的上下文使其唯一。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径（相对于数据目录）",
        },
        old_string: {
          type: "string",
          description: "要替换的原始文本（必须精确匹配）",
        },
        new_string: {
          type: "string",
          description: "替换后的新文本",
        },
        replace_all: {
          type: "boolean",
          description: "是否替换所有匹配项（默认：false，仅替换第一个）",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    async execute(input: Record<string, unknown>) {
      const { readFile, writeFile } = await import("fs/promises");
      const { resolve } = await import("node:path");
      const rawPath = input.path as string;
      const oldString = input.old_string as string;
      const newString = input.new_string as string;
      const replaceAll = (input.replace_all as boolean) || false;

      const safePath = resolve(deps.dataDir, rawPath.startsWith("/") ? rawPath.slice(1) : rawPath);
      if (!safePath.startsWith(resolve(deps.dataDir))) {
        return { error: "Access denied: path outside data directory" };
      }

      try {
        const content = await readFile(safePath, "utf-8");

        // Count occurrences of old_string
        const occurrences = content.split(oldString).length - 1;

        if (occurrences === 0) {
          return {
            error: `old_string not found in file "${rawPath}". The string to replace was not found in the file content.`,
          };
        }

        if (occurrences > 1 && !replaceAll) {
          return {
            error: `old_string appears ${occurrences} times in file "${rawPath}". Provide more context to make the match unique, or set replace_all to true to replace all occurrences.`,
          };
        }

        const newContent = replaceAll
          ? content.replaceAll(oldString, newString)
          : content.replace(oldString, newString);

        await writeFile(safePath, newContent, "utf-8");
        return {
          success: true,
          path: rawPath,
          replacements: replaceAll ? occurrences : 1,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ENOENT")) {
          return { error: `File not found: ${rawPath}` };
        }
        return { error: `Failed to edit file: ${msg}` };
      }
    },
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  });

  // -----------------------------------------------------------------------
  // skill_invoke tool — invoke a user-defined skill
  // -----------------------------------------------------------------------

  registry.register({
    name: "skill_invoke",
    description:
      "调用已注册的自定义技能（Skill）。技能是针对特定场景优化的预定义工作流。" +
      "调用后会加载技能的提示词作为补充指令，在独立上下文中执行任务。" +
      "先用 list_skills 查看可用技能列表和描述，再根据任务匹配调用。" +
      "技能会自动处理分块、并行、合成等复杂流程，比自己逐步处理更高效。",
    inputSchema: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "要调用的技能名称",
        },
        input: {
          type: "string",
          description: "传递给技能的任务描述",
        },
      },
      required: ["skill_name", "input"],
    },
    async execute(inputParams: Record<string, unknown>) {
      // Accept both "skill_name" (schema name) and "name" (what LLMs naturally use after seeing list_skills output)
      const skillName = (inputParams.skill_name ?? inputParams.name) as string;
      const taskInput = inputParams.input as string;

      try {
        const repos = await getRepos();
        const skill = await repos.agentSkill.getByName(skillName);
        if (!skill) {
          return { error: `Skill "${skillName}" not found. Use list_skills to see available skills.` };
        }
        if (!skill.isActive) {
          return { error: `Skill "${skillName}" is currently disabled.` };
        }

        // Return the skill definition + input for the agent runner to use
        // The runner will detect this special result and launch a sub-agent
        return {
          __skill_invoke__: true,
          skill: {
            name: skill.name,
            prompt: skill.prompt,
            tools: skill.tools,
            modelRole: skill.modelRole,
          },
          input: taskInput,
        };
      } catch (err) {
        return { error: `Failed to load skill: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  });

  // -----------------------------------------------------------------------
  // list_skills tool — list available user-defined skills
  // -----------------------------------------------------------------------

  registry.register({
    name: "list_skills",
    description:
      "列出所有可用的自定义技能。返回技能名称、描述和状态。" +
      "使用 skill_invoke 工具调用特定技能。",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute() {
      try {
        const repos = await getRepos();
        const skills = await repos.agentSkill.listActive();
        if (skills.length === 0) {
          return {
            skills: [],
            message: "No skills have been defined yet. Skills can be created via the /api/agent-skills endpoint or the settings UI.",
          };
        }
        return {
          skills: skills.map((s) => ({
            name: s.name,
            description: s.description,
            modelRole: s.modelRole,
            tools: s.tools,
          })),
        };
      } catch (err) {
        return { error: `Failed to list skills: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  });

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
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
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
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
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
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  });

  // -----------------------------------------------------------------------
  // bash tool — execute shell commands
  // -----------------------------------------------------------------------

  registry.register({
    name: "bash",
    description:
      "执行 Shell 命令并返回输出。请谨慎使用。" +
      "工作目录为项目数据目录。" +
      "命令超时时间为 30 秒。\n\n" +
      "使用建议：\n" +
      "- 执行代码前先在 think 工具中验证逻辑\n" +
      "- 对计算结果做常识性检查（数量级、单位、边界值）\n" +
      "- 代码出错时先分析错误信息，不要盲目修改重试\n" +
      "- 复杂计算优先使用 Python 脚本而非单行命令，便于调试",
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
    isReadOnly: (input) => {
      const cmd = (input.command as string) ?? "";
      const readOnlyPrefixes = ["ls", "cat", "head", "tail", "wc", "du", "file", "stat", "pwd", "echo", "which", "type", "env", "printenv", "git status", "git log", "git diff", "git branch"];
      return readOnlyPrefixes.some(c => cmd.trimStart().startsWith(c));
    },
    isConcurrencySafe: (input) => {
      const cmd = (input.command as string) ?? "";
      const readOnlyPrefixes = ["ls", "cat", "head", "tail", "wc", "du", "file", "stat", "pwd", "echo", "which", "type", "env", "printenv", "git status", "git log", "git diff", "git branch"];
      return readOnlyPrefixes.some(c => cmd.trimStart().startsWith(c));
    },
  });

  // -----------------------------------------------------------------------
  // run_sql tool — execute SQL queries against the database
  // -----------------------------------------------------------------------

  registry.register({
    name: "run_sql",
    description:
      "执行 SQL 查询（只读 SELECT）并返回结果。" +
      "直接查询 PostgreSQL 数据库，可访问 documents、wiki_pages 等表的完整数据。" +
      "这是获取精确完整数据最可靠的方式——不受向量检索的召回率限制，不受分页限制。" +
      "适合：文档统计聚合、按文件类型/目录/状态分类、精确的元数据查询、全量列表。" +
      "示例：SELECT file_type, count(*) FROM documents WHERE kb_id='...' GROUP BY file_type",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SQL SELECT 查询语句",
        },
        maxRows: {
          type: "number",
          description: "最大返回行数（默认：100，最大：500）",
        },
      },
      required: ["sql"],
    },
    async execute(input: Record<string, unknown>) {
      const sql = (input.sql as string).trim();
      const maxRows = Math.min((input.maxRows as number) || 100, 500);

      // Only allow SELECT queries
      if (!/^SELECT\s/i.test(sql)) {
        return { error: "Only SELECT queries are allowed" };
      }
      // Block dangerous patterns
      if (/\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(sql)) {
        return { error: "Only SELECT queries are allowed" };
      }

      try {
        const { getPool } = await import("../../store/pg.js");
        const pool = await getPool();
        const result = await pool.query(sql);
        const rows = result.rows.slice(0, maxRows);
        return {
          rowCount: result.rows.length,
          showingRows: Math.min(result.rows.length, maxRows),
          columns: result.fields?.map((f: { name: string }) => f.name) || [],
          rows,
        };
      } catch (err) {
        return { error: `SQL error: ${err instanceof Error ? err.message : String(err)}` };
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
      "适用于查找知识库中没有的最新信息。\n\n" +
      "使用建议：\n" +
      "- 每次搜索前先用 think 工具构思最优查询词\n" +
      "- 如果连续 2-3 次搜索无有用结果，切换到其他方法\n" +
      "- 对于学术文献，尝试搜索论文标题或作者名，而非宽泛关键词\n" +
      "- 如果返回了相关 URL 但摘要信息不足，使用 web_fetch 工具访问该 URL 获取完整页面内容\n" +
      "- 搜索到有用链接后，应立即用 web_fetch 获取详细内容再做分析",
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
            return { error: true, message: "Web search (Serper) is not configured. Set SERPER_API_KEY environment variable.", suggestion: "Try using browser tool to visit a URL directly instead." };
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
            return { error: true, message: `Search request failed: HTTP ${resp.status}`, suggestion: "Search service unavailable. Try browser tool to visit a URL directly, or proceed with available information." };
          }

          const data = await resp.json() as {
            organic?: Array<{ title: string; link: string; snippet: string }>;
          };

          const results = (data.organic ?? []).slice(0, maxResults);
          if (results.length === 0) return `No results found for "${args.query}".`;

          return results
            .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.link}\n    ${r.snippet}`)
            .join("\n\n");
        } else if (backend === "minimax") {
          // MiniMax web search — read API key from DB provider settings
          const repos = await getRepos();
          const providerSettings = await repos.settings.getProviderSettings();
          const minimaxProvider = providerSettings.providers.find(
            (p: { id: string; enabled: boolean }) =>
              p.id.startsWith("minimax") && p.enabled,
          );

          if (!minimaxProvider?.apiKey) {
            return { error: true, message: "Web search (MiniMax) is not configured. Add a MiniMax provider with an API key in settings.", suggestion: "Try browser tool to visit a URL directly instead." };
          }

          const resp = await fetch("https://api.minimaxi.com/v1/web_search", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${minimaxProvider.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: args.query }),
            signal: AbortSignal.timeout(15000),
          });

          if (!resp.ok) {
            return { error: true, message: `Search request failed: HTTP ${resp.status}`, suggestion: "Search service unavailable. Try browser tool to visit a URL directly, or proceed with available information." };
          }

          const data = await resp.json() as {
            data?: {
              results?: Array<{
                title: string;
                url?: string;
                link?: string;
                content?: string;
                snippet?: string;
              }>;
            };
          };

          const rawResults = data.data?.results ?? [];
          const results = rawResults.slice(0, maxResults);
          if (results.length === 0) return `No results found for "${args.query}".`;

          return results
            .map((r, i) => {
              const link = r.url ?? r.link ?? "";
              const snippet = r.content ?? r.snippet ?? "";
              return `[${i + 1}] ${r.title}\n    ${link}\n    ${snippet}`;
            })
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
          return { error: true, message: `Search request timed out for "${args.query}".`, suggestion: "Search service is slow. Try a simpler query or use browser tool instead." };
        }
        return { error: true, message: `Search failed: ${err instanceof Error ? err.message : String(err)}`, suggestion: "Web search unavailable. Try browser tool or proceed with available information." };
      }
    },
  });

  // -----------------------------------------------------------------------
  // Web Fetch tool (multi-strategy URL fetcher)
  // -----------------------------------------------------------------------

  try {
    const { createWebFetchTool, setMiniMaxCredentials } = await import("./tools/web-fetch-tool.js");

    // Load MiniMax credentials from MCP server config for search fallback
    try {
      const repos = await getRepos();
      const mcpServersRaw = await repos.settings.get("mcp_servers");
      if (mcpServersRaw) {
        const servers = JSON.parse(mcpServersRaw) as Record<string, unknown>[];
        const minimaxServer = servers.find(
          (s) =>
            String(s.name ?? "").toLowerCase().includes("minimax") ||
            String(s.id ?? "").toLowerCase().includes("minimax"),
        );
        const env = minimaxServer?.env as Record<string, string> | undefined;
        if (env?.MINIMAX_API_KEY && env?.MINIMAX_API_HOST) {
          setMiniMaxCredentials(env.MINIMAX_API_KEY, env.MINIMAX_API_HOST);
          console.log("[ToolSetup] WebFetch: MiniMax search fallback configured");
        }
      }
    } catch {
      // Credentials not available — search fallback will be skipped
    }

    const webFetchTool = createWebFetchTool();
    registry.register({
      ...webFetchTool,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
    });
  } catch (err) {
    console.error("[ToolSetup] Failed to load web_fetch tool:", err instanceof Error ? err.message : String(err));
  }

  // -----------------------------------------------------------------------
  // Wikipedia API tool
  // -----------------------------------------------------------------------

  try {
    const { createWikipediaTool } = await import("./tools/wikipedia-tool.js");
    const wikipediaTool = createWikipediaTool();
    registry.register({
      ...wikipediaTool,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
    });
  } catch (err) {
    console.error("[ToolSetup] Failed to load wikipedia tool:", err instanceof Error ? err.message : String(err));
  }

  try {
    const { createYouTubeTool } = await import("./tools/youtube-tool.js");
    const youtubeTool = createYouTubeTool();
    registry.register({
      ...youtubeTool,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
    });
  } catch (err) {
    console.error("[ToolSetup] Failed to load youtube tool:", err instanceof Error ? err.message : String(err));
  }

  // -----------------------------------------------------------------------
  // Browser tool (Playwright-based, heavy — lazy loaded)
  // -----------------------------------------------------------------------

  try {
    const { createBrowserTool } = await import("./tools/browser-tool.js");
    const browserTool = createBrowserTool();
    registry.register({
      ...browserTool,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      shouldDefer: true,
    });
  } catch {
    // Playwright not available
  }

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
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    shouldDefer: true,
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
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    shouldDefer: true,
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
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    shouldDefer: true,
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
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    shouldDefer: true,
  });

  // -----------------------------------------------------------------------
  // tool_discover tool — discover and activate deferred tools
  // -----------------------------------------------------------------------
  // Allows the agent to find tools that were not included in the initial
  // tool definitions to save input tokens. The agent can search by keyword
  // or directly select tools by name.

  registry.register({
    name: "tool_discover",
    description:
      "搜索和发现可用工具。当你需要某个能力但当前工具列表中没有时，使用此工具搜索。" +
      "返回匹配工具的名称和简短描述。支持关键词搜索或直接选择（格式：select:tool_name）。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词，或使用 'select:tool_name' 直接选择（支持逗号分隔多个）",
        },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>) {
      const query = (input.query as string).trim();

      // All tools with descriptions for discovery
      const allTools: Record<string, string> = {
        think: "逐步思考推理（核心工具）",
        finish: "完成任务并返回结果（核心工具）",
        kb_search: "语义+关键词搜索知识库文档",
        wiki_browse: "浏览 Wiki 页面和文档列表",
        expand: "逐层展开文档内容（L0→L1→L2）",
        doc_grep: "正则搜索 Wiki 页面内容",
        report_generate: "生成结构化分析报告",
        timeline_build: "从文档内容构建时间线",
        push_content: "推送结构化内容到前端界面",
        agent_todo: "任务清单管理和进度跟踪",
        ask_user: "向用户提问并等待回答",
        read_file: "读取数据目录中的文件",
        write_file: "创建或覆盖文件",
        edit_file: "编辑文件（精确字符串替换）",
        grep: "在文件中搜索文本模式",
        glob: "按模式查找文件",
        bash: "执行 Shell 命令",
        run_sql: "执行 SQL 查询（只读）",
        web_search: "搜索网络获取信息",
        web_fetch: "获取指定 URL 的网页内容（轻量级 HTTP 请求）",
        browser: "无头浏览器：导航、截图、提取文本",
        tts_generate: "文本转语音",
        image_generate: "文本生成图片",
        video_generate: "文本生成视频",
        music_generate: "文本生成音乐",
        workflow_run: "启动多 Agent 并行工作流",
        skill_invoke: "调用用户自定义技能",
        list_skills: "列出可用的自定义技能",
        tool_discover: "搜索和发现可用工具",
        task_output: "获取后台任务的结果",
        send_message: "向其他 Agent 发送消息",
      };

      // Direct select mode
      if (query.startsWith("select:")) {
        const names = query.slice(7).split(",").map(n => n.trim()).filter(Boolean);
        const found: Array<{ name: string; description: string }> = [];
        const activateTools: string[] = [];
        for (const name of names) {
          if (allTools[name]) {
            found.push({ name, description: allTools[name] });
            // If this is a deferred tool, signal the runner to activate it
            if (DEFERRED_TOOLS.has(name)) {
              activateTools.push(name);
            }
          }
        }
        return {
          mode: "select",
          requested: names,
          found,
          message: found.length > 0
            ? `Found ${found.length} tool(s). You can now call these tools directly by name.`
            : "No matching tools found. Check spelling and try again.",
          ...(activateTools.length > 0 ? { __activate_tools__: activateTools } : {}),
        };
      }

      // Keyword search mode
      const lowerQuery = query.toLowerCase();
      const results = Object.entries(allTools)
        .filter(([name, desc]) => {
          const nameMatch = name.toLowerCase().includes(lowerQuery);
          const descMatch = desc.toLowerCase().includes(lowerQuery);
          return nameMatch || descMatch;
        })
        .map(([name, description]) => ({ name, description }))
        .slice(0, 10);

      return {
        mode: "search",
        query,
        results,
        totalAvailable: Object.keys(allTools).length,
        hint: results.length === 0
          ? "No matches found. Try broader keywords or use 'select:tool_name' for exact match."
          : undefined,
      };
    },
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  });

  // -----------------------------------------------------------------------
  // task_output tool — get result from a background task
  // -----------------------------------------------------------------------

  registry.register({
    name: "task_output",
    description:
      "获取后台任务的结果。当 workflow_run 使用后台模式启动的子Agent完成时，" +
      "用此工具获取其输出结果。也可用于查询任何已知任务 ID 的状态。",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "后台任务的 ID",
        },
      },
      required: ["task_id"],
    },
    async execute(input: Record<string, unknown>) {
      const taskId = input.task_id as string;
      try {
        const repos = await getRepos();
        const task = await repos.agentTask.get(taskId);
        if (!task) {
          return { error: `Task ${taskId} not found.` };
        }
        return {
          taskId: task.id,
          agentType: task.agentType,
          status: task.status,
          output: task.output ?? null,
          error: task.error ?? null,
          createdAt: task.createdAt,
          completedAt: task.completedAt ?? null,
        };
      } catch (err) {
        return { error: `Failed to get task: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // -----------------------------------------------------------------------
  // send_message tool — send messages between agents in a workflow
  // -----------------------------------------------------------------------

  registry.register({
    name: "send_message",
    description:
      "在工作流中向其他 Agent 发送消息。支持定向发送（指定目标 Agent ID）和广播（target='all'）。" +
      "接收方 Agent 可以在其消息队列中读取消息。" +
      "仅在使用 workflow_run 的 graph 或 parallel 模式时可用。",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "目标 Agent ID，或 'all' 广播给所有其他 Agent",
        },
        message: {
          type: "string",
          description: "要发送的消息内容",
        },
      },
      required: ["target", "message"],
    },
    async execute(input: Record<string, unknown>) {
      const target = input.target as string;
      const message = input.message as string;

      // Store message via execution context mailbox
      const ctx = registry.getExecutionContext();
      const mailbox = ctx.mailbox as Map<string, Array<{ from: string; message: string; timestamp: string }>> | undefined;

      if (!mailbox) {
        return { error: "Mailbox not available. send_message only works within workflow_run graph/parallel mode." };
      }

      const myId = ctx.agentId as string ?? "unknown";
      const envelope = {
        from: myId,
        message,
        timestamp: new Date().toISOString(),
      };

      if (target === "all") {
        // Broadcast to all agents except self
        let count = 0;
        for (const [agentId, queue] of mailbox.entries()) {
          if (agentId !== myId) {
            queue.push(envelope);
            count++;
          }
        }
        return { delivered: count, mode: "broadcast" };
      } else {
        // Direct message
        if (!mailbox.has(target)) {
          mailbox.set(target, []);
        }
        mailbox.get(target)!.push(envelope);
        return { delivered: 1, mode: "direct", target };
      }
    },
  });

  // Register universal tools
  const { UNIVERSAL_TOOLS } = await import("./tools/universal-tools.js");
  for (const tool of UNIVERSAL_TOOLS) {
    registry.register(tool);
  }

  // Auto-load plugins from plugins/ directory
  try {
    const pluginManager = new AgentPluginManager();
    const pluginsDir = join(process.cwd(), "plugins");
    const { readdir } = await import("fs/promises");
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = join(pluginsDir, entry.name);
        try {
          await pluginManager.loadPlugin(pluginPath);
        } catch (err) {
          console.warn(`[ToolSetup] Failed to load plugin ${entry.name}:`, err);
        }
      }
    }
    // Register plugin skills into the registry
    // For now, just log loaded plugins - actual skill execution integration
    // will be handled through skill_invoke tool
    const skills = pluginManager.getAllSkills();
    if (skills.length > 0) {
      console.log(`[ToolSetup] Loaded ${skills.length} skills from plugins`);
    }
  } catch {
    // plugins/ directory doesn't exist - that's fine
  }

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
  const workflowTool = createWorkflowRunTool({
    runner: deps.runner,
    toolRegistry: deps.toolRegistry,
    onEvent: deps.emitWs,
  });
  registry.register({
    ...workflowTool,
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  });
}
