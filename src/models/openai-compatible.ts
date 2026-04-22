/**
 * openai-compatible.ts - OpenAI-compatible protocol adapter
 *
 * Implements the ModelProvider interface for any backend that exposes an
 * OpenAI-compatible chat completions endpoint (Ollama, LM Studio, vLLM,
 * LiteLLM, etc.).
 *
 * Uses the standard `fetch` API so it works in both Bun and Node (>=18).
 */

import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ContentPart,
  ModelProvider,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from "./provider";

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface OpenAICompatibleOptions {
  /** Human-readable name for this provider instance. */
  name: string;

  /** Base endpoint URL (e.g. "http://localhost:11434/v1"). */
  endpoint: string;

  /** API key - sent as Bearer token. Optional for local backends. */
  apiKey?: string;

  /** Default model to use when ChatOptions.model is not provided. */
  model: string;

  /** Default maximum tokens for responses. When omitted or 0, the API provider decides. */
  maxTokens?: number;

  /** Default sampling temperature (0-2). */
  temperature?: number;

  /** Default nucleus sampling threshold (0-1). */
  topP?: number;

  /** Default top-k sampling. */
  topK?: number;

  /** Default frequency penalty. */
  frequencyPenalty?: number;

  /** Default presence penalty. */
  presencePenalty?: number;

  /** Whether thinking/reasoning mode is enabled by default. */
  thinkingEnabled?: boolean;

  /** Configuration for passing thinking/reasoning parameters. */
  thinkingConfig?: {
    type: 'extra_body' | 'top_level';
    field: string;
    values: { enabled: unknown; disabled: unknown };
  };
}

// ---------------------------------------------------------------------------
// Internal types for the OpenAI API wire format
// ---------------------------------------------------------------------------

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}

interface OpenAIChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }[];
  };
  finish_reason: string | null;
}

