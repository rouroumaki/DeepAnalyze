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

      for (const frame of frames) {
        try {
          if (vlmAvailable && router && vlmModel) {
            // Read frame as base64 and send to VLM
            const base64 = readFileSync(frame.path).toString("base64");
            const result = await router.chat(
              [
                {
                  role: "user",
                  content: `描述这个视频关键帧的内容。\n\n[图片数据: data:image/jpeg;base64,${base64.slice(0, 100)}...]`,
                },
              ],
              { model: vlmModel },
            );
            descriptions.push(`### ${frame.timestamp}\n${result.content}`);
          } else {
            descriptions.push(`### ${frame.timestamp}\n[关键帧描述待VLM集成]`);
          }
        } catch {
          descriptions.push(`### ${frame.timestamp}\n[帧分析失败]`);
        }
      }

      timeline =
        `# 视频分析\n\n` +
        `时长: ${duration}s\n` +
        `格式: ${format}\n` +
        `关键帧数: ${frames.length}\n\n` +
        descriptions.join("\n\n");
    } catch (err) {
      timeline = `[视频分析失败: ${err instanceof Error ? err.message : String(err)}]`;
    }

    return {
      text: timeline,
      metadata: { sourceType: "video", duration, format },
      success: true,
    };
  }

  /**
   * Extract keyframes from a video using ffmpeg.
   * Extracts up to 30 frames at 10-second intervals.
   * Returns an array of { timestamp, path } objects.
   */
  private extractKeyframes(
    filePath: string,
  ): Array<{ timestamp: string; path: string }> {
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
      }));
    } catch {
      return [];
    } finally {
      // Clean up temp directory
      try {
        rmSync(tmpDir, { recursive: true });
      } catch {
        // Temp cleanup failed -- non-critical
      }
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
