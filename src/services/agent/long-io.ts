// =============================================================================
// DeepAnalyze - Long Output Continuation Support
// =============================================================================
// When model output is truncated (finish_reason === "length"):
// 1. Inject continuation message: "Please continue from where you left off."
// 2. Model continues generating the rest
// 3. Concatenate multiple outputs into the full result
//
// Reference: Claude Code's max_output_tokens recovery
// =============================================================================

export interface ContinuationConfig {
  /** Maximum number of continuation rounds */
  maxContinuations: number;
  /** Prompt to inject for continuation */
  continuationPrompt: string;
}

export const DEFAULT_CONTINUATION_CONFIG: ContinuationConfig = {
  maxContinuations: 5,
  continuationPrompt: "请继续输出，从上次中断的地方开始。不要重复已经输出的内容。",
};

/**
 * Check if the model output was truncated and needs continuation.
 */
export function needsContinuation(finishReason?: string): boolean {
  return finishReason === "length";
}

/**
 * Build a continuation message to inject.
 */
export function buildContinuationMessage(config?: Partial<ContinuationConfig>): {
  role: "user";
  content: string;
} {
  const prompt = config?.continuationPrompt ?? DEFAULT_CONTINUATION_CONFIG.continuationPrompt;
  return { role: "user" as const, content: prompt };
}

/**
 * Check if output is likely to be very long and should be segmented.
 */
export function shouldSegmentOutput(estimatedChars: number): boolean {
  return estimatedChars > 50_000;
}

/**
 * Get a suggestion message for segmented output.
 */
export function getSegmentationSuggestion(): string {
  return (
    "注意：预计输出内容较长。建议将结果分段写入文件（使用 write_file 工具），" +
    "每段不超过 20000 字符。最后提供完整的文件路径列表。"
  );
}
