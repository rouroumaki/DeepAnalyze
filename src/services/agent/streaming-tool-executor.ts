// streaming-tool-executor.ts

import type { AgentTool } from "./types.js";
import type { ToolCall, ChatMessage } from "../../models/provider.js";
import type { StreamChunk } from "../../models/provider.js";

// ---------------------------------------------------------------------------
// TrackedTool — per-tool execution state
// ---------------------------------------------------------------------------

type ToolStatus = "queued" | "executing" | "completed" | "yielded";

interface TrackedTool {
  id: string;
  toolCall: ToolCall;
  status: ToolStatus;
  isConcurrencySafe: boolean;
  promise: Promise<void> | null;
  result: ChatMessage | null;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// StreamingToolExecutor
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONCURRENCY = 10;

/**
 * Executes tools as they arrive from the streaming API response.
 *
 * As the model streams tool_use blocks, each complete block is added via addTool().
 * The executor checks concurrency safety and starts execution immediately when possible:
 * - If no tools are running: start immediately
 * - If running tools are all concurrency-safe AND new tool is also safe: start immediately
 * - Otherwise: wait until running tools complete
 *
 * Reference: refcode/claude-code/src/services/tools/StreamingToolExecutor.ts
 */
export class StreamingToolExecutor {
  private tools: Map<string, AgentTool>;
  private executeFn: (toolCall: ToolCall) => Promise<ChatMessage>;
  private maxConcurrency: number;

  private tracked: TrackedTool[] = [];
  private executing: Set<TrackedTool> = new Set();
  private aborted = false;

