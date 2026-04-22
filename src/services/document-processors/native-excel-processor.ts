/**
 * Native Excel Processor – uses the `xlsx` npm package to extract content
 * from Excel files without requiring the Docling Python service.
 *
 * Falls back gracefully if xlsx is not available.
 */

import { readFileSync } from "node:fs";
import type { DocumentProcessor, ParsedContent } from "./types.js";

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

      const parts: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        // Get sheet as CSV for structured data
        const csv = XLSX.utils.sheet_to_csv(sheet);
        // Get sheet as text for readability
        const text = XLSX.utils.sheet_to_txt(sheet);

        const rowCount = text.split("\n").filter((l: string) => l.trim()).length;
        const colCount = text.split("\n")[0]?.split("\t").length ?? 0;

        parts.push(
          `## 工作表: ${sheetName}\n`,
          `行数: ${rowCount}, 列数: ${colCount}\n\n`,
          csv,
          "\n",
        );
      }

      const content = parts.join("\n");

      return {
        text: content,
        metadata: {
          sourceType: "excel_native",
          sheetCount: workbook.SheetNames.length,
          sheetNames: workbook.SheetNames,
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
}
