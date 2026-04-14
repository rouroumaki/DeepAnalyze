// =============================================================================
// DeepAnalyze - AgentRunner Tests
// =============================================================================
// Tests the TAOR (Think-Act-Observe-Reflect) loop with a mock ModelRouter.

import { describe, test, expect } from "bun:test";
import { ToolRegistry } from "../src/services/agent/tool-registry.js";
import { AgentRunner } from "../src/services/agent/agent-runner.js";
import type { ChatResponse } from "../src/models/provider.js";

// ---------------------------------------------------------------------------
// Mock ModelRouter
// ---------------------------------------------------------------------------

/**
 * Creates a mock ModelRouter that returns pre-configured responses in sequence.
 * When all responses are consumed, it repeats the last one indefinitely.
 */
function createMockRouter(responses: ChatResponse[]) {
  let callIndex = 0;
  return {
    chat: async (_messages: any, _options?: any): Promise<ChatResponse> => {
      const response =
        callIndex < responses.length
          ? responses[callIndex]
          : responses[responses.length - 1];
      callIndex++;
      return response;
    },
    getDefaultModel: (_role?: string) => "mock-model",
    estimateTokens: (_text: string) => 100,
    initialize: async () => {},
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRunner", () => {
  test("runs a simple agent task with text response (finishReason: stop)", async () => {
    const registry = new ToolRegistry();
    const mockRouter = createMockRouter([
      {
        content: "Hello, I analyzed your request.",
        toolCalls: undefined,
        finishReason: "stop",
        usage: { inputTokens: 50, outputTokens: 20 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);
    const result = await runner.run({
      input: "Analyze this document",
    });

    expect(result.output).toBe("Hello, I analyzed your request.");
    expect(result.toolCallsCount).toBe(0);
    expect(result.usage.inputTokens).toBe(50);
    expect(result.usage.outputTokens).toBe(20);
  });

  test("runs an agent that calls the finish tool", async () => {
    const registry = new ToolRegistry();
    const mockRouter = createMockRouter([
      {
        content: "Let me finish this task.",
        toolCalls: [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "finish",
              arguments: '{"summary": "Task completed successfully"}',
            },
          },
        ],
        finishReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);
    const result = await runner.run({
      input: "Complete this task",
    });

    expect(result.toolCallsCount).toBe(1);
    expect(result.output).toBeDefined();
    expect(result.output.length).toBeGreaterThan(0);
  });

  test("executes think tool and continues loop", async () => {
    const registry = new ToolRegistry();

    // First response: call think tool
    // Second response: text completion
    const mockRouter = createMockRouter([
      {
        content: "Let me think about this...",
        toolCalls: [
          {
            id: "call_think",
            type: "function" as const,
            function: {
              name: "think",
              arguments: '{"thought": "I need to analyze the document"}',
            },
          },
        ],
        finishReason: "tool_use",
        usage: { inputTokens: 50, outputTokens: 30 },
      },
      {
        content: "After thinking, here is my analysis: the document is about testing.",
        toolCalls: undefined,
        finishReason: "stop",
        usage: { inputTokens: 60, outputTokens: 40 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);
    const result = await runner.run({
      input: "Analyze this",
    });

    expect(result.toolCallsCount).toBe(1);
    expect(result.output).toContain("After thinking, here is my analysis");
    expect(result.usage.inputTokens).toBe(110); // 50 + 60
    expect(result.usage.outputTokens).toBe(70); // 30 + 40
  });

  test("respects maxTurns limit when agent keeps looping", async () => {
    const registry = new ToolRegistry();

    // Router that always returns a think tool call (never stops on its own)
    const mockRouter = createMockRouter([
      {
        content: "Thinking...",
        toolCalls: [
          {
            id: "call_think",
            type: "function" as const,
            function: {
              name: "think",
              arguments: '{"thought": "Still thinking..."}',
            },
          },
        ],
        finishReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);
    const maxTurns = 3;
    const result = await runner.run({
      input: "Loop forever",
      maxTurns,
    });

    // Should eventually stop (hard limit is advisoryLimit * 3, with possible off-by-one)
    // The agent keeps calling the think tool, so it runs until hard limit is reached
    expect(result.turnsUsed).toBeGreaterThan(0);
    expect(result.turnsUsed).toBeLessThanOrEqual(maxTurns * 3 + 1);
    // Each turn calls the think tool once
    expect(result.toolCallsCount).toBeGreaterThan(0);
  });

  test("emits start and complete events", async () => {
    const registry = new ToolRegistry();
    const events: any[] = [];

    const mockRouter = createMockRouter([
      {
        content: "Done",
        toolCalls: undefined,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);
    await runner.run({
      input: "Test events",
      onEvent: (event) => events.push(event),
    });

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("start");
    expect(eventTypes).toContain("complete");
    expect(eventTypes).toContain("turn");
  });

  test("emits tool_call and tool_result events when tools are used", async () => {
    const registry = new ToolRegistry();
    const events: any[] = [];

    const mockRouter = createMockRouter([
      {
        content: "Calling think",
        toolCalls: [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "think",
              arguments: '{"thought": "Planning"}',
            },
          },
        ],
        finishReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        content: "Final answer",
        toolCalls: undefined,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);
    await runner.run({
      input: "Test tool events",
      onEvent: (event) => events.push(event),
    });

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("tool_call");
    expect(eventTypes).toContain("tool_result");

    const toolCallEvent = events.find((e) => e.type === "tool_call");
    expect(toolCallEvent.toolName).toBe("think");
  });

  test("handles error from model router gracefully", async () => {
    const registry = new ToolRegistry();
    const events: any[] = [];

    const mockRouter = {
      chat: async () => {
        throw new Error("Model unavailable");
      },
      getDefaultModel: () => "mock-model",
    } as any;

    const runner = new AgentRunner(mockRouter, registry);
    const result = await runner.run({
      input: "This should fail",
      onEvent: (event) => events.push(event),
    });

    expect(result.output).toContain("Agent failed");
    expect(result.output).toContain("Model unavailable");
    expect(result.toolCallsCount).toBe(0);

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("error");
  });

  test("handles tool call with invalid JSON arguments", async () => {
    const registry = new ToolRegistry();
    const events: any[] = [];

    const mockRouter = createMockRouter([
      {
        content: "Calling tool with bad args",
        toolCalls: [
          {
            id: "call_bad",
            type: "function" as const,
            function: {
              name: "think",
              arguments: "not valid json{{{",
            },
          },
        ],
        finishReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        content: "Recovered after bad tool call",
        toolCalls: undefined,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);
    const result = await runner.run({
      input: "Test bad args",
      onEvent: (event) => events.push(event),
    });

    // Should still complete
    expect(result.output).toContain("Recovered after bad tool call");
    expect(result.toolCallsCount).toBe(1);
  });

  test("handles call to unknown tool", async () => {
    const registry = new ToolRegistry();
    const events: any[] = [];

    const mockRouter = createMockRouter([
      {
        content: "Calling unknown tool",
        toolCalls: [
          {
            id: "call_unknown",
            type: "function" as const,
            function: {
              name: "nonexistent_tool",
              arguments: "{}",
            },
          },
        ],
        finishReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        content: "OK, tool was not found. Here is my answer.",
        toolCalls: undefined,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);
    const result = await runner.run({
      input: "Test unknown tool",
      onEvent: (event) => events.push(event),
    });

    expect(result.output).toContain("OK, tool was not found");
    // The tool result event should contain the error
    const toolResultEvent = events.find(
      (e) => e.type === "tool_result" && e.toolName === "nonexistent_tool",
    );
    expect(toolResultEvent).toBeDefined();
    expect((toolResultEvent.result as any).error).toContain("not found");
  });

  test("registers and uses custom agent definitions", async () => {
    const registry = new ToolRegistry();
    const mockRouter = createMockRouter([
      {
        content: "Custom agent response",
        toolCalls: undefined,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const runner = new AgentRunner(mockRouter, registry);

    // Register a custom agent
    runner.registerAgent({
      agentType: "custom_analyzer",
      description: "A custom analyzer agent",
      systemPrompt: "You are a custom analyzer.",
      tools: ["think"],
      maxTurns: 5,
    });

    expect(runner.getAgentTypes()).toContain("custom_analyzer");
    expect(runner.getAgentDefinition("custom_analyzer")?.systemPrompt).toBe(
      "You are a custom analyzer.",
    );

    // Run the custom agent
    const result = await runner.run({
      input: "Analyze this with custom agent",
      agentType: "custom_analyzer",
    });

    expect(result.output).toBe("Custom agent response");
  });
});
