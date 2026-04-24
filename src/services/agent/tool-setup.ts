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
      "结合向量相似度、BM25 全文搜索和链接遍历，实现全面检索。" +
      "默认排除已有报告（page_type=report），只返回原始文档内容，确保分析基于一手资料。",
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
  });

  // -----------------------------------------------------------------------
  // wiki_browse tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "wiki_browse",
    description:
      "浏览知识库中的文档和 Wiki 页面。" +
      "提供 listDocuments=true 列出所有文档及其摘要，" +
      "提供 pageId 查看特定页面，" +
      "提供 kbId 列出页面列表。" +
      "建议先使用 listDocuments 了解知识库中有哪些文档，再针对性地展开阅读。",
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
            return {
              docId: d.id,
              filename: d.filename,
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
      "支持批量展开：提供 docIds 数组可同时展开多个文档的 L1 结构概述。" +
      "每次调用返回 tokenCount 字段表示内容的 token 数量，可用于判断内容是否完整。",
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
          description: "批量展开多个文档 ID。返回每个文档的 L1 结构概述。适用于快速了解一批文档的内容。",
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
        // Mode 0: Batch expand multiple documents to L1
        if (Array.isArray(input.docIds) && input.docIds.length > 0) {
          const docIds = input.docIds as string[];
          const format = (input.format as "md" | "dt" | undefined) || "md";
          const results = await Promise.all(
            docIds.map(async (docId) => {
              try {
                const result = await deps.expander.expandToLevel(docId, "L1", format);
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
  // push_content tool — push structured data directly to user frontend
  // -----------------------------------------------------------------------

  registry.register({
    name: "push_content",
    description:
      "推送结构化内容到用户界面。适用于推送大型分析报告、表格数据、代码片段等。" +
      "type=markdown 的内容会以富文本格式直接展示在聊天界面中，适合推送最终分析结果。" +
      "type=table 适合推送 CSV/TSV 表格数据。" +
      "比通过模型逐字输出效率高得多。",
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
          description: "内容数据。table类型传入CSV或JSON字符串；code类型传入代码；text/markdown类型传入文本内容",
        },
        format: {
          type: "string",
          description: "格式提示（如 csv, json, python, sql, markdown 等）",
        },
      },
      required: ["type", "title", "data"],
    },
    async execute(input: Record<string, unknown>) {
      const contentType = input.type as string;
      const title = input.title as string;
      const data = input.data as string;
      const format = input.format as string | undefined;

      if (!data) {
        return { error: "No data provided" };
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
      "与 kb_search（语义搜索）互补，适用于需要精确字符串匹配的场景。",
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
  });

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
  // run_sql tool — execute SQL queries against the database
  // -----------------------------------------------------------------------

  registry.register({
    name: "run_sql",
    description:
      "执行 SQL 查询并返回结果。" +
      "用于直接查询文档元数据、wiki 页面内容、会话历史等数据库信息。" +
      "比 listDocuments 等高级工具更灵活精确，支持任意聚合、分组、过滤。" +
      "仅允许 SELECT 查询（只读）。",
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
        } else if (backend === "minimax") {
          // MiniMax web search — read API key from DB provider settings
          const repos = await getRepos();
          const providerSettings = await repos.settings.getProviderSettings();
          const minimaxProvider = providerSettings.providers.find(
            (p: { id: string; enabled: boolean }) =>
              p.id.startsWith("minimax") && p.enabled,
          );

          if (!minimaxProvider?.apiKey) {
            return "Web search (MiniMax) is not configured. Add a MiniMax provider with an API key in settings.";
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
            return `Search request failed: HTTP ${resp.status}`;
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
          return `Search request timed out for "${args.query}".`;
        }
        return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // -----------------------------------------------------------------------
  // Browser tool (Playwright-based)
  // -----------------------------------------------------------------------

  try {
    const { createBrowserTool } = await import("./tools/browser-tool.js");
    registry.register(createBrowserTool());
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
