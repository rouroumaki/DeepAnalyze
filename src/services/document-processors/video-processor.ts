// =============================================================================
// DeepAnalyze - Video Processor
// Uses ffprobe for metadata, ffmpeg for thumbnail extraction + audio track,
// VLM for scene-by-scene video understanding, and CapabilityDispatcher for
// audio transcription with speaker diarization.
// Falls back gracefully when ffmpeg, VLM, or ASR is unavailable.
// =============================================================================

import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import type { DocumentProcessor, ParsedContent } from "./types.js";
import type {
  VideoRawData,
  VideoKeyframe,
  VideoScene,
  AudioRawData,
} from "./modality-types.js";
import { DocTagsFormatters } from "./modality-types.js";

/** Maximum number of thumbnails to extract (one every 30 s). */
const MAX_THUMBNAILS = 120;

/** Interval between thumbnail extractions in seconds. */
const THUMBNAIL_INTERVAL = 30;

/** Maximum number of frames to send to VLM in a single request. */
const MAX_VLM_FRAMES = 20;

/** Thumbnail resize width in pixels. */
const THUMBNAIL_WIDTH = 320;

export class VideoProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set([
    "mp4", "avi", "mov", "mkv", "webm", "flv", "wmv",
  ]);

  canHandle(fileType: string): boolean {
    return VideoProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "video_analysis";
  }

  async parse(filePath: string): Promise<ParsedContent> {
    const format = filePath.split(".").pop() ?? "unknown";

    // ---- 1. ffprobe metadata ------------------------------------------------
    const duration = this.getDuration(filePath);
    const resolution = this.getResolution(filePath);
    const fps = this.getFps(filePath);
    const codec = this.getCodec(filePath);

    // Temp directory for all intermediate files
    const tmpDir = mkdtempSync(join(tmpdir(), "da-video-"));

    try {
      // ---- 2. Thumbnail generation ------------------------------------------
      const thumbnails = await this.extractThumbnails(filePath, tmpDir, duration);

      // ---- 3. Video understanding via VLM ----------------------------------
      const { scenes, keyframes } = await this.analyzeVideoWithVLM(
        filePath,
        thumbnails,
        duration,
        tmpDir,
      );

      // ---- 4. Audio track extraction + ASR ----------------------------------
      const transcript = await this.extractAndTranscribeAudio(
        filePath,
        tmpDir,
        duration,
      );

      // ---- 5. Time alignment: match transcript turns to scenes ---------------
      if (scenes.length > 0) {
        this.alignTurnsWithScenes(scenes, transcript.turns);
      }

      // ---- 6. Build VideoRawData -------------------------------------------
      const videoUnderstandingMethod = scenes.length > 0
        ? ("vlm_video" as const)
        : ("vlm_frames" as const);

      const videoRaw: VideoRawData = {
        duration,
        resolution,
        fps,
        codec,
        scenes: scenes.length > 0 ? scenes : undefined,
        keyframes,
        transcript,
        videoUnderstandingMethod,
      };

      // ---- 7. Build output text and doctags ---------------------------------
      const timeline = this.buildTimelineText(
        duration,
        format,
        scenes,
        keyframes,
        transcript,
      );

      const doctags = this.buildDoctags(scenes, keyframes, transcript);

      return {
        text: timeline,
        metadata: { sourceType: "video", duration, format },
        success: true,
        raw: videoRaw as unknown as Record<string, unknown>,
        doctags,
        modality: "video",
      };
    } catch (err) {
      return {
        text: `[视频分析失败: ${err instanceof Error ? err.message : String(err)}]`,
        metadata: { sourceType: "video", duration, format },
        success: false,
        error: err instanceof Error ? err.message : String(err),
        modality: "video",
      };
    } finally {
      // ---- Cleanup temp directory -------------------------------------------
      try {
        rmSync(tmpDir, { recursive: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  // ===========================================================================
  // Thumbnail extraction
  // ===========================================================================

  /**
   * Extract frames every 30 seconds (max 120), resize to 320px width via
   * Sharp, and save as JPEG to a `frames/` subdirectory inside tmpDir.
   */
  private async extractThumbnails(
    filePath: string,
    tmpDir: string,
    duration: number,
  ): Promise<Array<{ time: number; path: string }>> {
    const framesDir = join(tmpDir, "frames");
    mkdirSync(framesDir, { recursive: true });

    if (duration <= 0) return [];

    const count = Math.min(
      Math.ceil(duration / THUMBNAIL_INTERVAL),
      MAX_THUMBNAILS,
    );

    try {
      // Extract raw frames via ffmpeg
      const rawDir = join(tmpDir, "raw_frames");
      mkdirSync(rawDir, { recursive: true });

      execSync(
        `ffmpeg -i "${filePath}" -vf "fps=1/${THUMBNAIL_INTERVAL}" -frames:v ${count} "${join(rawDir, "frame_%04d.jpg")}"`,
        { encoding: "utf-8", timeout: 120000 },
      );

      const files = readdirSync(rawDir)
        .filter((f) => f.endsWith(".jpg"))
        .sort();

      const thumbnails: Array<{ time: number; path: string }> = [];

      for (let i = 0; i < files.length; i++) {
        const rawPath = join(rawDir, files[i]);
        const time = i * THUMBNAIL_INTERVAL;
        const thumbPath = join(framesDir, `thumb_${String(i).padStart(4, "0")}.jpg`);

        try {
          // Resize to 320px width preserving aspect ratio
          await sharp(rawPath)
            .resize(THUMBNAIL_WIDTH, undefined, { withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(thumbPath);

          thumbnails.push({ time, path: thumbPath });
        } catch {
          // If sharp fails for this frame, use the raw frame
          thumbnails.push({ time, path: rawPath });
        }
      }

      return thumbnails;
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // VLM video understanding
  // ===========================================================================

  /**
   * Send up to 20 frames to the VLM with a Chinese prompt requesting
   * scene-by-scene analysis with time ranges. Parse the response into
   * VideoScene objects. Also build keyframes from thumbnails as fallback.
   */
  private async analyzeVideoWithVLM(
    filePath: string,
    thumbnails: Array<{ time: number; path: string }>,
    duration: number,
    tmpDir: string,
  ): Promise<{ scenes: VideoScene[]; keyframes: VideoKeyframe[] }> {
    // Build keyframes from thumbnails as a baseline
    const keyframes: VideoKeyframe[] = thumbnails.map((t) => ({
      time: t.time,
      description: "",
    }));

    // Try to get VLM model
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let router: any = null;
    let vlmModel: string | undefined;

    try {
      const { ModelRouter } = await import("../../models/router.js");
      router = new ModelRouter();
      await router.initialize();

      // Prefer video_understand role, fall back to vlm (strict: no main model fallback)
      vlmModel = router.getDefaultModelStrict("video_understand");
      if (!vlmModel) {
        vlmModel = router.getDefaultModelStrict("vlm");
      }
    } catch {
      // VLM not available
    }

    if (!router || !vlmModel || thumbnails.length === 0) {
      // No VLM: fill keyframes with placeholder descriptions
      for (const kf of keyframes) {
        kf.description = "[关键帧描述待VLM集成]";
      }
      return { scenes: [], keyframes };
    }

    // Select up to MAX_VLM_FRAMES evenly spaced
    const selectedFrames = this.selectEvenlySpaced(thumbnails, MAX_VLM_FRAMES);

    // Build the VLM prompt with multiple frame images
    const prompt =
      "请对以下视频帧进行逐场景分析。按照时间顺序，为每个场景提供：\n" +
      "1. 场景起止时间（秒）\n" +
      "2. 场景描述（人物、动作、环境）\n" +
      "3. 关键事件（如有）\n" +
      "4. 屏幕文字（如有）\n\n" +
      "请严格按以下JSON格式输出，不要添加其他内容：\n" +
      '[{"index":0,"startTime":0,"endTime":30,"description":"...","keyEvents":["..."],"textOnScreen":"..."}]\n\n' +
      "注意：每个场景的startTime应等于上一个场景的endTime，最后一个场景的endTime应为视频总时长" +
      (duration > 0 ? `（${duration}秒）` : "") +
      "。";

    const imageContents = selectedFrames.map((frame) => {
      const base64 = readFileSync(frame.path).toString("base64");
      return {
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${base64}` },
      };
    });

    try {
      const result = await router.chat(
        [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...imageContents,
            ],
          },
        ],
        { model: vlmModel },
      );

      const scenes = this.parseVLMSceneResponse(result.content, duration);

      // Assign thumbnail paths to scenes
      for (const scene of scenes) {
        const thumb = this.findClosestThumbnail(thumbnails, scene.startTime);
        if (thumb) {
          scene.thumbnailPath = thumb.path;
        }
      }

      // Update keyframe descriptions from scenes where available
      for (const kf of keyframes) {
        const scene = scenes.find(
          (s) => kf.time >= s.startTime && kf.time < s.endTime,
        );
        if (scene) {
          kf.description = scene.description;
        } else {
          kf.description = kf.description || "[关键帧]";
        }
      }

      return { scenes, keyframes };
    } catch {
      // VLM call failed: fill keyframes with per-frame descriptions
      // Try individual frame descriptions as fallback
      await this.describeFramesIndividually(router, vlmModel, thumbnails, keyframes);
      return { scenes: [], keyframes };
    }
  }

  /**
   * Fallback: describe each frame individually via VLM.
   */
  private async describeFramesIndividually(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any,
    vlmModel: string,
    thumbnails: Array<{ time: number; path: string }>,
    keyframes: VideoKeyframe[],
  ): Promise<void> {
    const framesToDescribe = this.selectEvenlySpaced(thumbnails, 30);

    for (const frame of framesToDescribe) {
      try {
        const base64 = readFileSync(frame.path).toString("base64");
        const result = await router.chat(
          [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "简短描述这个视频帧的内容（一句话）。",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${base64}` },
                },
              ],
            },
          ],
          { model: vlmModel },
        );

        // Find the closest keyframe and update
        const kf = keyframes.find((k) => k.time === frame.time);
        if (kf) {
          kf.description = result.content || "[关键帧]";
        }
      } catch {
        const kf = keyframes.find((k) => k.time === frame.time);
        if (kf) {
          kf.description = "[帧分析失败]";
        }
      }
    }

    // Fill remaining keyframes that didn't get descriptions
    for (const kf of keyframes) {
      if (!kf.description) {
        kf.description = "[关键帧]";
      }
    }
  }

  /**
   * Parse the VLM JSON response into VideoScene objects.
   */
  private parseVLMSceneResponse(
    content: string,
    duration: number,
  ): VideoScene[] {
    try {
      // Try to extract JSON from the response (may have markdown fences)
      let jsonStr = content.trim();

      // Strip markdown code fences if present
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      // Find JSON array in the response
      const arrStart = jsonStr.indexOf("[");
      const arrEnd = jsonStr.lastIndexOf("]");
      if (arrStart === -1 || arrEnd === -1) {
        return [];
      }
      jsonStr = jsonStr.slice(arrStart, arrEnd + 1);

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      const scenes: VideoScene[] = parsed
        .filter((s: Record<string, unknown>) => typeof s === "object" && s !== null)
        .map((s: Record<string, unknown>, index: number) => ({
          index: typeof s.index === "number" ? s.index : index,
          startTime: typeof s.startTime === "number" ? s.startTime : 0,
          endTime: typeof s.endTime === "number" ? s.endTime : 0,
          description: typeof s.description === "string" ? s.description : "",
          keyEvents: Array.isArray(s.keyEvents)
            ? s.keyEvents.filter((e: unknown) => typeof e === "string")
            : undefined,
          textOnScreen: typeof s.textOnScreen === "string" && s.textOnScreen
            ? s.textOnScreen
            : undefined,
          sceneTransition: typeof s.sceneTransition === "boolean"
            ? s.sceneTransition
            : undefined,
          thumbnailPath: undefined as string | undefined,
        }))
        .filter((s: VideoScene) => s.description.length > 0);

      // Clamp scene times to video duration
      for (const scene of scenes) {
        scene.startTime = Math.max(0, scene.startTime);
        if (duration > 0) {
          scene.endTime = Math.min(scene.endTime, duration);
        }
      }

      return scenes;
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // Audio track extraction + ASR
  // ===========================================================================

  /**
   * Extract the audio track from the video to a temporary WAV file, then
   * reuse the ASR pipeline (CapabilityDispatcher) for transcription with
   * speaker diarization.
   */
  private async extractAndTranscribeAudio(
    filePath: string,
    tmpDir: string,
    duration: number,
  ): Promise<AudioRawData> {
    const wavPath = join(tmpDir, "audio_track.wav");

    // Extract audio to WAV via ffmpeg
    try {
      execSync(
        `ffmpeg -i "${filePath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${wavPath}" -y`,
        { encoding: "utf-8", timeout: 120000 },
      );
    } catch {
      // No audio track or ffmpeg failed
      return {
        duration,
        speakers: [],
        turns: [],
        diarizationMethod: "none",
      };
    }

    // Check that the WAV file exists and has content
    if (!existsSync(wavPath)) {
      return {
        duration,
        speakers: [],
        turns: [],
        diarizationMethod: "none",
      };
    }

    // Run ASR via CapabilityDispatcher (same as AudioProcessor)
    let transcription = "";
    let detectedLanguage: string | undefined;

    try {
      const audioData = readFileSync(wavPath).buffer as ArrayBuffer;
      const { CapabilityDispatcher } = await import("../../models/capability-dispatcher.js");
      const dispatcher = new CapabilityDispatcher();

      const result = await dispatcher.transcribeAudio(audioData, basename(wavPath), {
        language: undefined, // auto-detect
      });

      transcription = result.text || "";
      detectedLanguage = result.language;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No audio transcription provider")) {
        transcription = `[音频转写失败: ${message}]`;
      }
    }

    if (!transcription) {
      return {
        duration,
        language: detectedLanguage,
        speakers: [],
        turns: [],
        diarizationMethod: "none",
      };
    }

    // Build turns with speaker diarization (reuse same logic as AudioProcessor)
    const { turns, speakers, diarizationMethod } = this.buildTurnsWithDiarization(
      transcription,
      duration,
    );

    return {
      duration,
      language: detectedLanguage,
      speakers,
      turns,
      diarizationMethod,
    };
  }

  // ===========================================================================
  // Time alignment
  // ===========================================================================

  /**
   * Align transcript turns with scenes by assigning turns whose startTime
   * falls within a scene's time range to that scene. This is informational
   * only (used by the video-structure compiler).
   */
  private alignTurnsWithScenes(
    scenes: VideoScene[],
    turns: Array<{ speaker: string; startTime: number; endTime: number; text: string }>,
  ): void {
    // Turns are already aligned by time range in the structure compiler;
    // this method exists for potential future enrichment of scene objects
    // (e.g., embedding transcript snippets in scene descriptions).
    // For now, no-op — the compiler reads turns and scenes separately.
    void scenes;
    void turns;
  }

  // ===========================================================================
  // Output builders
  // ===========================================================================

  private buildTimelineText(
    duration: number,
    format: string,
    scenes: VideoScene[],
    keyframes: VideoKeyframe[],
    transcript: AudioRawData,
  ): string {
    const parts: string[] = [];

    parts.push("# 视频分析\n");
    parts.push(`时长: ${duration}s`);
    parts.push(`格式: ${format}`);
    parts.push(`场景数: ${scenes.length || keyframes.length}`);
    parts.push(`转录段数: ${transcript.turns.length}\n`);

    if (scenes.length > 0) {
      parts.push("## 场景分析\n");
      for (const scene of scenes) {
        const timeStr = `${formatTimeMMSS(scene.startTime)}-${formatTimeMMSS(scene.endTime)}`;
        parts.push(`### 场景${scene.index + 1} (${timeStr})`);
        parts.push(scene.description);
        if (scene.keyEvents && scene.keyEvents.length > 0) {
          parts.push(`关键事件: ${scene.keyEvents.join(", ")}`);
        }
        if (scene.textOnScreen) {
          parts.push(`屏幕文字: ${scene.textOnScreen}`);
        }
        parts.push("");
      }
    } else {
      parts.push("## 关键帧\n");
      for (const kf of keyframes) {
        parts.push(`### ${formatTimeMMSS(kf.time)}`);
        parts.push(kf.description);
        parts.push("");
      }
    }

    if (transcript.turns.length > 0) {
      parts.push("## 转录文本\n");
      for (const turn of transcript.turns) {
        const timeStr = `${formatTimeMMSS(turn.startTime)}-${formatTimeMMSS(turn.endTime)}`;
        parts.push(`[${turn.speaker}] (${timeStr}) ${turn.text}`);
      }
    }

    return parts.join("\n");
  }

  private buildDoctags(
    scenes: VideoScene[],
    keyframes: VideoKeyframe[],
    transcript: AudioRawData,
  ): string {
    const parts: string[] = [];

    if (scenes.length > 0) {
      for (const scene of scenes) {
        const sceneTurns = transcript.turns.filter(
          (t) => t.startTime >= scene.startTime && t.startTime < scene.endTime,
        );
        parts.push(DocTagsFormatters.videoScene(scene, sceneTurns));
      }
    } else {
      for (const kf of keyframes) {
        parts.push(DocTagsFormatters.videoScene(kf, []));
      }
    }

    return parts.join("\n");
  }

  // ===========================================================================
  // Speaker diarization (same logic as AudioProcessor)
  // ===========================================================================

  /** Minimum silence gap (seconds) to treat as a speaker change boundary. */
  private static readonly SILENCE_GAP_THRESHOLD = 1.5;

  /** Sentence-splitting regex covering CJK and Latin punctuation plus newlines. */
  private static readonly SENTENCE_RE = /[。！？.!?\n]+/;

  private buildTurnsWithDiarization(
    text: string,
    duration: number,
  ): {
    turns: AudioRawData["turns"];
    speakers: AudioRawData["speakers"];
    diarizationMethod: "silence" | "none";
  } {
    if (!text || text.startsWith("[")) {
      return {
        turns: [{
          speaker: "S1",
          startTime: 0,
          endTime: duration || 0,
          text: text || "",
        }],
        speakers: [{ id: "S1", label: "说话者 1", totalDuration: duration || 0 }],
        diarizationMethod: "none",
      };
    }

    const SENTENCE_RE = VideoProcessor.SENTENCE_RE;
    const SILENCE_GAP = VideoProcessor.SILENCE_GAP_THRESHOLD;

    const rawSentences = text.split(SENTENCE_RE);
    const sentences: string[] = [];
    for (const s of rawSentences) {
      const trimmed = s.trim();
      if (trimmed) sentences.push(trimmed);
    }

    if (sentences.length === 0) {
      return {
        turns: [{
          speaker: "S1",
          startTime: 0,
          endTime: duration || 0,
          text: text,
        }],
        speakers: [{ id: "S1", label: "说话者 1", totalDuration: duration || 0 }],
        diarizationMethod: "none",
      };
    }

    // Estimate timestamps via proportional time allocation
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
    const effectiveDuration = duration > 0 ? duration : totalChars * 0.25;

    interface SentenceWithTime {
      text: string;
      startTime: number;
      endTime: number;
    }

    const timed: SentenceWithTime[] = [];
    let cursor = 0;

    for (const sentence of sentences) {
      const proportion = sentence.length / totalChars;
      const segmentDuration = proportion * effectiveDuration;
      const start = cursor;
      const end = cursor + segmentDuration;
      timed.push({ text: sentence, startTime: start, endTime: end });
      cursor = end;
    }

    // Silence-based speaker diarization
    let hadSilenceGap = false;
    let currentSpeaker = 1;
    const speakerIds: string[] = ["S1"];

    for (let i = 1; i < timed.length; i++) {
      const gap = timed[i].startTime - timed[i - 1].endTime;
      if (gap >= SILENCE_GAP) {
        currentSpeaker++;
        hadSilenceGap = true;
      }
      speakerIds.push(`S${currentSpeaker}`);
    }

    const diarizationMethod = hadSilenceGap ? "silence" as const : "none" as const;

    if (!hadSilenceGap) {
      for (let i = 0; i < timed.length; i++) {
        speakerIds[i] = "S1";
      }
    }

    // Group consecutive sentences from the same speaker into turns
    const turns: AudioRawData["turns"] = [];
    const speakerDurations: Map<string, number> = new Map();

    let i = 0;
    while (i < timed.length) {
      const speaker = speakerIds[i];
      let turnStart = timed[i].startTime;
      let turnEnd = timed[i].endTime;
      const textParts: string[] = [timed[i].text];
      let j = i + 1;

      while (j < timed.length && speakerIds[j] === speaker) {
        turnEnd = timed[j].endTime;
        textParts.push(timed[j].text);
        j++;
      }

      const turn = {
        speaker,
        startTime: turnStart,
        endTime: turnEnd,
        text: textParts.join(" "),
      };
      turns.push(turn);

      const dur = turnEnd - turnStart;
      speakerDurations.set(speaker, (speakerDurations.get(speaker) ?? 0) + dur);

      i = j;
    }

    const uniqueSpeakers = [...new Set(speakerIds)];
    const speakers: AudioRawData["speakers"] = uniqueSpeakers.map((id) => ({
      id,
      label: `说话者 ${id.slice(1)}`,
      totalDuration: speakerDurations.get(id) ?? 0,
    }));

    return { turns, speakers, diarizationMethod };
  }

  // ===========================================================================
  // ffprobe helpers
  // ===========================================================================

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

  private getResolution(filePath: string): string | undefined {
    try {
      const result = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`,
        { encoding: "utf-8", timeout: 10000 },
      );
      return result.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private getFps(filePath: string): number | undefined {
    try {
      const result = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: "utf-8", timeout: 10000 },
      );
      const parts = result.trim().split("/");
      if (parts.length === 2) {
        return parseFloat(parts[0]) / parseFloat(parts[1]);
      }
      return parseFloat(result.trim()) || undefined;
    } catch {
      return undefined;
    }
  }

  private getCodec(filePath: string): string | undefined {
    try {
      const result = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: "utf-8", timeout: 10000 },
      );
      return result.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  // ===========================================================================
  // Utility helpers
  // ===========================================================================

  /**
   * Select up to `maxCount` evenly spaced items from the array.
   */
  private selectEvenlySpaced<T>(
    items: T[],
    maxCount: number,
  ): T[] {
    if (items.length <= maxCount) return items;

    const step = (items.length - 1) / (maxCount - 1);
    const selected: T[] = [];
    for (let i = 0; i < maxCount; i++) {
      selected.push(items[Math.round(i * step)]);
    }
    return selected;
  }

  /**
   * Find the thumbnail closest to a given time.
   */
  private findClosestThumbnail(
    thumbnails: Array<{ time: number; path: string }>,
    targetTime: number,
  ): { time: number; path: string } | undefined {
    if (thumbnails.length === 0) return undefined;

    let closest = thumbnails[0];
    let minDiff = Math.abs(closest.time - targetTime);

    for (const t of thumbnails) {
      const diff = Math.abs(t.time - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = t;
      }
    }

    return closest;
  }
}

// =============================================================================
// Standalone helper
// =============================================================================

function formatTimeMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
