import type { DocumentProcessor, ParsedContent } from "./types.js";
import { TextProcessor } from "./text-processor.js";
import { DoclingProcessor } from "./docling-processor.js";
import { NativeExcelProcessor } from "./native-excel-processor.js";
import { ImageProcessor } from "./image-processor.js";
import { AudioProcessor } from "./audio-processor.js";
import { VideoProcessor } from "./video-processor.js";

export class ProcessorFactory {
  private processors: DocumentProcessor[];
  private static instance: ProcessorFactory | null = null;

  private constructor() {
    this.processors = [
      // Priority 1: Native Excel — handles xlsx/xls natively to avoid
      // Docling issues with large spreadsheets (timeouts, memory)
      new NativeExcelProcessor(),
      // Priority 2: Video (not supported by Docling)
      new VideoProcessor(),
      // Priority 3: Image — VLM visual description + Docling OCR + EXIF + thumbnail
      // (ImageProcessor internally calls Docling for OCR, so it provides richer output)
      new ImageProcessor(),
      // Priority 4: Docling handles remaining supported formats (PDF, DOCX, etc.)
      new DoclingProcessor(),
      // Priority 5: Audio fallback (ASR with speaker diarization)
      new AudioProcessor(),
      // Priority 6: Text formats not handled by Docling (json, xml, rtf, epub, etc.)
      new TextProcessor(),
    ];
  }

  static getInstance(): ProcessorFactory {
    if (!ProcessorFactory.instance) {
      ProcessorFactory.instance = new ProcessorFactory();
    }
    return ProcessorFactory.instance;
  }

  getProcessor(fileType: string): DocumentProcessor {
    const processor = this.processors.find(p => p.canHandle(fileType));
    // Default to DoclingProcessor for unknown types
    return processor ?? this.processors.find(p => p instanceof DoclingProcessor) ?? this.processors[0];
  }

  async parse(filePath: string, fileType: string): Promise<ParsedContent> {
    const processor = this.getProcessor(fileType);
    return processor.parse(filePath);
  }

  /**
   * Parse with automatic fallback chain.
   * If the primary processor fails, tries the next matching processor.
   * This enables graceful degradation (e.g., Docling audio fail → ASR fallback).
   */
  async parseWithFallback(filePath: string, fileType: string): Promise<ParsedContent> {
    // Find all processors that can handle this file type
    const candidates = this.processors.filter(p => p.canHandle(fileType));

    if (candidates.length === 0) {
      // No handler found — try Docling as universal fallback
      const docling = this.processors.find(p => p instanceof DoclingProcessor);
      if (docling) return docling.parse(filePath);
      return {
        text: "",
        metadata: {},
        success: false,
        error: `No processor available for file type: ${fileType}`,
      };
    }

    // Try each candidate in priority order
    let lastError: string | undefined;
    for (const processor of candidates) {
      try {
        const result = await processor.parse(filePath);
        if (result.success && result.text.trim().length > 0) {
          return result;
        }
        // Empty content is treated as failure — try next processor
        if (result.success && result.text.trim().length === 0) {
          lastError = `${processor.getStepLabel()} returned empty content`;
          console.warn(
            `[ProcessorFactory] ${processor.getStepLabel()} returned empty content for ${fileType}, trying fallback...`,
          );
          continue;
        }
        // Processor handled the request but reported failure — try next
        lastError = result.error;
        console.warn(
          `[ProcessorFactory] ${processor.getStepLabel()} failed for ${fileType}: ${result.error}, trying fallback...`,
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ProcessorFactory] ${processor.getStepLabel()} threw for ${fileType}: ${lastError}, trying fallback...`,
        );
      }
    }

    // All candidates failed
    return {
      text: "",
      metadata: {},
      success: false,
      error: lastError ?? `All processors failed for file type: ${fileType}`,
    };
  }

  /**
   * Parse with a specific processing channel (bypasses auto-detection).
   * channel: "docling" | "native" | "asr" | "auto"
   */
  async parseWithChannel(filePath: string, fileType: string, channel: string): Promise<ParsedContent> {
    if (channel === "auto") {
      return this.parseWithFallback(filePath, fileType);
    }

    // Map channel names to processor types
    const channelMap: Record<string, (p: DocumentProcessor) => boolean> = {
      docling: (p) => p instanceof DoclingProcessor,
      native: (p) => p instanceof TextProcessor || p instanceof NativeExcelProcessor,
      asr: (p) => p instanceof AudioProcessor,
    };

    const matcher = channelMap[channel];
    if (!matcher) {
      return this.parseWithFallback(filePath, fileType);
    }

    // Find the requested processor
    const processor = this.processors.find(p => matcher(p) && p.canHandle(fileType));
    if (!processor) {
      // Fall back to any processor matching the channel regardless of file type
      const anyProcessor = this.processors.find(p => matcher(p));
      if (anyProcessor) return anyProcessor.parse(filePath);
      return this.parseWithFallback(filePath, fileType);
    }

    return processor.parse(filePath);
  }
}
