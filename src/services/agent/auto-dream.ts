// =============================================================================
// DeepAnalyze - Auto Dream Manager
// =============================================================================
// Cross-session knowledge integration. Periodically reads session_memory
// records, uses a summarizer to synthesize cross-session insights, and writes
// the result back to the knowledge base via KnowledgeCompounder.
// =============================================================================

import { ModelRouter } from "../../models/router.js";
import { DB } from "../../store/database.js";
import type { KnowledgeCompounder } from "../../wiki/knowledge-compound.js";
import type { Linker } from "../../wiki/linker.js";
import type { AgentSettings } from "./types.js";
import { DEFAULT_AGENT_SETTINGS } from "./types.js";

// ---------------------------------------------------------------------------
// State tracking
// ---------------------------------------------------------------------------

interface AutoDreamState {
  lastDreamAt: string | null;
  sessionsSinceLastDream: number;
}

/** Settings key for auto-dream state */
const AUTO_DREAM_STATE_KEY = "auto_dream_state";

/** Maximum number of sessions to load for synthesis */
const MAX_SESSIONS_FOR_SYNTHESIS = 20;

// ---------------------------------------------------------------------------
// AutoDreamManager
// ---------------------------------------------------------------------------

export class AutoDreamManager {
  private modelRouter: ModelRouter;
  private compounder: KnowledgeCompounder;
  private linker: Linker;
  private settings: AgentSettings;

  constructor(
    modelRouter: ModelRouter,
    compounder: KnowledgeCompounder,
    linker: Linker,
    settings?: Partial<AgentSettings>,
  ) {
    this.modelRouter = modelRouter;
    this.compounder = compounder;
    this.linker = linker;
    this.settings = { ...DEFAULT_AGENT_SETTINGS, ...settings };
  }

  // -----------------------------------------------------------------------
  // Gate check
  // -----------------------------------------------------------------------

  /**
   * Check whether auto-dream should be triggered based on time and session
   * count gates.
   */
  shouldDream(): boolean {
    const state = this.loadState();
    const intervalMs = this.settings.autoDreamIntervalHours * 60 * 60 * 1000;

    // Time gate
    if (state.lastDreamAt) {
      const elapsed = Date.now() - new Date(state.lastDreamAt).getTime();
      if (elapsed < intervalMs) {
        return false;
      }
    }

    // Session count gate
    if (state.sessionsSinceLastDream < this.settings.autoDreamSessionThreshold) {
      return false;
    }

    return true;
  }

  // -----------------------------------------------------------------------
  // Increment session counter (atomic)
  // -----------------------------------------------------------------------

  /**
   * Increment the session counter atomically using SQL.
   * Called after each completed agent run.
   */
  incrementSessionCount(): void {
    const db = DB.getInstance().raw;

    // Ensure state exists first
    const existing = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(AUTO_DREAM_STATE_KEY) as { value: string } | undefined;

    if (!existing) {
      const initialState: AutoDreamState = {
        lastDreamAt: null,
        sessionsSinceLastDream: 1,
      };
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      ).run(AUTO_DREAM_STATE_KEY, JSON.stringify(initialState));
      return;
    }

