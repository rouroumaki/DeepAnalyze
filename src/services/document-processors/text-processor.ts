import { readFileSync } from "node:fs";
import type { DocumentProcessor, ParsedContent } from "./types.js";

export class TextProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set(["txt", "markdown", "csv", "json", "html", "xml", "rtf", "odt", "epub"]);

  canHandle(fileType: string): boolean {
    return TextProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "reading";
  }

  async parse(filePath: string): Promise<ParsedContent> {
    const content = readFileSync(filePath, "utf-8");
    return { text: content, metadata: { sourceType: "text", charCount: content.length }, success: true };
  }
}