interface OpenAIResponse {
  id: string;
  object: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number | undefined;
  private readonly defaultTemperature: number | undefined;
  private readonly defaultTopP: number | undefined;
  private readonly defaultTopK: number | undefined;
  private readonly defaultFrequencyPenalty: number | undefined;
  private readonly defaultPresencePenalty: number | undefined;
  private readonly defaultThinkingEnabled: boolean | undefined;
  private readonly thinkingConfig: OpenAICompatibleOptions['thinkingConfig'];

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.name;
    // Trim trailing slash so we can safely append paths
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.defaultModel = options.model;
    this.defaultMaxTokens = options.maxTokens;
    this.defaultTemperature = options.temperature;
    this.defaultTopP = options.topP;
    this.defaultTopK = options.topK;
    this.defaultFrequencyPenalty = options.frequencyPenalty;
    this.defaultPresencePenalty = options.presencePenalty;
    this.defaultThinkingEnabled = options.thinkingEnabled;
    this.thinkingConfig = options.thinkingConfig;
  }

  // -----------------------------------------------------------------------
  // chat() - non-streaming completion
  // -----------------------------------------------------------------------

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    const url = `${this.endpoint}/chat/completions`;
    const body = this.buildRequestBody(messages, options, false);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(
        `OpenAI-compatible provider "${this.name}" returned HTTP ${response.status}: ${errorText}`,
      );
    }

    let data: OpenAIResponse;
    try {
      data = (await response.json()) as OpenAIResponse;
    } catch (err) {
      throw new Error(
        `OpenAI-compatible provider "${this.name}" returned malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!data.choices || data.choices.length === 0) {
      throw new Error(
        `OpenAI-compatible provider "${this.name}" returned no choices`,
      );
    }

    const choice = data.choices[0];
    const content = choice.message?.content ?? "";
    const toolCalls = this.parseToolCalls(choice);

    return {
      content,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
      finishReason: choice.finish_reason ?? undefined,
    };
  }

  // -----------------------------------------------------------------------
  // chatStream() - SSE streaming completion
  // -----------------------------------------------------------------------

  async *chatStream(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    const url = `${this.endpoint}/chat/completions`;
    const body = this.buildRequestBody(messages, options, true);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err) {
      yield {
        type: "error",
        error: `Network error from provider "${this.name}": ${err instanceof Error ? err.message : String(err)}`,
      };
      return;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      yield {
        type: "error",
        error: `Provider "${this.name}" returned HTTP ${response.status}: ${errorText}`,
      };
      return;
    }

    if (!response.body) {
      yield {
        type: "error",
        error: `Provider "${this.name}" returned no response body for streaming request`,
      };
      return;
    }

    // Accumulator for tool calls that arrive across multiple SSE chunks
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE lines are separated by double newlines
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "" || trimmed === ":") continue;

          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              // Emit final done chunk
              const finishReason = this.lastFinishReason;
              yield { type: "done", finishReason };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              this.processStreamChunk(parsed, toolCallAccumulator);
            } catch {
              // Skip malformed JSON lines silently
              continue;
            }

            // Yield chunks based on what was parsed
            yield* this.yieldStreamChunks(
              JSON.parse(data),
              toolCallAccumulator,
            );
          }
        }
      }
    } catch (err) {
      if (options.signal?.aborted) {
        yield { type: "done", finishReason: "cancelled" };
      } else {
        yield {
          type: "error",
          error: `Stream error from provider "${this.name}": ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Track the last finish reason across stream chunks
  private lastFinishReason: string | undefined;

  // -----------------------------------------------------------------------
  // estimateTokens() - CJK-aware token estimation
  // -----------------------------------------------------------------------

  estimateTokens(text: string): number {
    let tokens = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;

      if (code > 0xffff) {
        // Supplementary plane: emoji and other 4-byte unicode
        tokens += 2;
      } else if (
        // CJK Unified Ideographs
        (code >= 0x4e00 && code <= 0x9fff) ||
        // CJK Extension A
        (code >= 0x3400 && code <= 0x4dbf) ||
        // CJK Compatibility Ideographs
        (code >= 0xf900 && code <= 0xfaff) ||
        // Hiragana
        (code >= 0x3040 && code <= 0x309f) ||
        // Katakana
        (code >= 0x30a0 && code <= 0x30ff) ||
        // Hangul Syllables
        (code >= 0xac00 && code <= 0xd7a3)
      ) {
        tokens += 1.5;
      } else if (code <= 0x7f) {
        // ASCII
        tokens += 0.25;
      } else {
        // Other non-ASCII in BMP (e.g. accented Latin, Cyrillic, etc.)
        tokens += 0.5;
      }
    }
    return Math.ceil(tokens);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildRequestBody(
    messages: ChatMessage[],
    options: ChatOptions,
    stream: boolean,
  ): Record<string, unknown> {
    const openaiMessages: OpenAIMessage[] = messages.map((msg) => {
      const oai: OpenAIMessage = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.toolCallId) {
        oai.tool_call_id = msg.toolCallId;
      }
      if (msg.toolCalls) {
        oai.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }
      return oai;
    });

    const body: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      messages: openaiMessages,
      stream,
    };

    // Only send max_tokens when explicitly configured.
    // When omitted, the API provider uses its own model-specific default,
    // which avoids mismatched limits across different providers.
    // Per-request overrides take precedence over provider defaults.
    const maxTokens = options.maxTokens ?? this.defaultMaxTokens;
    if (maxTokens > 0) {
      body.max_tokens = maxTokens;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    } else if (this.defaultTemperature !== undefined) {
      body.temperature = this.defaultTemperature;
    }

    if (this.defaultTopP !== undefined) {
      body.top_p = this.defaultTopP;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
    }

    // Thinking/reasoning parameter injection
    if (this.defaultThinkingEnabled && this.thinkingConfig) {
      const value = this.defaultThinkingEnabled
        ? this.thinkingConfig.values.enabled
        : this.thinkingConfig.values.disabled;
      body[this.thinkingConfig.field] = value;
    }

    // Optional sampling parameters
    if (this.defaultTopK !== undefined) {
      body.top_k = this.defaultTopK;
    }
    if (this.defaultFrequencyPenalty !== undefined) {
      body.frequency_penalty = this.defaultFrequencyPenalty;
    }
    if (this.defaultPresencePenalty !== undefined) {
      body.presence_penalty = this.defaultPresencePenalty;
    }

    return body;
  }

  private formatTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  private parseToolCalls(
    choice: OpenAIChoice,
  ): ToolCall[] | undefined {
    const raw = choice.message?.tool_calls;
    if (!raw || raw.length === 0) return undefined;

    return raw.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }

  /**
   * Process a single SSE chunk to track tool call state.
   * We accumulate tool call fragments across stream chunks.
   */
  private processStreamChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsed: any,
    accumulator: Map<number, { id: string; name: string; arguments: string }>,
  ): void {
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;

    // Track finish reason
    const finishReason = parsed.choices?.[0]?.finish_reason;
    if (finishReason) {
      this.lastFinishReason = finishReason;
    }

    // Handle tool call deltas
    const toolCalls = delta.tool_calls;
    if (toolCalls && Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const idx: number = tc.index ?? 0;
        const existing = accumulator.get(idx);

        if (tc.id) {
          // New tool call starting
          accumulator.set(idx, {
            id: tc.id,
            name: tc.function?.name ?? existing?.name ?? "",
            arguments: tc.function?.arguments ?? existing?.arguments ?? "",
          });
        } else if (existing) {
          // Continuation of existing tool call
          if (tc.function?.name) {
            existing.name += tc.function.name;
          }
          if (tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
          }
        }
      }
    }
  }

  /**
   * Yield StreamChunk instances from a parsed SSE JSON object.
   */
  private *yieldStreamChunks(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsed: any,
    accumulator: Map<number, { id: string; name: string; arguments: string }>,
  ): Generator<StreamChunk> {
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;

    // Text content delta
    if (typeof delta.content === "string" && delta.content !== "") {
      yield { type: "text", content: delta.content };
    }

    // Tool call deltas
    const toolCalls = delta.tool_calls;
    if (toolCalls && Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const idx: number = tc.index ?? 0;
        const accumulated = accumulator.get(idx);

        if (tc.id && accumulated) {
          // New tool call beginning - yield the complete tool call
          yield {
            type: "tool_call",
            toolCall: {
              id: accumulated.id,
              type: "function",
              function: {
                name: accumulated.name,
                arguments: accumulated.arguments,
              },
            },
          };
        } else {
          // Delta for an ongoing tool call
          yield {
            type: "tool_call_delta",
            toolCall: {
              id: tc.id,
              type: "function",
              function: {
                name: tc.function?.name,
                arguments: tc.function?.arguments,
              },
            },
          };
        }
      }
    }
  }
}