    // Atomic increment using json_set + json_extract
    db.prepare(
      `UPDATE settings
       SET value = json_set(value, '$.sessionsSinceLastDream', json_extract(value, '$.sessionsSinceLastDream') + 1),
           updated_at = datetime('now')
       WHERE key = ?`,
    ).run(AUTO_DREAM_STATE_KEY);
  }

  // -----------------------------------------------------------------------
  // Dream execution
  // -----------------------------------------------------------------------

  /**
   * Execute the auto-dream process:
   * 1. Read recent session_memory records (limited)
   * 2. Send to summarizer for cross-session integration
   * 3. Write result to knowledge base via KnowledgeCompounder
   */
  async dream(): Promise<void> {
    console.log("[AutoDream] Starting cross-session knowledge integration...");

    const memories = this.loadRecentMemories();
    if (memories.length === 0) {
      console.log("[AutoDream] No session memories found, skipping.");
      return;
    }

    const synthesis = await this.synthesizeMemories(memories);

    if (!synthesis) {
      console.log("[AutoDream] Synthesis produced no output, skipping write-back.");
      return;
    }

    const kbId = this.findDreamKb();
    if (!kbId) {
      console.log("[AutoDream] No knowledge base available for write-back.");
      return;
    }

    const title = `Cross-Session Insights - ${new Date().toISOString().slice(0, 10)}`;
    try {
      this.compounder.compoundWithEntities(kbId, synthesis, title, this.linker);
      console.log(`[AutoDream] Saved cross-session insights to KB ${kbId}`);
    } catch (err) {
      console.warn(
        "[AutoDream] Failed to write cross-session insights:",
        err instanceof Error ? err.message : String(err),
      );
    }

    // Update state atomically
    const db = DB.getInstance().raw;
    db.prepare(
      `UPDATE settings
       SET value = json_set(json_set(value, '$.lastDreamAt', ?), '$.sessionsSinceLastDream', 0),
           updated_at = datetime('now')
       WHERE key = ?`,
    ).run(new Date().toISOString(), AUTO_DREAM_STATE_KEY);

    console.log("[AutoDream] Cross-session knowledge integration complete.");
  }

  // -----------------------------------------------------------------------
  // State persistence
  // -----------------------------------------------------------------------

  private loadState(): AutoDreamState {
    const db = DB.getInstance().raw;
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(AUTO_DREAM_STATE_KEY) as { value: string } | undefined;

    if (row) {
      try {
        return JSON.parse(row.value) as AutoDreamState;
      } catch {
        // Corrupted state, reset
      }
    }

    return {
      lastDreamAt: null,
      sessionsSinceLastDream: 0,
    };
  }

  // -----------------------------------------------------------------------
  // Data loading (limited)
  // -----------------------------------------------------------------------

  private loadRecentMemories(): Array<{ sessionId: string; content: string }> {
    const db = DB.getInstance().raw;
    const rows = db
      .prepare(
        "SELECT session_id, content FROM session_memory ORDER BY updated_at DESC LIMIT ?",
      )
      .all(MAX_SESSIONS_FOR_SYNTHESIS) as Array<{ session_id: string; content: string }>;
    return rows.map((r) => ({ sessionId: r.session_id, content: r.content }));
  }

  // -----------------------------------------------------------------------
  // Synthesis (bounded input)
  // -----------------------------------------------------------------------

  private async synthesizeMemories(
    memories: Array<{ sessionId: string; content: string }>,
  ): Promise<string | null> {
    const summarizerModel = this.modelRouter.getDefaultModel("summarizer");

    const prompt = `You are a knowledge integration engine. Analyze the following session memory notes from multiple analysis sessions and produce a synthesized report that:

1. Identifies recurring themes and patterns across sessions
2. Highlights the most important cross-session findings
3. Notes any contradictions or complementary insights
4. Lists key entities and their relationships across sessions

Format the output as a well-structured Markdown document.`;

    // Build content with total size limit (~50K chars)
    const MAX_SYNTHESIS_INPUT = 50_000;
    const parts: string[] = [];
    let totalChars = 0;

    for (let i = 0; i < memories.length; i++) {
      const part = `--- Session ${i + 1} (${memories[i].sessionId.slice(0, 8)}...) ---\n${memories[i].content}`;
      if (totalChars + part.length > MAX_SYNTHESIS_INPUT) {
        // Truncate this part to fit
        const remaining = MAX_SYNTHESIS_INPUT - totalChars;
        if (remaining > 200) {
          parts.push(part.slice(0, remaining) + "\n...[truncated]");
        }
        break;
      }
      parts.push(part);
      totalChars += part.length;
    }

    const content = parts.join("\n\n");

    try {
      const response = await this.modelRouter.chat(
        [
          { role: "system", content: prompt },
          { role: "user", content },
        ],
        {
          model: summarizerModel,
          maxTokens: 4000,
        },
      );
      return response.content || null;
    } catch (err) {
      console.warn(
        "[AutoDream] Synthesis LLM call failed:",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // KB resolution
  // -----------------------------------------------------------------------

  private findDreamKb(): string | null {
    const db = DB.getInstance().raw;
    const existing = db
      .prepare("SELECT id FROM knowledge_bases LIMIT 1")
      .get() as { id: string } | undefined;

    return existing?.id ?? null;
  }
}
