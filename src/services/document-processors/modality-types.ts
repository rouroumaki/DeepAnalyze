// =============================================================================
// DeepAnalyze - Modality Raw Data Types & DocTags Formatters
// Defines structured data interfaces for each modality and utilities
// for generating DocTags format text used in Structure layer compilation.
// =============================================================================

// ---------------------------------------------------------------------------
// Raw data interfaces per modality
// ---------------------------------------------------------------------------

/** Image raw data from VLM description + OCR extraction. */
export interface ImageRawData {
  description: string;
  ocrText?: string;
  width?: number;
  height?: number;
  format?: string;
  exif?: Record<string, unknown>;
}

/** A single speaker turn in audio transcription. */
export interface SpeakerTurn {
  speaker: string;
  startTime: number;
  endTime: number;
  text: string;
}

/** Audio raw data from ASR transcription with speaker diarization. */
export interface AudioRawData {
  duration: number;
  speakers: Array<{
    id: string;
    label: string;
  }>;
  turns: SpeakerTurn[];
}

/** A video keyframe with timestamp and visual description. */
export interface VideoKeyframe {
  time: number;
  description: string;
}

/** Video raw data combining keyframe descriptions and audio transcript. */
export interface VideoRawData {
  duration: number;
  resolution?: string;
  fps?: number;
  keyframes: VideoKeyframe[];
  transcript: AudioRawData;
}

/** Excel sheet table summary for structured metadata. */
export interface ExcelTableSummary {
  sheetName: string;
  tableIndex: number;
  headers: string[];
  rowCount: number;
  colCount: number;
}

// ---------------------------------------------------------------------------
// DocTags formatters
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const DocTagsFormatters = {
  /** Format image raw data as DocTags. */
  image(raw: ImageRawData): string {
    const parts: string[] = [];
    parts.push(`[img] 视觉描述: ${raw.description}`);
    if (raw.ocrText) {
      parts.push(`[ocr] 文本内容: ${raw.ocrText}`);
    }
    if (raw.width && raw.height) {
      parts.push(`[meta] ${raw.width}x${raw.height}${raw.format ? `, ${raw.format}` : ''}`);
    }
    return parts.join('\n');
  },

  /** Format a single audio speaker turn as DocTags. */
  audioTurn(turn: SpeakerTurn): string {
    const timeStr = `${formatTime(turn.startTime)}-${formatTime(turn.endTime)}`;
    return `[p](speaker=${turn.speaker};time=${timeStr}) ${turn.text}`;
  },

  /** Format a video scene with related dialog turns as DocTags. */
  videoScene(keyframe: VideoKeyframe, turns: SpeakerTurn[]): string {
    const parts: string[] = [];
    parts.push(`[scene](time=${formatTime(keyframe.time)}) ${keyframe.description}`);
    for (const turn of turns) {
      parts.push(`[dialog](speaker=${turn.speaker};time=${formatTime(turn.startTime)}) ${turn.text}`);
    }
    return parts.join('\n');
  },
};

/** Re-export formatTime for use in modality compilers. */
export { formatTime };
