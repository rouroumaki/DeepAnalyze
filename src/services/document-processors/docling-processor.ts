import { resolve } from "node:path";
import type { DocumentProcessor, ParsedContent } from "./types.js";

export class DoclingProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set(["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "image"]);

  canHandle(fileType: string): boolean {
    return DoclingProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "docling_parsing";
  }

  async parse(filePath: string): Promise<ParsedContent> {
    // Directly use DoclingClient to get raw/doctags alongside content
    const { SubprocessManager } = await import("../../subprocess/manager.js");
    const { startDocling, parseWithDocling } = await import("../../subprocess/docling-client.js");

    const dataDir = process.env.DATA_DIR ?? "data";
    const projectRoot = resolve(dataDir, "..");

    const mgr = new SubprocessManager();
    try {
      await startDocling(projectRoot, mgr);
      const result = await parseWithDocling(mgr, filePath, {
        ocr: true,
        extract_tables: true,
      });

      return {
        text: result.content,
        metadata: { sourceType: "docling" },
        success: true,
        raw: result.raw,
        doctags: result.doctags,
        modality: "document",
      };
    } finally {
      try { await mgr.stop("docling"); } catch { /* ignore */ }
    }
  }
}
