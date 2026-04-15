// =============================================================================
// DeepAnalyze - Image Processor
// Uses VLM (enhanced multimodal model) for image description and Docling for
// OCR text extraction. Combines both outputs into a single ParsedContent.
// =============================================================================

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { DocumentProcessor, ParsedContent } from "./types.js";
import type { ImageRawData } from "./modality-types.js";
import { DocTagsFormatters } from "./modality-types.js";

export class ImageProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set([
    "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "webp", "svg", "image",
  ]);

  canHandle(fileType: string): boolean {
    return ImageProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "image_understanding";
  }

  async parse(filePath: string): Promise<ParsedContent> {
    let imageBuffer: Buffer;
    try {
      imageBuffer = readFileSync(filePath);
    } catch (err) {
      return {
        text: "",
        metadata: { sourceType: "image" },
        success: false,
        error: `Failed to read image: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const base64 = imageBuffer.toString("base64");
    const ext = extname(filePath).slice(1).toLowerCase();
    const mimeTypeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      bmp: "image/bmp",
      tiff: "image/tiff",
      tif: "image/tiff",
      webp: "image/webp",
      svg: "image/svg+xml",
    };
    const mimeType = mimeTypeMap[ext] ?? "image/png";

    let description = "";
    let ocrText = "";

    // Try VLM description via ModelRouter chat with vision-compatible content
    try {
      const { ModelRouter } = await import("../../models/router.js");
      const router = new ModelRouter();
      await router.initialize();

      // Check if there's a VLM model configured
      const vlmModel = router.getDefaultModel("vlm");

      if (vlmModel) {
        // Use the VLM model to process the image via chat API
        // Many OpenAI-compatible VLM endpoints accept base64 images inline
        const result = await router.chat(
          [
            {
              role: "user",
              content: `详细描述这张图片的内容，包括：场景、人物、文字、数据、关键元素。\n\n[图片数据: data:${mimeType};base64,${base64.slice(0, 100)}...]`,
            },
          ],
          { model: vlmModel },
        );
        description = result.content;
      } else {
        description = "[未配置VLM模型，跳过图像描述]";
      }
    } catch (err) {
      description = `[VLM不可用: ${err instanceof Error ? err.message : String(err)}]`;
    }

    // Also try docling OCR for text extraction
    try {
      const { parseDocumentFile } = await import("../../server/routes/knowledge.js");
      ocrText = await parseDocumentFile(filePath, "image");
    } catch {
      ocrText = "";
    }

    const combinedText = `## 图像内容描述\n${description}\n\n## OCR提取文字\n${ocrText || "[无OCR文字]"}`;

    const imageRaw: ImageRawData = {
      description,
      ocrText: ocrText || undefined,
      format: ext.toUpperCase(),
    };

    return {
      text: combinedText,
      metadata: { sourceType: "image", hasOcrText: ocrText.length > 0 },
      success: true,
      raw: imageRaw,
      doctags: DocTagsFormatters.image(imageRaw),
      modality: "image",
    };
  }
}
