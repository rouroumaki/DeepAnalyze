export interface ParsedContent {
  text: string;
  metadata: Record<string, unknown>;
  success: boolean;
  error?: string;
  /** Full DoclingDocument JSON from Docling parsing. */
  raw?: Record<string, unknown>;
  /** DocTags text representation from Docling. */
  doctags?: string;
  /** Document modality type. */
  modality?: 'document' | 'image' | 'audio' | 'video' | 'excel';
}

export interface DocumentProcessor {
  canHandle(fileType: string): boolean;
  parse(filePath: string, options?: Record<string, unknown>): Promise<ParsedContent>;
  getStepLabel(): string;
}
