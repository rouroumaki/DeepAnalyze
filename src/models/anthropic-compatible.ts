/**
 * anthropic-compatible.ts - Anthropic Messages API protocol adapter
 *
 * Implements the ModelProvider interface for any backend that exposes an
 * Anthropic-compatible Messages API endpoint (z.ai proxy, Anthropic direct, etc.).
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

export interface AnthropicCompatibleOptions {
  /** Human-readable name for this provider instance. */
  name: string;

  /** Base endpoint URL (e.g. "https://api.z.ai/api/anthropic/v1"). */
  endpoint: string;

  /** API key - sent as x-api-key header. */
  apiKey?: string;

  /** Default model to use when ChatOptions.model is not provided. */
  model: string;

  /** Default maximum tokens for responses. Anthropic requires this. */
  maxTokens?: number;

  /** Default sampling temperature (0-2). */
  temperature?: number;

  /** Default nucleus sampling threshold (0-1). */
  topP?: number;

  /** Default top-k sampling. */
  topK?: number;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class AnthropicCompatibleProvider implements ModelProvider {
  readonly name: string;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number | undefined;
  private readonly defaultTopP: number | undefined;
  private readonly defaultTopK: number | undefined;

  constructor(options: AnthropicCompatibleOptions) {
    this.name = options.name;
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.defaultModel = options.model;
    this.defaultMaxTokens = options.maxTokens || 8192;
    this.defaultTemperature = options.temperature;
    this.defaultTopP = options.topP;
    this.defaultTopK = options.topK;
  }

  // -----------------------------------------------------------------------
  // chat() - non-streaming completion
  // -----------------------------------------------------------------------

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    const url = `${this.endpoint}/messages`;
    const body = this.buildRequestBody(messages, options, false);

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(
        `Anthropic-compatible provider "${this.name}" returned HTTP ${response.status}: ${errorText}`,
      );
    }

    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Anthropic-compatible provider "${this.name}" returned malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.parseResponse(data);
  }

  // -----------------------------------------------------------------------
  // chatStream() - SSE streaming completion
  // -----------------------------------------------------------------------

  async *chatStream(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    const url = `${this.endpoint}/messages`;
    const body = this.buildRequestBody(messages, options, true);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(),
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

    // Anthropic SSE: event types are message_start, content_block_start,
    // content_block_delta, content_block_stop, message_delta, message_stop
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    let streamUsage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined;
    let finishReason: string | undefined;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEventType = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "" || trimmed.startsWith(":")) continue;

          if (trimmed.startsWith("event: ")) {
            currentEventType = trimmed.slice(7).trim();
            continue;
          }

          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(dataStr);

              // message_start: capture initial usage
              if (currentEventType === "message_start") {
                const msg = parsed.message as Record<string, unknown> | undefined;
                if (msg?.usage) {
                  const u = msg.usage as Record<string, number>;
                  streamUsage = {
                    inputTokens: u.input_tokens ?? 0,
                    outputTokens: u.output_tokens ?? 0,
                  };
                }
              }

              // content_block_start: new text or tool_use block
              if (currentEventType === "content_block_start") {
                const block = parsed.content_block as Record<string, unknown> | undefined;
                if (block?.type === "tool_use") {
                  const idx = parsed.index as number ?? 0;
                  toolCallAccumulator.set(idx, {
                    id: block.id as string ?? "",
                    name: block.name as string ?? "",
                    arguments: "",
                  });
                }
              }

              // content_block_delta: text or tool input streaming
              if (currentEventType === "content_block_delta") {
                const delta = parsed.delta as Record<string, unknown> | undefined;
                const idx = (parsed.index as number) ?? 0;

                if (delta?.type === "text_delta" && typeof delta.text === "string") {
                  yield { type: "text", content: delta.text };
                } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
                  const acc = toolCallAccumulator.get(idx);
                  if (acc) {
                    acc.arguments += delta.partial_json;
                    yield {
                      type: "tool_call_delta",
                      toolCall: {
                        id: acc.id,
                        type: "function",
                        function: { name: acc.name, arguments: delta.partial_json },
                      },
                    };
                  }
                }
              }

              // content_block_stop: finalize tool call
              if (currentEventType === "content_block_stop") {
                const idx = (parsed.index as number) ?? 0;
                const acc = toolCallAccumulator.get(idx);
                if (acc) {
                  // Try to parse arguments as JSON to ensure valid format
                  try {
                    JSON.parse(acc.arguments);
                  } catch {
                    // If not valid JSON, try to fix common issues
                    if (!acc.arguments.startsWith("{")) {
                      acc.arguments = "{}";
                    }
                  }
                  yield {
                    type: "tool_call",
                    toolCall: {
                      id: acc.id,
                      type: "function",
                      function: { name: acc.name, arguments: acc.arguments },
                    },
                  };
                }
              }

              // message_delta: stop_reason and final usage
              if (currentEventType === "message_delta") {
                const delta = parsed.delta as Record<string, unknown> | undefined;
                if (delta?.stop_reason) {
                  finishReason = this.mapStopReason(delta.stop_reason as string);
                }
                if (parsed.usage) {
                  const u = parsed.usage as Record<string, number>;
                  if (streamUsage) {
                    streamUsage.outputTokens = u.output_tokens ?? streamUsage.outputTokens;
                  }
                }
              }

              // message_stop: stream complete
              if (currentEventType === "message_stop") {
                yield { type: "done", finishReason, usage: streamUsage };
                return;
              }
            } catch {
              continue;
            }
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

  // -----------------------------------------------------------------------
  // estimateTokens() - CJK-aware token estimation
  // -----------------------------------------------------------------------

  estimateTokens(text: string): number {
    let tokens = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (code > 0xffff) {
        tokens += 2;
      } else if (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0x3040 && code <= 0x309f) ||
        (code >= 0x30a0 && code <= 0x30ff) ||
        (code >= 0xac00 && code <= 0xd7a3)
      ) {
        tokens += 1.5;
      } else if (code <= 0x7f) {
        tokens += 0.25;
      } else {
        tokens += 0.5;
      }
    }
    return Math.ceil(tokens);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }
    return headers;
  }

  private buildRequestBody(
    messages: ChatMessage[],
    options: ChatOptions,
    stream: boolean,
  ): Record<string, unknown> {
    // Extract system messages separately (Anthropic uses top-level system field)
    const systemParts: string[] = [];
    const anthropicMessages: Record<string, unknown>[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        const text = typeof msg.content === "string"
          ? msg.content
          : msg.content.filter((p): p is ContentPart & { type: "text" } => "text" in p).map(p => p.text).join("\n");
        if (text) systemParts.push(text);
      } else if (msg.role === "tool") {
        // Convert tool result to Anthropic's tool_result content block
        const resultContent = typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
        anthropicMessages.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: msg.toolCallId ?? "",
            content: resultContent,
          }],
        });
      } else if (msg.role === "assistant") {
        // Convert assistant message with potential tool_calls
        const content: Record<string, unknown>[] = [];

        // Add text content
        const text = typeof msg.content === "string"
          ? msg.content
          : msg.content.filter((p): p is ContentPart & { type: "text" } => "text" in p).map(p => p.text).join("\n");
        if (text) {
          content.push({ type: "text", text });
        }

        // Add tool_use blocks
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            let input: Record<string, unknown>;
            try {
              input = JSON.parse(tc.function.arguments);
            } catch {
              input = {};
            }
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input,
            });
          }
        }

        anthropicMessages.push({ role: "assistant", content });
      } else {
        // user message
        anthropicMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const body: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      messages: anthropicMessages,
      stream,
    };

    if (systemParts.length > 0) {
      body.system = systemParts.join("\n\n");
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    } else if (this.defaultTemperature !== undefined) {
      body.temperature = this.defaultTemperature;
    }

    if (this.defaultTopP !== undefined) {
      body.top_p = this.defaultTopP;
    }
    if (this.defaultTopK !== undefined) {
      body.top_k = this.defaultTopK;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    }

    return body;
  }

  private parseResponse(data: Record<string, unknown>): ChatResponse {
    const contentBlocks = (data.content as Record<string, unknown>[]) ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === "text") {
        text += block.text as string ?? "";
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id as string,
          type: "function",
          function: {
            name: block.name as string,
            arguments: typeof block.input === "string"
              ? block.input
              : JSON.stringify(block.input ?? {}),
          },
        });
      }
    }

    const stopReason = data.stop_reason as string | undefined;

    return {
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage
        ? {
            inputTokens: (data.usage as Record<string, number>).input_tokens ?? 0,
            outputTokens: (data.usage as Record<string, number>).output_tokens ?? 0,
          }
        : undefined,
      finishReason: stopReason ? this.mapStopReason(stopReason) : undefined,
    };
  }

  private mapStopReason(reason: string): string {
    switch (reason) {
      case "end_turn": return "stop";
      case "tool_use": return "tool_calls";
      case "max_tokens": return "length";
      case "stop_sequence": return "stop";
      default: return reason;
    }
  }
}
