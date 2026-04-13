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
    // Import the existing parse function from knowledge.ts
    const { parseDocumentFile } = await import("../../server/routes/knowledge.js");
    const text = await parseDocumentFile(filePath, this.detectType(filePath));
    return { text, metadata: { sourceType: "docling" }, success: true };
  }

  private detectType(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = { pdf: "pdf", docx: "docx", doc: "doc", pptx: "pptx", ppt: "ppt", xlsx: "xlsx", xls: "xls", png: "image", jpg: "image", jpeg: "image" };
    return map[ext] ?? "unknown";
  }
}
