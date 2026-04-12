// =============================================================================
// DeepAnalyze - Session Memory Manager
// =============================================================================
// Extracts and maintains structured notes from conversations. These notes
// are injected into the system prompt for context continuity and used by
// SM-compact to replace old messages with a compact summary.
// =============================================================================

import { randomUUID } from "node:crypto";
import { ModelRouter } from "../../models/router.js";
import { DB } from "../../store/database.js";
import type { ChatMessage } from "../../models/provider.js";
import type { SessionMemoryNote, AgentSettings } from "./types.js";
import { DEFAULT_AGENT_SETTINGS } from "./types.js";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface SessionMemoryRow {
  id: string;
  session_id: string;
  content: string;
  token_count: number;
  last_token_position: number;
  created_at: string;
  updated_at: string;
}

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
  load(): SessionMemoryNote | null {
    const db = DB.getInstance().raw;
    const row = db
      .prepare("SELECT * FROM session_memory WHERE session_id = ?")
      .get(this.sessionId) as SessionMemoryRow | undefined;

    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      tokenCount: row.token_count,
      lastTokenPosition: row.last_token_position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Save (upsert) a session memory note.
   */
  save(note: SessionMemoryNote): void {
    const db = DB.getInstance().raw;
    db.prepare(
      `INSERT OR REPLACE INTO session_memory (id, session_id, content, token_count, last_token_position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      note.id,
      note.sessionId,
      note.content,
      note.tokenCount,
      note.lastTokenPosition,
      note.createdAt,
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

    this.save(note);
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

    this.save(updated);
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
      "## Session Memory (Auto-Extracted Context)",
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

    const extractionPrompt = `You are a session memory extractor. Analyze the conversation below and extract a structured summary in Markdown format with these sections:

## Key Findings
- List the most important facts and discoveries

## Documents Analyzed
- List any documents, files, or data sources mentioned

## Current Task
- Describe what the user is currently working on

## Decisions Made
- List any conclusions or decisions reached

Keep the summary concise (under 500 words). Focus on information that would be useful for continuing the conversation later.`;

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

    const updatePrompt = `You are a session memory updater. You have an existing session memory summary and new conversation messages. Update the summary by incorporating new information.

Rules:
- Keep the same Markdown section structure (Key Findings, Documents Analyzed, Current Task, Decisions Made)
- Add new information, don't repeat what's already there
- Remove outdated information
- Keep the total under 500 words
- If no significant new information, return the existing summary unchanged`;

    const updateMessages: ChatMessage[] = [
      { role: "system", content: updatePrompt },
      {
        role: "user",
        content: `## Existing Session Memory\n\n${existingContent}\n\n## New Messages\n\n${this.serializeMessages(messages)}`,
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
   * Tool results get more space (3000 chars) since they carry important data.
   */
  private serializeMessages(messages: ChatMessage[]): string {
    const recent = messages.slice(-30);
    return recent
      .map((m) => {
        const content = m.content ?? "";
        const limit = m.role === "tool" ? 3000 : 1000;
        return `[${m.role}]: ${content.slice(0, limit)}`;
      })
      .join("\n\n");
  }

  /**
   * Generate a basic fallback summary when LLM extraction is unavailable.
   */
  private generateFallbackSummary(messages: ChatMessage[]): string {
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    const sections: string[] = [
      "## Key Findings",
      "- (Session memory extraction was unavailable)",
      "",
      "## Documents Analyzed",
      "- (not yet tracked)",
      "",
      "## Current Task",
    ];

    if (userMessages.length > 0) {
      const lastUser = userMessages[userMessages.length - 1];
      sections.push(`- ${(lastUser.content ?? "").slice(0, 200)}`);
    } else {
      sections.push("- (no user messages yet)");
    }

    sections.push("", "## Decisions Made", "- (not yet tracked)");

    sections.push(
      "",
      `> Session contains ${userMessages.length} user messages and ${assistantMessages.length} assistant responses.`,
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
