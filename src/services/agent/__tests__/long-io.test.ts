import { describe, it, expect } from "bun:test";
import { needsContinuation, buildContinuationMessage, shouldSegmentOutput, DEFAULT_CONTINUATION_CONFIG } from "../long-io.js";

describe("long-io", () => {
  it("needsContinuation returns true for 'length'", () => {
    expect(needsContinuation("length")).toBe(true);
  });

  it("needsContinuation returns false for 'stop'", () => {
    expect(needsContinuation("stop")).toBe(false);
  });

  it("needsContinuation returns false for undefined", () => {
    expect(needsContinuation(undefined)).toBe(false);
  });

  it("buildContinuationMessage returns user message", () => {
    const msg = buildContinuationMessage();
    expect(msg.role).toBe("user");
    expect(msg.content).toBeTruthy();
  });

  it("buildContinuationMessage uses custom prompt", () => {
    const msg = buildContinuationMessage({ continuationPrompt: "Custom prompt" });
    expect(msg.content).toBe("Custom prompt");
  });

  it("shouldSegmentOutput returns true for large output", () => {
    expect(shouldSegmentOutput(60_000)).toBe(true);
  });

  it("shouldSegmentOutput returns false for small output", () => {
    expect(shouldSegmentOutput(10_000)).toBe(false);
  });

  it("DEFAULT_CONTINUATION_CONFIG has maxContinuations", () => {
    expect(DEFAULT_CONTINUATION_CONFIG.maxContinuations).toBe(5);
  });
});
