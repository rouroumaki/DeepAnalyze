import type { DocumentProcessor, ParsedContent } from "./types.js";
import { TextProcessor } from "./text-processor.js";
import { DoclingProcessor } from "./docling-processor.js";
import { ExcelProcessor } from "./excel-processor.js";
import { ImageProcessor } from "./image-processor.js";
import { AudioProcessor } from "./audio-processor.js";
import { VideoProcessor } from "./video-processor.js";

export class ProcessorFactory {
  private processors: DocumentProcessor[];
  private static instance: ProcessorFactory | null = null;

  private constructor() {
    this.processors = [
      // Specialized processors first (higher priority)
      // ExcelProcessor handles xlsx/xls before DoclingProcessor
      new ExcelProcessor(),
      // ImageProcessor handles image types before DoclingProcessor
      new ImageProcessor(),
      // AudioProcessor handles audio types (no Docling overlap)
      new AudioProcessor(),
      // VideoProcessor handles video types (no Docling overlap)
      new VideoProcessor(),
      // TextProcessor handles plain text (cheapest)
      new TextProcessor(),
      // DoclingProcessor is the fallback for anything else it supports
      new DoclingProcessor(),
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
    // Default to DoclingProcessor (last in list) for unknown types
    return processor ?? this.processors[this.processors.length - 1];
  }

  async parse(filePath: string, fileType: string): Promise<ParsedContent> {
    const processor = this.getProcessor(fileType);
    return processor.parse(filePath);
  }
}
