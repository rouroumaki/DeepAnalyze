import { afterEach, describe, expect, test } from "bun:test";
import { OpenAICompatibleProvider } from "../src/models/openai-compatible.js";
import type { ChatMessage } from "../src/models/provider.js";

const originalFetch = globalThis.fetch;

function createMessages(): ChatMessage[] {
  return [{ role: "user", content: "hello" }];
}

function createUnsupportedMaxTokensErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        message:
          "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        type: "invalid_request_error",
        param: "max_tokens",
        code: "unsupported_parameter",
      },
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function createChatSuccessResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function createStreamSuccessResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAICompatibleProvider token parameter compatibility", () => {
  test("chat retries with max_completion_tokens when max_tokens is unsupported", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let call = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestBodies.push(parsedBody);
      call++;

      if (call === 1) {
        return createUnsupportedMaxTokensErrorResponse();
      }
      return createChatSuccessResponse("ok");
    }) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider({
      name: "openai",
      endpoint: "https://api.openai.com/v1",
      apiKey: "test",
      model: "gpt-5.4",
      maxTokens: 4096,
    });

    const result = await provider.chat(createMessages(), {});
    expect(result.content).toBe("ok");
    expect(requestBodies.length).toBe(2);
    expect(requestBodies[0].max_tokens).toBe(4096);
    expect(requestBodies[0].max_completion_tokens).toBeUndefined();
    expect(requestBodies[1].max_tokens).toBeUndefined();
    expect(requestBodies[1].max_completion_tokens).toBe(4096);
  });

  test("chatStream retries with max_completion_tokens when max_tokens is unsupported", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let call = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestBodies.push(parsedBody);
      call++;

      if (call === 1) {
        return createUnsupportedMaxTokensErrorResponse();
      }
      return createStreamSuccessResponse();
    }) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider({
      name: "openai",
      endpoint: "https://api.openai.com/v1",
      apiKey: "test",
      model: "gpt-5.4",
      maxTokens: 2048,
    });

    const chunks = [];
    for await (const chunk of provider.chatStream(createMessages(), {})) {
      chunks.push(chunk);
    }

    expect(requestBodies.length).toBe(2);
    expect(requestBodies[0].max_tokens).toBe(2048);
    expect(requestBodies[1].max_completion_tokens).toBe(2048);
    expect(chunks.some((c) => c.type === "text" && c.content === "hi")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });
});
