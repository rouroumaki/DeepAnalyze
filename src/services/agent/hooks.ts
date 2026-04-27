// =============================================================================
// DeepAnalyze - Hook Manager
// =============================================================================
// Manages PreToolUse / PostToolUse hooks that fire before/after tool
// execution. Supports "command" (shell) and "http" (POST) hook types.
// Hooks are persisted via the settings table (key = "agent_hooks").
// =============================================================================

import { getRepos } from "../../store/repos/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookEvent = "PreToolUse" | "PostToolUse";

export interface HookDefinition {
  id: string;
  event: HookEvent;
  type: "command" | "http";
  /** Glob-style matcher for tool names. "*" matches all. */
  matcher: string;
  config: {
    /** Shell command (for "command" type). Invoked with env vars: $TOOL_NAME, $TASK_ID */
    command?: string;
    /** HTTP URL to POST to (for "http" type). */
    url?: string;
    headers?: Record<string, string>;
  };
  enabled: boolean;
}

export interface HookResult {
  /** false = block the tool execution (PreToolUse only) */
  allowed: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// HookManager
// ---------------------------------------------------------------------------

export class HookManager {
  private hooks: Map<HookEvent, HookDefinition[]> = new Map();
  private loaded = false;

  /** Load hooks from the settings table. */
  async loadFromSettings(): Promise<void> {
    try {
      const repos = await getRepos();
      const raw = await repos.settings.get("agent_hooks");
      if (raw) {
        const defs = JSON.parse(raw) as HookDefinition[];
        this.hooks.clear();
        for (const def of defs) {
          if (!def.enabled) continue;
          const list = this.hooks.get(def.event) ?? [];
          list.push(def);
          this.hooks.set(def.event, list);
        }
      }
      this.loaded = true;
    } catch {
      // Settings table may not exist yet — that's fine
      this.hooks.clear();
      this.loaded = true;
    }
  }

  /**
   * Fire hooks for the given event. Returns the aggregated result.
   * If any PreToolUse hook denies, the overall result is denied.
   */
  async fire(
    event: HookEvent,
    ctx: { toolName: string; toolInput?: Record<string, unknown>; taskId?: string },
  ): Promise<HookResult> {
    if (!this.loaded) {
      await this.loadFromSettings();
    }

    const defs = this.hooks.get(event) ?? [];
    const matching = defs.filter((d) => this.matches(d.matcher, ctx.toolName));

    for (const def of matching) {
      try {
        const result = await this.executeHook(def, ctx);
        if (!result.allowed) {
          return result;
        }
      } catch (err) {
        // Hook execution failure does NOT block the tool — just log
        console.warn(`[HookManager] Hook "${def.id}" threw:`, err instanceof Error ? err.message : String(err));
      }
    }

    return { allowed: true };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Simple glob matcher: supports "*" (any) and exact match. */
  private matches(matcher: string, toolName: string): boolean {
    if (matcher === "*" || matcher === "") return true;
    if (matcher === toolName) return true;
    // Support prefix glob: "bash*" matches "bash", "bash_exec", etc.
    if (matcher.endsWith("*") && toolName.startsWith(matcher.slice(0, -1))) return true;
    return false;
  }

  private async executeHook(
    def: HookDefinition,
    ctx: { toolName: string; toolInput?: Record<string, unknown>; taskId?: string },
  ): Promise<HookResult> {
    switch (def.type) {
      case "command":
        return this.executeCommandHook(def, ctx);
      case "http":
        return this.executeHttpHook(def, ctx);
      default:
        return { allowed: true };
    }
  }

  private async executeCommandHook(
    def: HookDefinition,
    ctx: { toolName: string; toolInput?: Record<string, unknown>; taskId?: string },
  ): Promise<HookResult> {
    const cmd = def.config.command;
    if (!cmd) return { allowed: true };

    const { spawn } = await import("node:child_process");
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TOOL_NAME: ctx.toolName,
      TASK_ID: ctx.taskId ?? "",
    };

    return new Promise((resolve) => {
      const proc = spawn("sh", ["-c", cmd], { env, timeout: 10_000 });
      let stderr = "";

      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve({ allowed: true });
        } else {
          resolve({ allowed: false, error: stderr.trim() || `Hook exited with code ${code}` });
        }
      });

      proc.on("error", (err) => {
        resolve({ allowed: false, error: err.message });
      });
    });
  }

  private async executeHttpHook(
    def: HookDefinition,
    ctx: { toolName: string; toolInput?: Record<string, unknown>; taskId?: string },
  ): Promise<HookResult> {
    const url = def.config.url;
    if (!url) return { allowed: true };

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(def.config.headers ?? {}),
        },
        body: JSON.stringify({
          event: def.event,
          toolName: ctx.toolName,
          toolInput: ctx.toolInput,
          taskId: ctx.taskId,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (resp.ok) {
        const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
        const allowed = body.allowed !== false;
        return { allowed, error: typeof body.error === "string" ? body.error : undefined };
      }
      // Non-2xx: don't block
      return { allowed: true };
    } catch {
      // Network error: don't block
      return { allowed: true };
    }
  }
}