  constructor(
    tools: Map<string, AgentTool>,
    executeFn: (toolCall: ToolCall) => Promise<ChatMessage>,
    maxConcurrency: number = DEFAULT_MAX_CONCURRENCY,
  ) {
    this.tools = tools;
    this.executeFn = executeFn;
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Add a complete tool call to the execution queue.
   * May start executing immediately if concurrency rules allow.
   */
  addTool(toolCall: ToolCall): void {
    if (this.aborted) return;

    const tool = this.tools.get(toolCall.function.name);
    let safe = false;

    if (tool) {
      try {
        const input = JSON.parse(toolCall.function.arguments);
        if (tool.isConcurrencySafe) {
          safe = tool.isConcurrencySafe(input);
        } else if (tool.isReadOnly) {
          safe = tool.isReadOnly(input);
        }
      } catch {
        safe = false;
      }
    }

    const tracked: TrackedTool = {
      id: toolCall.id,
      toolCall,
      status: "queued",
      isConcurrencySafe: safe,
      promise: null,
      result: null,
      error: null,
    };

    this.tracked.push(tracked);
    this.processQueue();
  }

  /**
   * Process the queue: start executing tools that can run.
   */
  private processQueue(): void {
    for (const tool of this.tracked) {
      if (tool.status !== "queued") continue;
      if (!this.canExecute(tool.isConcurrencySafe)) continue;
      this.startExecution(tool);
    }
  }

  /**
   * Check if a tool can start executing based on current running tools.
   */
  private canExecute(isSafe: boolean): boolean {
    if (this.aborted) return false;
    if (this.executing.size === 0) return true;
    if (this.executing.size >= this.maxConcurrency) return false;

    if (isSafe) {
      for (const running of this.executing) {
        if (!running.isConcurrencySafe) return false;
      }
      return true;
    }

    return false; // Non-safe tools must wait for all to complete
  }

  /**
   * Start executing a tracked tool.
   */
  private startExecution(tracked: TrackedTool): void {
    tracked.status = "executing";
    this.executing.add(tracked);

    tracked.promise = this.executeFn(tracked.toolCall)
      .then((result) => {
        tracked.result = result;
        tracked.status = "completed";
      })
      .catch((err) => {
        tracked.error = err instanceof Error ? err : new Error(String(err));
        tracked.status = "completed";
      })
      .finally(() => {
        this.executing.delete(tracked);
        this.processQueue();
      });
  }

  /**
   * Wait for all tools to complete and return results in original order.
   * Loops to handle tools that haven't started yet (no promise).
   */
  async getResults(): Promise<ChatMessage[]> {
    // Spin until every tracked tool has finished (completed or yielded/discarded).
    // Tools that are still queued won't have a promise yet, so we must wait for
    // the executing tools to finish which triggers processQueue() → startExecution().
    for (;;) {
      const promises = this.tracked
        .filter(t => t.promise)
        .map(t => t.promise!);

      if (promises.length === 0) break;

      // Are all tools resolved?
      const allDone = this.tracked.every(
        t => t.status === "completed" || t.status === "yielded",
      );
      if (allDone) break;

      await Promise.all(promises);
    }

    const results: ChatMessage[] = [];
    for (const tracked of this.tracked) {
      if (tracked.error) {
        results.push({
          role: "tool",
          content: JSON.stringify({ error: tracked.error.message }),
          toolCallId: tracked.toolCall.id,
        } as ChatMessage);
      } else if (tracked.result) {
        results.push(tracked.result);
      }
    }
    return results;
  }

  /**
   * Abort all pending and executing tools (for streaming fallback).
   */
  discard(): void {
    this.aborted = true;
    for (const tracked of this.tracked) {
      if (tracked.status === "queued" || tracked.status === "executing") {
        tracked.status = "yielded";
      }
    }
  }

  /**
   * Get count of completed tools.
   */
  get completedCount(): number {
    return this.tracked.filter(t => t.status === "completed").length;
  }

  /**
   * Get count of total tools.
   */
  get totalCount(): number {
    return this.tracked.length;
  }
}

// ---------------------------------------------------------------------------
// Stream consumer with streaming tool execution
// ---------------------------------------------------------------------------

/**
 * Consume a model stream while executing tools as they arrive.
 * Returns full text content + all tool results (concurrently optimized).
 */
export async function consumeStreamWithToolExecution(
  stream: AsyncGenerator<StreamChunk>,
  tools: Map<string, AgentTool>,
  executeFn: (toolCall: ToolCall) => Promise<ChatMessage>,
  onTextDelta?: (delta: string) => void,
  maxConcurrency?: number,
): Promise<{
  content: string;
  toolResults: ChatMessage[];
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
}> {
  let fullContent = "";
  let finishReason: string | undefined;
  let usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined;

  // Accumulate incomplete tool_call blocks
  const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let streamingToolExecutor: StreamingToolExecutor | null = null;

  for await (const chunk of stream) {
    switch (chunk.type) {
      case "text":
        if (chunk.content) {
          fullContent += chunk.content;
          onTextDelta?.(chunk.content);
        }
        break;

      case "tool_call":
        if (chunk.toolCall?.id) {
          const tc = chunk.toolCall;
          // Use a numeric key based on map size for ordering
          const key = pendingToolCalls.size;
          pendingToolCalls.set(key, {
            id: tc.id,
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "",
          });
        }
        break;

      case "tool_call_delta":
        if (chunk.toolCall?.function?.arguments && pendingToolCalls.size > 0) {
          const lastKey = Array.from(pendingToolCalls.keys()).pop()!;
          const existing = pendingToolCalls.get(lastKey)!;
          existing.arguments += chunk.toolCall.function.arguments;
        }
        break;

      case "done":
        finishReason = chunk.finishReason;
        usage = chunk.usage;

        // Stream done — construct tool calls and execute
        if (pendingToolCalls.size > 0) {
          streamingToolExecutor = new StreamingToolExecutor(tools, executeFn, maxConcurrency);

          for (const [, tc] of pendingToolCalls) {
            const toolCall: ToolCall = {
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            };
            streamingToolExecutor.addTool(toolCall);
          }
        }
        break;

      case "error":
        throw new Error(chunk.error ?? "Stream error");
    }
  }

  let toolResults: ChatMessage[] = [];
  if (streamingToolExecutor) {
    toolResults = await streamingToolExecutor.getResults();
  }

  return { content: fullContent, toolResults, finishReason, usage };
}
