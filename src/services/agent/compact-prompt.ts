// =============================================================================
// DeepAnalyze - Structured Compact Prompt
// =============================================================================
// Prompt templates for context compaction. Adapted from Claude Code's
// 9-section summary structure, but generalized for any task domain
// (not limited to code development or knowledge base analysis).
// =============================================================================

// ---------------------------------------------------------------------------
// Preamble: prevent tool calls during compaction
// ---------------------------------------------------------------------------

// [ORIGINAL ENGLISH] CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Do NOT use any tools whatsoever.
// You already have all the context you need. Tool calls will be REJECTED. Your entire response must be plain text:
// an <analysis> block followed by a <summary> block.
const NO_TOOLS_PREAMBLE = `关键要求：只回复文本。不要调用任何工具。

- 不要使用任何工具。
- 你已经在上面的对话中获得了所有需要的上下文。
- 工具调用会被拒绝，并且会浪费你唯一的轮次——你将无法完成任务。
- 你的整个回复必须是纯文本：一个 <analysis> 块后跟一个 <summary> 块。

`;

// ---------------------------------------------------------------------------
// Analysis instruction (shared by all prompt variants)
// ---------------------------------------------------------------------------

// [ORIGINAL ENGLISH] Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts.
// 1. Chronologically analyze each step. Identify: user requests, your approach, key decisions, data points,
//    names/identifiers/numerical results, errors and resolutions, user feedback.
// 2. Double-check for accuracy and completeness.
const DETAILED_ANALYSIS_INSTRUCTION = `在提供最终摘要之前，用 <analysis> 标签包裹你的分析过程来组织思路。在你的分析中：

1. 按时间顺序分析对话的每一步。对每个部分识别：
   - 用户的明确请求和意图
   - 你处理用户请求的方法
   - 关键决策、数据点和发现的重要信息
   - 具体细节，如名称、标识符、数值结果或事实发现
   - 遇到的错误及其解决方式
   - 特别注意用户的具体反馈，尤其是用户要求你以不同方式做事的情况。
2. 仔细检查准确性和完整性，充分处理每个必要元素。`;

// ---------------------------------------------------------------------------
// Base compact prompt (full conversation summarization)
// ---------------------------------------------------------------------------

// [ORIGINAL ENGLISH] Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests,
// work performed, and important information gathered. This summary should be thorough in capturing key details, data points, and decisions
// that would be essential for continuing work without losing context.
// Sections: 1.Primary Request 2.Key Information 3.Work Performed 4.Search History 5.Errors/Fixes
// 6.User Messages 7.Pending Tasks 8.Current Work 9.Recommended Next Steps
const BASE_COMPACT_PROMPT = `你的任务是创建一份到目前为止的详细对话摘要，密切关注用户的明确请求、已执行的工作和收集到的重要信息。
这份摘要应该全面捕捉关键细节、数据点和决策，这些对于在不丢失上下文的情况下继续工作是必不可少的。

${DETAILED_ANALYSIS_INSTRUCTION}

你的摘要应包含以下章节：

1. 主要请求和意图：详细记录用户的所有明确请求和意图。注意方向变化或不断演进的需求。
2. 关键信息和发现：列出所有重要的事实、数据点、模式、异常和发现。在适用处包含具体数值、名称和标识符。
3. 已执行的工作和结果：枚举已采取的具体行动、已执行的分析和已产生的输出。注明每个工作项的当前状态。
4. 搜索和探索历史：记录执行了哪些搜索、查询或探索以及发现了什么。这有助于避免重复之前的搜索。
5. 错误和修复：列出遇到的所有错误及其修复方式。注明任何改变方法的用户反馈。
6. 用户消息：列出所有用户消息（不包括工具结果）。这些对于理解用户不断演进的意图和反馈至关重要。
7. 待处理任务：概述已明确请求但尚未完成的任务。
8. 当前工作：详细描述紧接在此摘要之前正在处理的内容，关注最近的消息。包含恢复工作所需的具体数据和上下文。
9. 建议的下一步：列出与最近工作直接相关的下一步。包含对话中的直接引用，准确说明当时正在处理什么任务以及进展到哪里。只建议与用户最近明确请求一致的步骤。

Here is an example of how your output should be structured:

<analysis>
[Chronological analysis of the conversation, identifying key points at each step]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description of what the user asked for, including any changes in direction]

2. Key Information and Findings:
   - [Important finding with specific details]
   - [Data point or pattern discovered]

3. Work Performed and Results:
   - [Action taken and its outcome]
   - [Analysis performed and conclusions drawn]

4. Search and Exploration History:
   - [Query/search performed] → [Result summary]

5. Errors and Fixes:
   - [Error description] → [Resolution]

6. User Messages:
   - "[First user message]"
   - "[Second user message]"
   - [etc.]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]

8. Current Work:
   [Detailed description of what was being worked on]

9. Recommended Next Steps:
   [Next step with verbatim context from the conversation]
</summary>

Follow this structure precisely. Be thorough but concise — include all important details while avoiding redundancy.`;

// ---------------------------------------------------------------------------
// Trailer (shared by all variants)
// ---------------------------------------------------------------------------

// [ORIGINAL ENGLISH] Respond with your <analysis> block followed by a <summary> block. No tools, no code, no formatting beyond what is specified above.
const NO_TOOLS_TRAILER = `

回复你的 <analysis> 块，然后是 <summary> 块。不要使用工具，不要包含代码，不要使用上述规定之外的格式。`;

// ---------------------------------------------------------------------------
// Prompt assembly functions
// ---------------------------------------------------------------------------

/**
 * Get the full compact prompt for conversation summarization.
 * Optionally includes additional custom instructions.
 */
export function getCompactPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT;
  if (customInstructions) {
    prompt += `\n\n本次摘要的附加指令：\n${customInstructions}`;
  }
  prompt += NO_TOOLS_TRAILER;
  return prompt;
}

/**
 * Build the user-facing continuation message after compaction.
 * This message is prepended to the compacted message array to provide
 * context about the summary that follows.
 */
export function getCompactUserSummaryMessage(
  summary: string,
  options?: { isAutoCompact?: boolean },
): string {
  // [ORIGINAL ENGLISH] This session is being continued from a previous conversation. Here is a summary of what happened so far:
  let message = `本会话正在从之前的对话中继续。以下是到目前为止的对话摘要：\n\n${summary}`;

  if (options?.isAutoCompact) {
    // [ORIGINAL ENGLISH] The summary above captures the essential context from the earlier conversation. Resume your work directly without acknowledging or summarizing this summary. Continue as if the conversation has been ongoing.
    message += `\n\n上面的摘要捕捉了之前对话的关键上下文。直接恢复你的工作，不要确认或复述此摘要。像对话一直在进行一样继续。`;
  }

  return message;
}

// ---------------------------------------------------------------------------
// Summary post-processing
// ---------------------------------------------------------------------------

/**
 * Format the raw model output from a compact call:
 * 1. Strip the <analysis>...</analysis> block (it was a drafting scratchpad)
 * 2. Extract and unwrap <summary>...</summary> content
 * 3. Collapse multiple newlines
 */
export function formatCompactSummary(raw: string): string {
  let result = raw;

  // Strip analysis block
  result = result.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();

  // Extract summary block content
  const summaryMatch = result.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) {
    result = `Summary:\n${summaryMatch[1]!.trim()}`;
  }

  // Collapse excessive newlines
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}
