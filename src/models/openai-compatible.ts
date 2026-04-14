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

  /** Default maximum tokens for responses. */
  maxTokens: number;
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
  content: string | null;
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
  private readonly defaultMaxTokens: number;

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.name;
    // Trim trailing slash so we can safely append paths
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.defaultModel = options.model;
    this.defaultMaxTokens = options.maxTokens;
  }

  // -----------------------------------------------------------------------
  // chat() - non-streaming completion
  // -----------------------------------------------------------------------

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    const { response, errorText } = await this.postChatCompletionsWithFallback(
      messages,
      options,
      false,
    );

    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible provider "${this.name}" returned HTTP ${response.status}: ${errorText ?? "unknown error"}`,
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
    let requestResult: { response: Response; errorText?: string };
    try {
      requestResult = await this.postChatCompletionsWithFallback(
        messages,
        options,
        true,
      );
    } catch (err) {
      yield {
        type: "error",
        error: `Network error from provider "${this.name}": ${err instanceof Error ? err.message : String(err)}`,
      };
      return;
    }

    const response = requestResult.response;
    if (!response.ok) {
      yield {
        type: "error",
        error: `Provider "${this.name}" returned HTTP ${response.status}: ${requestResult.errorText ?? "unknown error"}`,
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
    tokenParamName: "max_tokens" | "max_completion_tokens" = "max_tokens",
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
    body[tokenParamName] = options.maxTokens ?? this.defaultMaxTokens;

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
    }

    return body;
  }

  private async postChatCompletionsWithFallback(
    messages: ChatMessage[],
    options: ChatOptions,
    stream: boolean,
  ): Promise<{ response: Response; errorText?: string }> {
    const firstAttempt = await this.postChatCompletions(
      this.buildRequestBody(messages, options, stream, "max_tokens"),
      options.signal,
    );

    if (firstAttempt.response.ok) {
      return firstAttempt;
    }

    if (
      !this.isUnsupportedMaxTokensError(
        firstAttempt.response.status,
        firstAttempt.errorText,
      )
    ) {
      return firstAttempt;
    }

    // Compatibility path for newer OpenAI models (e.g. GPT-5.x) that
    // reject max_tokens and require max_completion_tokens.
    return this.postChatCompletions(
      this.buildRequestBody(messages, options, stream, "max_completion_tokens"),
      options.signal,
    );
  }

  private async postChatCompletions(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ response: Response; errorText?: string }> {
    const url = `${this.endpoint}/chat/completions`;
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
      signal,
    });

    if (response.ok) {
      return { response };
    }

    const errorText = await response.text().catch(() => "unknown error");
    return { response, errorText };
  }

  private isUnsupportedMaxTokensError(
    status: number,
    errorText: string | undefined,
  ): boolean {
    if (status !== 400 || !errorText) return false;

    const lower = errorText.toLowerCase();
    return (
      lower.includes("unsupported parameter") &&
      lower.includes("max_tokens") &&
      lower.includes("max_completion_tokens")
    );
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
