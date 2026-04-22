// =============================================================================
// DeepAnalyze - Report Generation Tool
// =============================================================================
// Accepts agent-synthesized content and saves it as a structured report wiki
// page. The agent is responsible for analyzing and synthesizing knowledge base
// content; this tool handles persistence, formatting, and citation anchoring.
// =============================================================================

import { join } from "node:path";
import { getRepos } from "../../store/repos/index.js";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import type { AgentTool } from "../../services/agent/types.js";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReportToolDeps {
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

type ReportType = "analysis" | "summary" | "comparison" | "investigation";

interface ReportResult {
  reportId: string;
  title: string;
  content: string;
  sourceCount: number;
  reportType: ReportType;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createReportTool(deps: ReportToolDeps): AgentTool {
  return {
    name: "report_generate",
    description:
      "将你已经分析和合成的报告内容保存为正式报告。你必须先将知识库内容深度分析和综合整理为完整的报告文本，" +
      "然后通过此工具保存。报告内容应是你自己的分析和综合，而不是原始文档片段的堆砌。" +
      "你可以在报告中使用 [[doc:文档ID]] 或 [[page:页面ID]] 标记来引用来源。" +
      "返回报告 ID 和预览内容。",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "报告标题",
        },
        content: {
          type: "string",
          description:
            "报告正文内容（Markdown 格式）。这是你经过深度分析和综合整理的完整报告文本，" +
            "应包含完整的分析、论证、结论和建议，而不是原始文档片段。",
        },
        kbId: {
          type: "string",
          description: "关联的知识库 ID",
        },
        reportType: {
          type: "string",
          enum: ["analysis", "summary", "comparison", "investigation"],
          "description": "报告类型（默认：analysis）",
        },
        sourceDocIds: {
          type: "array",
          items: { type: "string" },
          description: "报告中引用的来源文档 ID 列表（可选，用于溯源追踪）",
        },
      },
      required: ["title", "content", "kbId"],
    },
    async execute(input: Record<string, unknown>): Promise<ReportResult | { error: string }> {
      try {
        const title = input.title as string;
        const agentContent = input.content as string;
        const kbId = input.kbId as string;
        const reportType = (input.reportType as ReportType) || "analysis";
        const sourceDocIds = (input.sourceDocIds as string[] | undefined) || [];

        if (!agentContent || agentContent.trim().length === 0) {
          return { error: "报告内容不能为空。请提供你分析和综合整理的完整报告文本。" };
        }

        // -------------------------------------------------------------------
        // 1. Build report markdown
        // -------------------------------------------------------------------

        const reportLines: string[] = [];

        // Title header
        reportLines.push(`# ${title}`);
        reportLines.push("");
        reportLines.push(`> Report Type: ${reportType} | Generated: ${new Date().toISOString()}`);
        reportLines.push("");
        reportLines.push("---");
        reportLines.push("");

        // Agent-synthesized content (the actual report body)
        reportLines.push(agentContent);
        reportLines.push("");

        // Source references section (only if sourceDocIds were provided)
        if (sourceDocIds.length > 0) {
          reportLines.push("---");
          reportLines.push("");
          reportLines.push("## 参考文献");
          reportLines.push("");

          // Resolve source document titles
          try {
            const repos = await getRepos();
            for (let i = 0; i < sourceDocIds.length; i++) {
              const docId = sourceDocIds[i];
              try {
                const doc = await repos.document.getById(docId);
                const docTitle = doc?.filename || docId;
                reportLines.push(`${i + 1}. [[doc:${docId}|${docTitle}]]`);
              } catch {
                reportLines.push(`${i + 1}. [[doc:${docId}]]`);
              }
            }
          } catch {
            // If repo access fails, just list IDs
            sourceDocIds.forEach((id, i) => {
              reportLines.push(`${i + 1}. [[doc:${id}]]`);
            });
          }
          reportLines.push("");
        }

        // Footer
        reportLines.push("---");
        reportLines.push("");

        const reportContent = reportLines.join("\n");

        // -------------------------------------------------------------------
        // 2. Save as wiki page
        // -------------------------------------------------------------------

        const wikiDir = join(deps.dataDir, "wiki");
        const pageId = randomUUID();
        const filePath = join(wikiDir, kbId, "reports", `${pageId}.md`);
        mkdirSync(join(wikiDir, kbId, "reports"), { recursive: true });
        writeFileSync(filePath, reportContent, "utf-8");

        const contentHash = createHash("md5").update(reportContent).digest("hex");
        const tokenCount = Math.ceil(reportContent.length / 4);

        const repos = await getRepos();
        const page = await repos.wikiPage.create({
          kb_id: kbId,
          doc_id: undefined,
          page_type: "report",
          title,
          content: reportContent,
          file_path: filePath,
          content_hash: contentHash,
          token_count: tokenCount,
        });

        // -------------------------------------------------------------------
        // 3. Return result
        // -------------------------------------------------------------------

        return {
          reportId: page.id,
          title,
          content: reportContent,
          sourceCount: sourceDocIds.length,
          reportType,
        };
      } catch (err) {
        return {
          error: `Report generation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
