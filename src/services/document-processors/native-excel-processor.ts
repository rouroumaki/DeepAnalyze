/**
 * Native Excel Processor – uses the `xlsx` npm package to extract content
 * from Excel files without requiring the Docling Python service.
 *
 * Strategy:
 * - ALL tables: generate metadata description only (sheet info, headers, sample rows, file path)
 * - Agent uses bash+pandas to analyze source files directly
 * - No CSV content stored in wiki pages (avoids NULL byte encoding issues with PostgreSQL)
 */

import { readFileSync, statSync } from "node:fs";
import type { DocumentProcessor, ParsedContent } from "./types.js";

interface SheetInfo {
  name: string;
  rowCount: number;
  colCount: number;
  headers: string[];
  sampleRows: string[][];
  dataTypes: string[];
}

export class NativeExcelProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set(["xlsx", "xls"]);

  canHandle(fileType: string): boolean {
    return NativeExcelProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "excel_native_parsing";
  }

  async parse(filePath: string): Promise<ParsedContent> {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(readFileSync(filePath), { type: "buffer" });
      const fileSize = statSync(filePath).size;

      const sheets: SheetInfo[] = [];
      let totalRows = 0;

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        // Use sheet_to_json with header:1 to get row arrays
        // This avoids NULL bytes that sheet_to_csv/sheet_to_txt may produce
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        const rowCount = jsonData.length;
        totalRows += rowCount;

        const headers = (jsonData[0] ?? []).map((h: any) => String(h ?? "").trim());
        const colCount = headers.length;

        // Extract sample rows (up to 5 rows after header)
        const sampleRows: string[][] = [];
        for (let i = 1; i <= Math.min(5, jsonData.length - 1); i++) {
          sampleRows.push(
            headers.map((_, colIdx) => {
              const val = jsonData[i]?.[colIdx];
              return val != null ? String(val).trim() : "";
            }),
          );
        }

        // Infer data types from sample
        const dataTypes = headers.map((_: string, colIdx: number) => {
          const values = sampleRows.map((r) => r[colIdx]).filter(Boolean);
          if (values.length === 0) return "unknown";
          const allNum = values.every((v) => !isNaN(Number(v)));
          if (allNum) return "number";
          return "text";
        });

        sheets.push({
          name: sheetName,
          rowCount,
          colCount,
          headers,
          sampleRows,
          dataTypes,
        });
      }

      // Always use metadata-only approach — no CSV stored in wiki pages
      const metadataDescription = this.buildMetadataDescription(
        sheets,
        filePath,
        fileSize,
        totalRows,
      );

      return {
        text: metadataDescription,
        metadata: {
          sourceType: "excel_native",
          sheetCount: workbook.SheetNames.length,
          sheetNames: workbook.SheetNames,
          totalRows,
          isSmallTable: totalRows <= 1000,
          sheets: sheets.map((s) => ({
            name: s.name,
            rowCount: s.rowCount,
            colCount: s.colCount,
            headers: s.headers,
            sampleRows: s.sampleRows,
            dataTypes: s.dataTypes,
          })),
          filePath,
          fileSize,
        },
        success: true,
        modality: "excel",
      };
    } catch (err) {
      return {
        text: "",
        metadata: { sourceType: "excel_native" },
        success: false,
        error: `Excel 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        modality: "excel",
      };
    }
  }

  /**
   * Build a structured metadata description for the spreadsheet.
   * This serves as the knowledge base content and provides enough info for Agent to:
   * 1. Determine if the table is relevant to their query
   * 2. Use bash+pandas to analyze the actual data
   */
  private buildMetadataDescription(
    sheets: SheetInfo[],
    filePath: string,
    fileSize: number,
    totalRows: number,
  ): string {
    const parts: string[] = [];

    parts.push("# 表格文件信息");
    parts.push("");
    parts.push(`| 属性 | 值 |`);
    parts.push(`|------|-----|`);
    parts.push(`| 文件路径 | \`${filePath}\` |`);
    parts.push(`| 文件大小 | ${(fileSize / 1024 / 1024).toFixed(2)} MB |`);
    parts.push(`| 工作表数量 | ${sheets.length} |`);
    parts.push(`| 总行数 | ${totalRows.toLocaleString()} |`);
    parts.push(`| 数据规模 | ${totalRows <= 1000 ? "小型（<=1000行）" : "大型（>1000行，请使用 pandas 分析源文件）"} |`);
    parts.push("");

    for (const sheet of sheets) {
      parts.push(`## 工作表: ${sheet.name}`);
      parts.push("");
      parts.push(`- 行数: ${sheet.rowCount.toLocaleString()}`);
      parts.push(`- 列数: ${sheet.colCount}`);
      parts.push("");

      if (sheet.headers.length > 0) {
        parts.push("### 列定义");
        parts.push("");
        parts.push("| 列名 | 数据类型 |");
        parts.push("|------|---------|");
        for (let i = 0; i < sheet.headers.length; i++) {
          parts.push(`| ${sheet.headers[i]} | ${sheet.dataTypes[i] || "unknown"} |`);
        }
        parts.push("");
      }

      if (sheet.sampleRows.length > 0) {
        parts.push("### 样本数据（前5行）");
        parts.push("");
        // Header row
        parts.push("| " + sheet.headers.join(" | ") + " |");
        parts.push("| " + sheet.headers.map(() => "---").join(" | ") + " |");
        // Sample rows
        for (const row of sheet.sampleRows) {
          const cells = sheet.headers.map((_, i) => row[i] ?? "");
          parts.push("| " + cells.join(" | ") + " |");
        }
        parts.push("");
      }

      parts.push(`> Agent 可通过 \`bash\` 工具使用 Python + pandas 读取源文件进行分析：`);
      parts.push(`> \`\`\`python`);
      parts.push(`> import pandas as pd`);
      parts.push(`> df = pd.read_excel('${filePath}', sheet_name='${sheet.name}')`);
      parts.push(`> print(df.head())`);
      parts.push(`> \`\`\``);
      parts.push("");
    }

    return parts.join("\n");
  }
}
