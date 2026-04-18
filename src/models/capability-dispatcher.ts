// =============================================================================
// DeepAnalyze - Model Capability Dispatcher
// =============================================================================
// Routes non-chat API calls (TTS, image gen, video gen, music gen) to the
// correct provider based on settings configuration. Each capability type has
// its own API protocol which this dispatcher implements.
// =============================================================================

import { getRepos } from "../store/repos/index.js";
import type { ProviderConfig } from "../store/repos/index.js";
import type { ModelRole } from "./provider.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface TTSResult {
  /** Audio data as ArrayBuffer */
  audio: ArrayBuffer;
  /** MIME type (e.g. "audio/mp3") */
  contentType: string;
}

export interface ImageGenResult {
  /** Image data as ArrayBuffer */
  image: ArrayBuffer;
  /** MIME type (e.g. "image/png") */
  contentType: string;
}

export interface VideoGenResult {
  /** Video file URL or data */
  fileUrl?: string;
  video?: ArrayBuffer;
  contentType: string;
}

export interface MusicGenResult {
  /** Audio data as ArrayBuffer */
  audio: ArrayBuffer;
  /** MIME type (e.g. "audio/mp3") */
  contentType: string;
}

export interface TranscriptionResult {
  /** Transcribed text */
  text: string;
  /** Detected language */
  language?: string;
  /** Audio duration in seconds */
  duration?: number;
}

// ---------------------------------------------------------------------------
// CapabilityDispatcher
// ---------------------------------------------------------------------------

export class CapabilityDispatcher {
  /**
   * Resolve a provider config for a given role by reading settings.
   */
  private async resolveProvider(role: ModelRole): Promise<ProviderConfig | null> {
    const repos = await getRepos();
    const settings = await repos.settings.getProviderSettings();
    const defaultId = settings.defaults[role as keyof typeof settings.defaults];
    if (!defaultId) return null;

    const provider = settings.providers.find(
      (p) => p.id === defaultId && p.enabled,
    );
    return provider ?? null;
  }

  /** Detect the API protocol based on provider endpoint */
  private detectProtocol(provider: ProviderConfig): 'minimax' | 'openai' {
    const endpoint = provider.endpoint || '';
    if (endpoint.includes('minimax')) return 'minimax';
    return 'openai';
  }

  // -----------------------------------------------------------------------
  // TTS (Text-to-Speech)
  // -----------------------------------------------------------------------

  /**
   * Generate speech from text using the configured TTS provider.
   * Supports MiniMax TTS API format and OpenAI-compatible /audio/speech.
   */
  async textToSpeech(
    text: string,
    options?: {
      voice?: string;
      speed?: number;
      model?: string;
    },
  ): Promise<TTSResult> {
    const provider = await this.resolveProvider("tts");
    if (!provider) throw new Error("No TTS provider configured. Set the 'tts' role default.");

    const protocol = this.detectProtocol(provider);
    const endpoint = provider.endpoint.replace(/\/+$/, "");
    const model = options?.model ?? provider.model;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }

