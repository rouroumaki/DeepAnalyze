// =============================================================================
// DeepAnalyze - Video Processor
// Uses ffmpeg for keyframe extraction + VLM for frame description.
// Falls back gracefully when ffmpeg or VLM is unavailable.
// =============================================================================

import { execSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { DocumentProcessor, ParsedContent } from "./types.js";
import type { VideoRawData, VideoKeyframe, AudioRawData } from "./modality-types.js";
import { DocTagsFormatters } from "./modality-types.js";

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
    const duration = this.getDuration(filePath);
    const format = filePath.split(".").pop() ?? "unknown";
    let timeline = "";

    try {
      // 1. Extract keyframes with ffmpeg
      const frames = this.extractKeyframes(filePath);

      // 2. Try VLM description for each frame
      const descriptions: string[] = [];

      // Attempt to initialize the model router for VLM calls
      let vlmAvailable = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let router: any = null;
      let vlmModel: string | undefined;

      try {
        const { ModelRouter } = await import("../../models/router.js");
        router = new ModelRouter();
        await router.initialize();
        vlmModel = router.getDefaultModel("vlm");
        if (vlmModel) {
          vlmAvailable = true;
        }
      } catch {
        // VLM not available
      }

      // Build keyframe descriptions and VideoKeyframe array
      const keyframes: VideoKeyframe[] = [];

      for (const frame of frames) {
        let frameDescription = "";
        try {
          if (vlmAvailable && router && vlmModel) {
            const base64 = readFileSync(frame.path).toString("base64");
            const result = await router.chat(
              [
                {
                  role: "user",
                  content: [
                    { type: "text", text: "描述这个视频关键帧的内容，包括场景、人物、动作和文字信息。" },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
                  ],
                },
              ],
              { model: vlmModel },
            );
            frameDescription = result.content;
            descriptions.push(`### ${frame.timestamp}\n${frameDescription}`);
          } else {
            frameDescription = `[关键帧描述待VLM集成]`;
            descriptions.push(`### ${frame.timestamp}\n${frameDescription}`);
          }
        } catch {
          frameDescription = `[帧分析失败]`;
          descriptions.push(`### ${frame.timestamp}\n${frameDescription}`);
        }

        // Parse timestamp back to seconds
        const tsParts = frame.timestamp.split(':');
        const timeSeconds = parseInt(tsParts[0] ?? '0') * 60 + parseInt(tsParts[1] ?? '0');
        keyframes.push({ time: timeSeconds, description: frameDescription });
      }

      timeline =
        `# 视频分析\n\n` +
        `时长: ${duration}s\n` +
        `格式: ${format}\n` +
        `关键帧数: ${frames.length}\n\n` +
        descriptions.join("\n\n");

      // Clean up temp directory after all frames are processed
      if (frames.length > 0 && frames[0].tmpDir) {
        try { rmSync(frames[0].tmpDir, { recursive: true }); } catch {}
      }

      // Build VideoRawData
      const videoRaw: VideoRawData = {
        duration,
        resolution: this.getResolution(filePath),
        fps: this.getFps(filePath),
        keyframes,
        transcript: {
          duration,
          speakers: [{ id: 'S', label: '旁白' }],
          turns: [], // Audio transcript populated by separate audio track processing
        },
      };

      // Build doctags from keyframes
      const doctags = keyframes
        .map((kf) => DocTagsFormatters.videoScene(kf, []))
        .join('\n');

      return {
        text: timeline,
        metadata: { sourceType: "video", duration, format },
        success: true,
        raw: videoRaw,
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
    }
  }

  /**
   * Get video resolution string (e.g., "1920x1080").
   */
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

  /**
   * Get video frame rate.
   */
  private getFps(filePath: string): number | undefined {
    try {
      const result = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: "utf-8", timeout: 10000 },
      );
      const parts = result.trim().split('/');
      if (parts.length === 2) {
        return parseFloat(parts[0]) / parseFloat(parts[1]);
      }
      return parseFloat(result.trim()) || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Extract keyframes from a video using ffmpeg.
   * Extracts up to 30 frames at 10-second intervals.
   * Returns an array of { timestamp, path } objects.
   */
  private extractKeyframes(
    filePath: string,
  ): Array<{ timestamp: string; path: string; tmpDir: string }> {
    const tmpDir = mkdtempSync(join(tmpdir(), "da-video-"));
    try {
      execSync(
        `ffmpeg -i "${filePath}" -vf "fps=1/10" -frames:v 30 "${join(tmpDir, "frame_%03d.jpg")}"`,
        { encoding: "utf-8", timeout: 60000 },
      );
      const files = readdirSync(tmpDir)
        .filter((f) => f.endsWith(".jpg"))
        .sort();
      return files.map((f, i) => ({
        timestamp: `${Math.floor((i * 10) / 60)}:${((i * 10) % 60).toString().padStart(2, "0")}`,
        path: join(tmpDir, f),
        tmpDir,
      }));
    } catch {
      // Clean up on extraction failure
      try { rmSync(tmpDir, { recursive: true }); } catch {}
      return [];
    }
  }

  /**
   * Get video file duration in seconds using ffprobe.
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
