/**
 * provider.ts - Unified Model Provider interfaces and configuration schemas
 *
 * Defines the core abstraction layer for all LLM backends in DeepAnalyze.
 * Every provider must implement the ModelProvider interface.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Core message types
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Chat options & response types
// ---------------------------------------------------------------------------

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason?: string;
}

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_call_delta" | "done" | "error";
  content?: string;
  toolCall?: Partial<ToolCall>;
  finishReason?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// ModelProvider - the contract every backend adapter must satisfy
// ---------------------------------------------------------------------------

export interface ModelProvider {
  /** Human-readable name for this provider (e.g. "ollama-local") */
  readonly name: string;

  /** Send a chat completion request and return the full response. */
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;

  /** Stream a chat completion, yielding chunks as they arrive. */
  chatStream(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<StreamChunk>;

  /** Estimate the number of tokens for a given text string. */
  estimateTokens(text: string): number;
}

// ---------------------------------------------------------------------------
// Zod schemas for YAML config validation
// ---------------------------------------------------------------------------

/** Schema for a single model entry in the config file. */
export const ModelConfigSchema = z.object({
  /** Provider type, currently only "openai-compatible" is supported. */
  provider: z.enum(["openai-compatible"]),

  /** Base endpoint URL (e.g. "http://localhost:11434/v1"). */
  endpoint: z.string().url(),

  /** API key - optional for local providers like Ollama. */
  apiKey: z.string().optional(),

  /** Model identifier (e.g. "qwen2.5-14b"). */
  model: z.string(),

  /** Maximum tokens the model can generate in a single response. */
  maxTokens: z.number().positive().default(32768),

  /** Whether the model supports tool/function calling. */
  supportsToolUse: z.boolean().default(false),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/** Schema for the defaults section. */
export const DefaultsConfigSchema = z.object({
  /** Name of the default main model. */
  main: z.string().default("main"),

  /** Name of the default summarizer model (optional). */
  summarizer: z.string().optional(),

  /** Name of the default embedding model (optional). */
  embedding: z.string().optional(),

  /** Name of the default vision-language model (optional). */
  vlm: z.string().optional(),
});

export type DefaultsConfig = z.infer<typeof DefaultsConfigSchema>;

/** Top-level configuration file schema. */
export const AppConfigSchema = z.object({
  /** Named model configurations. */
  models: z.record(z.string(), ModelConfigSchema),

  /** Default model assignments by role. */
  defaults: DefaultsConfigSchema.default({ main: "main" }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Role types for model selection. */
export type ModelRole = "main" | "summarizer" | "embedding" | "vlm";