    if (protocol === 'minimax') {
      // MiniMax TTS API: POST /tts/text_to_speech
      const url = `${endpoint}/tts/text_to_speech`;
      const body = {
        model,
        text,
        voice: options?.voice ?? "male-qn-qingse",
        speed: options?.speed ?? 1.0,
        response_format: "mp3",
      };

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => "unknown error");
        throw new Error(`TTS API returned HTTP ${resp.status}: ${errorText}`);
      }

      const audio = await resp.arrayBuffer();
      const contentType = resp.headers.get("content-type") ?? "audio/mp3";
      return { audio, contentType };
    }

    // OpenAI-compatible: POST /audio/speech
    const url = `${endpoint}/audio/speech`;
    const body = {
      model,
      input: text,
      voice: options?.voice ?? "alloy",
      speed: options?.speed ?? 1.0,
      response_format: "mp3",
    };

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "unknown error");
      throw new Error(`TTS API returned HTTP ${resp.status}: ${errorText}`);
    }

    const audio = await resp.arrayBuffer();
    const contentType = resp.headers.get("content-type") ?? "audio/mp3";
    return { audio, contentType };
  }

  // -----------------------------------------------------------------------
  // Image Generation
  // -----------------------------------------------------------------------

  /**
   * Generate an image from a text prompt using the configured image_gen provider.
   * Supports MiniMax and OpenAI-compatible image generation API formats.
   */
  async generateImage(
    prompt: string,
    options?: {
      model?: string;
      width?: number;
      height?: number;
    },
  ): Promise<ImageGenResult> {
    const provider = await this.resolveProvider("image_gen");
    if (!provider) throw new Error("No image generation provider configured. Set the 'image_gen' role default.");

    const protocol = this.detectProtocol(provider);
    const endpoint = provider.endpoint.replace(/\/+$/, "");
    const model = options?.model ?? provider.model;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }

    let url: string;
    let body: Record<string, unknown>;

    if (protocol === 'minimax') {
      url = `${endpoint}/image/generation`;
      body = { model, prompt };
      if (options?.width) body.width = options.width;
      if (options?.height) body.height = options.height;
    } else {
      // OpenAI-compatible: POST /images/generations
      url = `${endpoint}/images/generations`;
      body = {
        model,
        prompt,
        n: 1,
        size: `${options?.width ?? 1024}x${options?.height ?? 1024}`,
        response_format: "b64_json",
      };
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "unknown error");
      throw new Error(`Image Gen API returned HTTP ${resp.status}: ${errorText}`);
    }

    const data = await resp.json() as { data?: Array<{ url?: string; b64_json?: string }> };

    if (data.data?.[0]?.url) {
      const imgResp = await fetch(data.data[0].url);
      const image = await imgResp.arrayBuffer();
      return { image, contentType: "image/png" };
    }

    if (data.data?.[0]?.b64_json) {
      const image = Uint8Array.from(atob(data.data[0].b64_json), (c) => c.charCodeAt(0)).buffer;
      return { image, contentType: "image/png" };
    }

    throw new Error("Image generation returned no data");
  }

  // -----------------------------------------------------------------------
  // Video Generation
  // -----------------------------------------------------------------------

  /**
   * Generate a video from a text prompt using the configured video_gen provider.
   * MiniMax video generation is asynchronous - this submits the task and polls
   * for completion.
   */
  async generateVideo(
    prompt: string,
    options?: {
      model?: string;
    },
  ): Promise<VideoGenResult> {
    const provider = await this.resolveProvider("video_gen");
    if (!provider) throw new Error("No video generation provider configured. Set the 'video_gen' role default.");

    const endpoint = provider.endpoint.replace(/\/+$/, "");
    const model = options?.model ?? provider.model;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }

    // Step 1: Submit video generation task
    const submitUrl = `${endpoint}/video/generation`;
    const submitBody = { model, prompt };

    const submitResp = await fetch(submitUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(submitBody),
    });

    if (!submitResp.ok) {
      const errorText = await submitResp.text().catch(() => "unknown error");
      throw new Error(`Video Gen submit returned HTTP ${submitResp.status}: ${errorText}`);
    }

    const submitData = await submitResp.json() as { task_id?: string; id?: string };
    const taskId = submitData.task_id ?? submitData.id;

    if (!taskId) throw new Error("Video generation did not return a task ID");

    // Step 2: Poll for completion
    const pollUrl = `${endpoint}/video/generation/task`;
    const maxPolls = 120; // 10 minutes max at 5s intervals
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const pollResp = await fetch(`${pollUrl}?task_id=${taskId}`, { headers });
      if (!pollResp.ok) continue;

      const pollData = await pollResp.json() as {
        status?: string;
        file?: { download_url?: string };
        output?: { download_url?: string };
      };

      if (pollData.status === "success" || pollData.status === "succeeded") {
        const downloadUrl = pollData.file?.download_url ?? pollData.output?.download_url;
        if (downloadUrl) {
          return { fileUrl: downloadUrl, contentType: "video/mp4" };
        }
      }

      if (pollData.status === "fail" || pollData.status === "failed") {
        throw new Error("Video generation task failed");
      }
    }

    throw new Error("Video generation timed out");
  }

  // -----------------------------------------------------------------------
  // Music Generation
  // -----------------------------------------------------------------------

  /**
   * Generate music from a text prompt using the configured music_gen provider.
   */
  async generateMusic(
    prompt: string,
    options?: {
      model?: string;
      duration?: number;
    },
  ): Promise<MusicGenResult> {
    const provider = await this.resolveProvider("music_gen");
    if (!provider) throw new Error("No music generation provider configured. Set the 'music_gen' role default.");

    const endpoint = provider.endpoint.replace(/\/+$/, "");
    const model = options?.model ?? provider.model;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }

    // MiniMax Music Gen API: POST /music/generation
    const url = `${endpoint}/music/generation`;
    const body: Record<string, unknown> = {
      model,
      prompt,
    };
    if (options?.duration) body.duration = options.duration;

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "unknown error");
      throw new Error(`Music Gen API returned HTTP ${resp.status}: ${errorText}`);
    }

    const data = await resp.json() as { data?: { audio_url?: string; audio?: string } };

    if (data.data?.audio_url) {
      const audioResp = await fetch(data.data.audio_url);
      const audio = await audioResp.arrayBuffer();
      return { audio, contentType: "audio/mp3" };
    }

    if (data.data?.audio) {
      // base64 encoded audio
      const audio = Uint8Array.from(atob(data.data.audio), (c) => c.charCodeAt(0)).buffer;
      return { audio, contentType: "audio/mp3" };
    }

    throw new Error("Music generation returned no audio data");
  }

  // -----------------------------------------------------------------------
  // Audio Transcription (ASR)
  // -----------------------------------------------------------------------

  /**
   * Transcribe audio to text using the configured audio_transcribe provider.
   * Uses Whisper-compatible API format (OpenAI /audio/transcriptions).
   */
  async transcribeAudio(
    audioData: ArrayBuffer,
    filename: string,
    options?: {
      language?: string;
      model?: string;
    },
  ): Promise<{
    text: string;
    language?: string;
    duration?: number;
  }> {
    const provider = await this.resolveProvider("audio_transcribe");
    if (!provider) throw new Error("No audio transcription provider configured. Set the 'audio_transcribe' role default.");

    const endpoint = provider.endpoint.replace(/\/+$/, "");
    const model = options?.model ?? provider.model;

    // Whisper-compatible: POST /audio/transcriptions (multipart/form-data)
    const formData = new FormData();
    formData.append("file", new Blob([audioData]), filename);
    formData.append("model", model);
    formData.append("response_format", "verbose_json");
    if (options?.language) formData.append("language", options.language);

    const headers: Record<string, string> = {};
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }

    const resp = await fetch(`${endpoint}/audio/transcriptions`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "unknown error");
      throw new Error(`ASR API returned HTTP ${resp.status}: ${errorText}`);
    }

    const data = await resp.json() as {
      text?: string;
      language?: string;
      duration?: number;
    };

    return {
      text: data.text ?? "",
      language: data.language,
      duration: data.duration,
    };
  }
}
