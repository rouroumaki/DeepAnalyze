// =============================================================================
// DeepAnalyze - Session Memory Manager
// =============================================================================
// Extracts and maintains structured notes from conversations. These notes
// are injected into the system prompt for context continuity and used by
// SM-compact to replace old messages with a compact summary.
// =============================================================================

import { randomUUID } from "node:crypto";
import { ModelRouter } from "../../models/router.js";
import { getRepos } from "../../store/repos/index.js";
import type { ChatMessage } from "../../models/provider.js";
import type { SessionMemoryNote, AgentSettings } from "./types.js";
import { DEFAULT_AGENT_SETTINGS } from "./types.js";

// ---------------------------------------------------------------------------
// Unique injection markers (avoiding common Markdown patterns)
// ---------------------------------------------------------------------------

const MEMORY_START_MARKER = "<!-- SESSION_MEMORY_START -->";
const MEMORY_END_MARKER = "<!-- SESSION_MEMORY_END -->";

// Legacy markers for backward compatibility
const LEGACY_START_MARKER = "---\n## Session Memory (Auto-Extracted Context)";
const LEGACY_END_MARKER = "---";

// ---------------------------------------------------------------------------
// SessionMemoryManager
// ---------------------------------------------------------------------------

export class SessionMemoryManager {
  private modelRouter: ModelRouter;
  private sessionId: string;
  private settings: AgentSettings;

  constructor(
    modelRouter: ModelRouter,
    sessionId: string,
    settings?: Partial<AgentSettings>,
  ) {
    this.modelRouter = modelRouter;
    this.sessionId = sessionId;
    this.settings = { ...DEFAULT_AGENT_SETTINGS, ...settings };
  }

  // -----------------------------------------------------------------------
  // Load / Save
  // -----------------------------------------------------------------------

