export interface ParsedContent {
  text: string;
  metadata: Record<string, unknown>;
  success: boolean;
  error?: string;
}

export interface DocumentProcessor {
  canHandle(fileType: string): boolean;
  parse(filePath: string, options?: Record<string, unknown>): Promise<ParsedContent>;
  getStepLabel(): string;
}
