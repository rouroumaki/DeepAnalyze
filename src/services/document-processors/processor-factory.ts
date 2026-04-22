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
      // Priority 3: Docling handles remaining supported formats (PDF, DOCX, etc.)
      new DoclingProcessor(),
      // Fallback chain for other modalities
      new ImageProcessor(),
      new AudioProcessor(),
      // Text formats not handled by Docling (json, xml, rtf, epub, etc.)
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
}
