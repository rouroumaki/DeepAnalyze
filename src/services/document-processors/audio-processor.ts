// =============================================================================
// DeepAnalyze - Audio Processor
// Uses ASR (Whisper API compatible) for audio transcription.
// Falls back gracefully when ASR is not configured.
// =============================================================================

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DocumentProcessor, ParsedContent } from "./types.js";
import type { AudioRawData } from "./modality-types.js";
import { DocTagsFormatters, formatTime } from "./modality-types.js";

export class AudioProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set([
    "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma",
  ]);

  canHandle(fileType: string): boolean {
    return AudioProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "transcription";
  }

  async parse(filePath: string): Promise<ParsedContent> {
    const duration = this.getDuration(filePath);
    const format = filePath.split(".").pop() ?? "unknown";
    const fileName = basename(filePath);

    let transcription = "";

    try {
      // Try to find an audio_transcribe enhanced model configuration
      const asrConfig = await this.getAsrConfig();

      if (asrConfig) {
        transcription = await this.callWhisperApi(filePath, asrConfig);
      } else {
        transcription =
          `[音频转写不可用 - 时长: ${duration}s, 格式: ${format}]\n\n` +
          `未配置ASR模型。请在"增强模型"中添加 audio_transcribe 类型的模型，` +
          `指向 OpenAI Whisper API 兼容端点。`;
      }
    } catch (err) {
      transcription =
        `[音频转写失败: ${err instanceof Error ? err.message : String(err)}]`;
    }

    // Build AudioRawData from transcription
    // When ASR provides plain text without speaker info, create a single-turn fallback
    const audioRaw: AudioRawData = {
      duration,
      speakers: [{ id: 'S', label: '说话者' }],
      turns: this.splitTranscriptionToTurns(transcription, duration),
    };

    const doctags = audioRaw.turns
      .map((turn) => DocTagsFormatters.audioTurn(turn))
      .join('\n');

    return {
      text: transcription,
      metadata: { sourceType: "audio", duration, format, fileName },
      success: true,
      raw: audioRaw,
      doctags,
      modality: "audio",
    };
  }

  /**
   * Split plain transcription text into time-windowed turns.
   * Used when ASR doesn't provide speaker diarization.
   */
  private splitTranscriptionToTurns(transcription: string, duration: number): Array<{
    speaker: string;
    startTime: number;
    endTime: number;
    text: string;
  }> {
    if (!transcription || transcription.startsWith('[')) {
      return [{
        speaker: 'S',
        startTime: 0,
        endTime: duration || 0,
        text: transcription,
      }];
    }

    // Split into ~30 second windows
    const windowSize = 30;
    const sentences = transcription.split(/[。！？\n]/).filter((s) => s.trim());
    const turns: Array<{ speaker: string; startTime: number; endTime: number; text: string }> = [];
    let currentText: string[] = [];
    let windowStart = 0;
    let charCount = 0;

    // Rough estimate: 4 chars per second for Chinese speech
    const charsPerSecond = 4;

    for (const sentence of sentences) {
      currentText.push(sentence.trim());
      charCount += sentence.length;
      const estimatedTime = charCount / charsPerSecond;

      if (estimatedTime - windowStart >= windowSize || sentence === sentences[sentences.length - 1]) {
        turns.push({
          speaker: 'S',
          startTime: windowStart,
          endTime: Math.min(estimatedTime, duration || estimatedTime),
          text: currentText.join('。'),
        });
        windowStart = estimatedTime;
        currentText = [];
      }
    }

    if (currentText.length > 0) {
      turns.push({
        speaker: 'S',
        startTime: windowStart,
        endTime: duration || windowStart + windowSize,
        text: currentText.join('。'),
      });
    }

    return turns.length > 0 ? turns : [{
      speaker: 'S',
      startTime: 0,
      endTime: duration || 0,
      text: transcription,
    }];
  }

  /**
   * Get the ASR (audio_transcribe) enhanced model configuration.
   * Returns endpoint, model, apiKey if configured, null otherwise.
   */
  private async getAsrConfig(): Promise<{
    endpoint: string;
    model: string;
    apiKey?: string;
  } | null> {
    try {
      const { SettingsStore } = await import("../../store/settings.js");
      const store = new SettingsStore();
      const models = store.getEnhancedModels();
      const asrModel = models.find(
        (m: Record<string, unknown>) =>
          m.modelType === "audio_transcribe" && m.enabled,
      );
      if (!asrModel) return null;

      // Get provider info for the endpoint and apiKey
      const providerId = asrModel.providerId as string | undefined;
      if (!providerId) {
        // Use the model's endpoint directly if available
        const endpoint = (asrModel as Record<string, unknown>).endpoint as string | undefined;
        const apiKey = (asrModel as Record<string, unknown>).apiKey as string | undefined;
        if (endpoint) return { endpoint, model: asrModel.model as string, apiKey };
        return null;
      }

      // Look up the provider's apiBase
      const provider = store.getProvider(providerId);
      if (provider) {
        return {
          endpoint: provider.endpoint || "https://api.openai.com/v1",
          model: asrModel.model as string,
          apiKey: provider.apiKey,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Call an OpenAI Whisper API compatible endpoint for transcription.
   * Uses multipart/form-data to upload the audio file.
   */
  private async callWhisperApi(
    filePath: string,
    config: { endpoint: string; model: string; apiKey?: string },
  ): Promise<string> {
    const fileBuffer = readFileSync(filePath);
    const fileName = basename(filePath);

    // Build multipart form data
    const boundary = `----FormBoundary${Date.now().toString(16)}`;
    const parts: Buffer[] = [];

    // Add file part
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      ),
    );
    parts.push(fileBuffer);
    parts.push(Buffer.from("\r\n"));

    // Add model part
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n${config.model}\r\n`,
      ),
    );

    // Add language part (Chinese)
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\nzh\r\n`,
      ),
    );

    // Close boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    // Build URL
    const endpoint = config.endpoint.replace(/\/+$/, "");
    const url = `${endpoint}/audio/transcriptions`;

    const headers: Record<string, string> = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`Whisper API returned ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as { text?: string };
    return result.text || "[转写结果为空]";
  }

  /**
   * Get audio file duration in seconds using ffprobe.
   * Returns 0 if ffprobe is unavailable or fails.
   */
  private getDuration(filePath: string): number {
    try {
      const result = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: "utf-8", timeout: 10000 },
      );
      return parseFloat(result.trim()) || 0;
    } catch {
      return 0;
    }
  }
}
