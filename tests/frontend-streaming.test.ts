import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api } from "../frontend/src/api/client.js";
import { useChatStore } from "../frontend/src/store/chat.js";

const originalFetch = globalThis.fetch;
const originalRunAgentStream = api.runAgentStream;
const originalGetAgentTasks = api.getAgentTasks;

function createStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function resetChatStore(): void {
  useChatStore.setState({
    sessions: [],
    currentSessionId: null,
    messages: [],
    agentTasks: [],
    isLoading: false,
    isSending: false,
    isStreaming: false,
    error: null,
    streamingMessageId: null,
    streamingContent: "",
    streamingToolCalls: [],
  });
}

describe("frontend streaming error handling", () => {
  beforeEach(() => {
    resetChatStore();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    api.runAgentStream = originalRunAgentStream;
    api.getAgentTasks = originalGetAgentTasks;
    resetChatStore();
  });

  test("runAgentStream parses error and done SSE frames split across chunks", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];

    const mockedFetch = (async () =>
      createStreamResponse([
        'event: error\ndata: {"taskId":"task-1","error":"Agent failed: ',
        `OpenAI-compatible provider \\"default\\" returned HTTP 404"}\n\n`,
        'event: done\ndata: {"taskId":"task-1","status":"failed","error":"Agent failed: ',
        `OpenAI-compatible provider \\"default\\" returned HTTP 404"}\n\n`,
      ])) as unknown as typeof fetch;
    globalThis.fetch = mockedFetch;

    const { promise } = api.runAgentStream("session-1", "hello", undefined, {
      onError: (data) => events.push({ type: "error", payload: data }),
      onDone: (data) => events.push({ type: "done", payload: data }),
    });

    await promise;

    expect(events).toEqual([
      {
        type: "error",
        payload: {
          taskId: "task-1",
          error: 'Agent failed: OpenAI-compatible provider "default" returned HTTP 404',
        },
      },
      {
        type: "done",
        payload: {
          taskId: "task-1",
          status: "failed",
          error: 'Agent failed: OpenAI-compatible provider "default" returned HTTP 404',
        },
      },
    ]);
  });

  test("sendMessage keeps the failure text in the assistant message when the stream fails", async () => {
    const failureText = 'Agent failed: OpenAI-compatible provider "default" returned HTTP 404';

    api.getAgentTasks = async () => [];
    api.runAgentStream = (_sessionId, _input, _agentType, callbacks) => {
      callbacks?.onError?.({ taskId: "task-1", error: failureText });
      callbacks?.onDone?.({ taskId: "task-1", status: "failed" });
      return {
        abort: () => {},
        promise: Promise.resolve(),
      };
    };

    useChatStore.setState({
      currentSessionId: "session-1",
      messages: [],
      error: null,
    });

    await useChatStore.getState().sendMessage("hello");

    const state = useChatStore.getState();
    const assistantMessage = state.messages.find((message) => message.role === "assistant");

    expect(assistantMessage?.content).toBe(failureText);
    expect(state.error).toBe(failureText);
    expect(state.isStreaming).toBe(false);
  });

  test("sendMessage keeps failure output when done status is completed but error/complete events exist", async () => {
    const failureText = 'Agent failed: OpenAI-compatible provider "default" returned HTTP 404';

    api.getAgentTasks = async () => [];
    api.runAgentStream = (_sessionId, _input, _agentType, callbacks) => {
      callbacks?.onError?.({ taskId: "task-2", error: failureText });
      callbacks?.onComplete?.({ taskId: "task-2", output: failureText, toolCalls: [] });
      callbacks?.onDone?.({ taskId: "task-2", status: "completed" });
      return {
        abort: () => {},
        promise: Promise.resolve(),
      };
    };

    useChatStore.setState({
      currentSessionId: "session-2",
      messages: [],
      error: null,
    });

    await useChatStore.getState().sendMessage("hello");

    const state = useChatStore.getState();
    const assistantMessage = state.messages.find((message) => message.role === "assistant");

    expect(assistantMessage?.content).toBe(failureText);
    expect(state.error).toBe(failureText);
    expect(state.isStreaming).toBe(false);
  });
});
