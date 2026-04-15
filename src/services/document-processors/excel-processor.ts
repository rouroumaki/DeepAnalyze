// =============================================================================
// DeepAnalyze - Excel Processor
// Uses Docling to extract raw table data, then sub-model (summarizer) to
// generate a structural summary of the spreadsheet content.
// =============================================================================

import type { DocumentProcessor, ParsedContent } from "./types.js";

export class ExcelProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set(["xlsx", "xls"]);

  canHandle(fileType: string): boolean {
    return ExcelProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "excel_analysis";
  }

  async parse(filePath: string): Promise<ParsedContent> {
    // 1. Use docling to extract raw table content
    let rawContent: string;
    let doclingRaw: Record<string, unknown> | undefined;
    let doclingDoctags: string | undefined;
    try {
      const { parseDocumentFile } = await import("../../server/routes/knowledge.js");
      const result = await parseDocumentFile(filePath, "xlsx");

      // Check if Docling returned rich result with raw/doctags
      if (typeof result === "object" && result !== null && "raw" in result) {
        const rich = result as Record<string, unknown>;
        rawContent = String(rich.text ?? rich.content ?? "");
        doclingRaw = rich.raw as Record<string, unknown> | undefined;
        doclingDoctags = rich.doctags as string | undefined;
      } else {
        rawContent = String(result);
      }
    } catch (err) {
      return {
        text: "",
        metadata: { sourceType: "excel" },
        success: false,
        error: `Docling extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        modality: "excel",
      };
    }

    // 2. Try to use sub-model for structural summary
    let structuredSummary: string;
    try {
      const { ModelRouter } = await import("../../models/router.js");
      const router = new ModelRouter();
      await router.initialize();
      const defaultModel = router.getDefaultModel("summarizer");

      if (defaultModel) {
        const result = await router.chat(
          [
            {
              role: "user",
              content: `分析以下Excel表格数据，生成结构化摘要：
1. 表格概述（用途、数据范围）
2. 列定义（列名、数据类型、示例值）
3. 数据统计（行数、关键统计值）
4. 数据特征（排序方式、缺失值、异常值）

原始数据（前20行）：
${rawContent.slice(0, 4000)}`,
            },
          ],
          { model: defaultModel },
        );
        structuredSummary = result.content;
      } else {
        structuredSummary = rawContent;
      }
    } catch {
      // Fallback: just use raw content
      structuredSummary = rawContent;
    }

    return {
      text: structuredSummary,
      metadata: { sourceType: "excel", rawContent: rawContent.slice(0, 8000) },
      success: true,
      raw: doclingRaw,
      doctags: doclingDoctags,
      modality: "excel",
    };
  }
}
