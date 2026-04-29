// =============================================================================
// DeepAnalyze - Hierarchical Context Compression
// =============================================================================
// Defines compression levels for hierarchical context compression.
// Messages are split into three depth layers (D2/D1/Leaf) with different
// compression granularities to preserve recent context fidelity while
// aggressively summarizing older context.
// =============================================================================

import type { ChatMessage } from "../../models/provider.js";

/**
 * Compression level definitions for hierarchical context compression.
 * - D2: Oldest messages, coarsest summary (just conclusions)
 * - D1: Middle messages, medium granularity (key decisions + data points)
 * - Leaf: Most recent messages, no compression
 */
export interface CompressionLevel {
  name: string;
  maxTokens: number;
  prompt: string;
}

export const COMPRESSION_LEVELS: CompressionLevel[] = [
  {
    name: "D2",
    maxTokens: 2000,
    prompt: `你是一个对话摘要器。请用3-5句话概括以下对话内容。
只保留最重要的结论、决策和最终结果。
忽略所有中间步骤、工具调用细节和探索过程。
格式：简洁的段落文本。`,
  },
  {
    name: "D1",
    maxTokens: 4000,
    prompt: `你是一个对话摘要器。请为以下对话创建结构化摘要。
保留：1. 用户请求和意图变化 2. 关键决策和原因 3. 重要事实（数量、名称、标识符）4. 错误及解决方式 5. 未完成的任务
忽略：工具调用参数细节、重复搜索结果、中间推理。
格式：使用编号列表。`,
  },
  {
    name: "Leaf",
    maxTokens: Infinity,
    prompt: "", // No compression
  },
];