  /**
   * Load the session memory note from the database.
   * Returns null if no memory exists for this session.
   */
  async load(): Promise<SessionMemoryNote | null> {
    const repos = await getRepos();
    const row = await repos.sessionMemory.load(this.sessionId);

    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.sessionId,
      content: row.content,
      tokenCount: row.tokenCount,
      lastTokenPosition: row.lastTokenPosition,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Save (upsert) a session memory note.
   */
  async save(note: SessionMemoryNote): Promise<void> {
    const repos = await getRepos();
    await repos.sessionMemory.save(
      note.sessionId,
      note.content,
      note.tokenCount,
      note.lastTokenPosition,
    );
  }

  // -----------------------------------------------------------------------
  // Initialization / Update gating
  // -----------------------------------------------------------------------

  /**
   * Should we initialize session memory for the first time?
   * Triggers when cumulative token usage first exceeds the threshold.
   */
  shouldInitialize(totalTokens: number): boolean {
    return totalTokens >= this.settings.sessionMemoryInitThreshold;
  }

  /**
   * Should we update the existing session memory?
   * Triggers when token usage has grown by the update interval since last update.
   */
  shouldUpdate(totalTokens: number, memory: SessionMemoryNote): boolean {
    return totalTokens - memory.lastTokenPosition >= this.settings.sessionMemoryUpdateInterval;
  }

  // -----------------------------------------------------------------------
  // Memory extraction (LLM-based)
  // -----------------------------------------------------------------------

  /**
   * Initialize session memory by extracting key information from the
   * conversation so far using the summarizer model.
   */
  async initialize(
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<SessionMemoryNote> {
    const content = await this.extractMemory(messages, signal);
    const id = randomUUID();
    const tokenCount = this.modelRouter.estimateTokens(content);

    const note: SessionMemoryNote = {
      id,
      sessionId: this.sessionId,
      content,
      tokenCount,
      lastTokenPosition: 0, // Will be set by agent-runner with actual token count
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.save(note);
    return note;
  }

  /**
   * Update existing session memory with new conversation content.
   * Uses incremental extraction on messages since the last update.
   *
   * @param existingMemory The current memory note
   * @param messages The full message array
   * @param totalTokens Actual cumulative session token usage (from agent-runner)
   * @param signal Optional abort signal
   */
  async update(
    existingMemory: SessionMemoryNote,
    messages: ChatMessage[],
    totalTokens: number,
    signal?: AbortSignal,
  ): Promise<SessionMemoryNote> {
    const updatedContent = await this.extractMemoryUpdate(
      existingMemory.content,
      messages,
      signal,
    );

    const tokenCount = this.modelRouter.estimateTokens(updatedContent);

    const updated: SessionMemoryNote = {
      ...existingMemory,
      content: updatedContent,
      tokenCount,
      lastTokenPosition: totalTokens, // Use actual session token count
      updatedAt: new Date().toISOString(),
    };

    await this.save(updated);
    return updated;
  }

  // -----------------------------------------------------------------------
  // Prompt injection (using unique HTML-comment markers)
  // -----------------------------------------------------------------------

  /**
   * Build the text to inject into the system prompt.
   * Uses HTML comment markers that won't appear in normal content.
   */
  buildPromptInjection(note: SessionMemoryNote): string {
    return [
      "",
      MEMORY_START_MARKER,
      "## 会话记忆（自动提取的上下文）",
      "",
      note.content,
      "",
      MEMORY_END_MARKER,
      "",
    ].join("\n");
  }

  // -----------------------------------------------------------------------
  // Private: LLM memory extraction
  // -----------------------------------------------------------------------

  private async extractMemory(
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    const summarizerModel = this.modelRouter.getDefaultModel("summarizer");

    // [ORIGINAL ENGLISH] You are a session memory extractor. Analyze the conversation below and extract a structured summary...
    const extractionPrompt = `你是一个会话记忆提取器。分析下面的对话并提取结构化摘要，使用以下 Markdown 章节：

## 关键信息
- 最重要的事实、数据点、标识符和发现
- 用 [关键] 标记真正关键的项目，用 [重要] 标记重要的项目

## 已执行的工作
- 已采取的行动、已执行的分析及其结果
- 每个工作项的当前状态

## 当前任务
- 精确描述用户当前正在处理什么
- 包含恢复工作所需的具体数据

## 决策和结论
- 已达成的结论、选择的方法及其原因

## 待处理任务
- 任何已明确请求但尚未完成的任务

规则：
- 用 [关键]（关键）、[重要]（重要）标记项目，或不予标记（背景信息）
- 简洁但完整——包含具体的数值、名称和标识符
- 控制在 500 字以内
- 专注于对后续继续任务有用的信息`;

    const extractionMessages: ChatMessage[] = [
      { role: "system", content: extractionPrompt },
      { role: "user", content: this.serializeMessages(messages) },
    ];

    try {
      const response = await this.modelRouter.chat(extractionMessages, {
        model: summarizerModel,
        maxTokens: 2000,
        signal,
      });
      return response.content || "";
    } catch {
      return this.generateFallbackSummary(messages);
    }
  }

  private async extractMemoryUpdate(
    existingContent: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    const summarizerModel = this.modelRouter.getDefaultModel("summarizer");

    // [ORIGINAL ENGLISH] You are a session memory updater. You have an existing session memory summary and new conversation messages...
    const updatePrompt = `你是一个会话记忆更新器。你已有现有的会话记忆摘要和新的对话消息。通过整合新信息来更新摘要。

规则：
- 保持相同的 Markdown 章节结构（关键信息、已执行的工作、当前任务、决策和结论、待处理任务）
- 添加新信息，不要重复已有内容
- 移除过时或已被取代的信息
- 保留所有 [关键] 和 [重要] 重要性标记
- 总字数控制在 500 字以内
- 如果没有显著的新信息，返回原有摘要不做更改`;

    const updateMessages: ChatMessage[] = [
      { role: "system", content: updatePrompt },
      {
        role: "user",
        content: `## 现有会话记忆\n\n${existingContent}\n\n## 新消息\n\n${this.serializeMessages(messages)}`,
      },
    ];

    try {
      const response = await this.modelRouter.chat(updateMessages, {
        model: summarizerModel,
        maxTokens: 2000,
        signal,
      });
      return response.content || existingContent;
    } catch {
      return existingContent;
    }
  }

  /**
   * Serialize messages to a readable format for the summarizer.
   * Uses token-aware truncation: walks backward and truncates messages
   * when the serialized content would exceed the token budget.
   * Tool results get more space (3000 chars) since they carry important data.
   */
  private serializeMessages(messages: ChatMessage[]): string {
    // Target ~6000 tokens for serialized content (~18000 chars)
    const maxChars = 18_000;
    const serialized: string[] = [];
    let totalChars = 0;

    // Walk backward from the most recent messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      const content = m.content ?? "";
      const limit = m.role === "tool" ? 3000 : 1000;
      const entry = `[${m.role}]: ${content.slice(0, limit)}`;

      if (totalChars + entry.length + 2 > maxChars) {
        break;
      }

      serialized.unshift(entry);
      totalChars += entry.length + 2; // +2 for \n\n separator
    }

    return serialized.join("\n\n");
  }

  /**
   * Generate a basic fallback summary when LLM extraction is unavailable.
   */
  private generateFallbackSummary(messages: ChatMessage[]): string {
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    const sections: string[] = [
      "## 关键信息",
      "- （会话记忆提取不可用）",
      "",
      "## 已执行的工作",
      "- （尚未跟踪）",
      "",
      "## 当前任务",
    ];

    if (userMessages.length > 0) {
      const lastUser = userMessages[userMessages.length - 1];
      sections.push(`- ${(lastUser.content ?? "").slice(0, 200)}`);
    } else {
      sections.push("- （尚无用户消息）");
    }

    sections.push("", "## 决策和结论", "- （尚未跟踪）");
    sections.push("", "## 待处理任务", "- （尚未跟踪）");

    sections.push(
      "",
      `> 会话包含 ${userMessages.length} 条用户消息和 ${assistantMessages.length} 条助手回复。`,
    );

    return sections.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Utility: replace session memory injection in system prompt
// ---------------------------------------------------------------------------

/**
 * Replace an existing session memory injection block in the system prompt
 * with a new one. Handles both new unique markers and legacy markers.
 * If no existing block is found, appends the new one.
 */
export function replaceSessionMemoryInjection(
  systemPrompt: string,
  newInjection: string,
): string {
  // Try new markers first
  const startIdx = systemPrompt.indexOf(MEMORY_START_MARKER);
  if (startIdx !== -1) {
    const endIdx = systemPrompt.indexOf(MEMORY_END_MARKER, startIdx + MEMORY_START_MARKER.length);
    if (endIdx !== -1) {
      const replaceEnd = endIdx + MEMORY_END_MARKER.length;
      return systemPrompt.slice(0, startIdx) + newInjection.trim() + systemPrompt.slice(replaceEnd);
    }
  }

  // Try legacy markers
  const legacyStartIdx = systemPrompt.indexOf(LEGACY_START_MARKER);
  if (legacyStartIdx !== -1) {
    const afterStart = legacyStartIdx + LEGACY_START_MARKER.length;
    const legacyEndIdx = systemPrompt.indexOf(LEGACY_END_MARKER, afterStart);
    if (legacyEndIdx !== -1) {
      const replaceEnd = legacyEndIdx + LEGACY_END_MARKER.length;
      return systemPrompt.slice(0, legacyStartIdx) + newInjection.trim() + systemPrompt.slice(replaceEnd);
    }
  }

  // No existing injection — append
  return systemPrompt + newInjection;
}
