// =============================================================================
// DeepAnalyze - Hook Manager
// =============================================================================
// Manages hooks for 8 lifecycle events in the agent system:
//   PreToolUse, PostToolUse, PreCompact, PostCompact,
//   SessionStart, SessionEnd, AgentStart, AgentComplete.
//
// Blocking hooks (PreToolUse, PreCompact) can prevent the action.
// All other hooks are fire-and-forget.
//
// Supports "command" (shell) and "http" (POST) hook types.
// Hooks are persisted via the settings table (key = "agent_hooks").
// =============================================================================

import { getRepos } from "../../store/repos/index.js";
import type { HookType, HookContext, HookResult } from "./hook-types.js";

// Re-export types for backward compatibility
export type { HookType, HookContext, HookResult };

// ---------------------------------------------------------------------------
// Backward-compatible alias
// ---------------------------------------------------------------------------

/** @deprecated Use HookType instead */
export type HookEvent = HookType;

// ---------------------------------------------------------------------------
// Hook definition
// ---------------------------------------------------------------------------

export interface HookDefinition {
  id: string;
  event: HookType;
  type: "command" | "http";
  /** Glob-style matcher for tool names. "*" matches all. */
  matcher: string;
  config: {
    /** Shell command (for "command" type). Invoked with env vars: $TOOL_NAME, $TASK_ID, $HOOK_TYPE */
    command?: string;
    /** HTTP URL to POST to (for "http" type). */
    url?: string;
    headers?: Record<string, string>;
  };
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Hook types classification
// ---------------------------------------------------------------------------

/** Hooks that can block the action (returning { allowed: false }) */
const BLOCKING_HOOK_TYPES = new Set<HookType>([
  "PreToolUse",
  "PreCompact",
]);

/** Hooks that do not need a toolName matcher (lifecycle/session hooks) */
const LIFECYCLE_HOOK_TYPES = new Set<HookType>([
  "SessionStart",
  "SessionEnd",
  "AgentStart",
  "AgentComplete",
  "PreCompact",
  "PostCompact",
]);

// ---------------------------------------------------------------------------
// HookManager
// ---------------------------------------------------------------------------

export class HookManager {
  private hooks: Map<HookType, HookDefinition[]> = new Map();
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
   *
   * **Blocking hooks** (PreToolUse, PreCompact): if any hook denies, the
   * overall result is denied.
   *
   * **Fire-and-forget hooks** (all others): errors are logged but do not
   * affect the result — always returns `{ allowed: true }`.
   */
  async fire(
    hookType: HookType,
    ctx: HookContext,
  ): Promise<HookResult> {
    if (!this.loaded) {
      await this.loadFromSettings();
    }

    const defs = this.hooks.get(hookType) ?? [];

    // For tool-related hooks, filter by tool name matcher
    const isBlocking = BLOCKING_HOOK_TYPES.has(hookType);
    const needsMatcher = !LIFECYCLE_HOOK_TYPES.has(hookType);
    const matching = needsMatcher && ctx.toolName
      ? defs.filter((d) => this.matches(d.matcher, ctx.toolName))
      : defs;

    // Accumulate modified input from PreToolUse hooks
    let modifiedInput: Record<string, unknown> | undefined;

    for (const def of matching) {
      try {
        const result = await this.executeHook(def, ctx);

        // Accumulate modifiedInput if returned
        if (result.modifiedInput) {
          modifiedInput = { ...(modifiedInput ?? ctx.toolInput), ...result.modifiedInput };
        }

        if (isBlocking && !result.allowed) {
          return {
            allowed: false,
            error: result.error,
            modifiedInput,
          };
        }
      } catch (err) {
        if (isBlocking) {
          // For blocking hooks, a thrown error is treated as a deny
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[HookManager] Blocking hook "${def.id}" threw:`, errMsg);
          return { allowed: false, error: errMsg, modifiedInput };
        }
        // Non-blocking: hook execution failure does NOT affect execution
        console.warn(`[HookManager] Hook "${def.id}" threw:`, err instanceof Error ? err.message : String(err));
      }
    }

    return { allowed: true, modifiedInput };
  }

  // -----------------------------------------------------------------------
  // Convenience methods for specific hook types
  // -----------------------------------------------------------------------

  /** Fire SessionStart hooks. Fire-and-forget. */
  async fireSessionStart(taskId?: string): Promise<void> {
    await this.fire("SessionStart", { hookType: "SessionStart", taskId }).catch(() => {});
  }

  /** Fire SessionEnd hooks. Fire-and-forget. */
  async fireSessionEnd(taskId?: string): Promise<void> {
    await this.fire("SessionEnd", { hookType: "SessionEnd", taskId }).catch(() => {});
  }

  /** Fire AgentStart hooks. Fire-and-forget. */
  async fireAgentStart(taskId?: string): Promise<void> {
    await this.fire("AgentStart", { hookType: "AgentStart", taskId }).catch(() => {});
  }

  /** Fire AgentComplete hooks. Fire-and-forget. */
  async fireAgentComplete(taskId?: string): Promise<void> {
    await this.fire("AgentComplete", { hookType: "AgentComplete", taskId }).catch(() => {});
  }

  /** Fire PreCompact hooks. Can block — returns the result. */
  async firePreCompact(taskId?: string, customInstructions?: string): Promise<HookResult> {
    return this.fire("PreCompact", {
      hookType: "PreCompact",
      taskId,
      customInstructions,
    });
  }

  /** Fire PostCompact hooks. Fire-and-forget. */
  async firePostCompact(taskId?: string): Promise<void> {
    await this.fire("PostCompact", { hookType: "PostCompact", taskId }).catch(() => {});
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
    ctx: HookContext,
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
    ctx: HookContext,
  ): Promise<HookResult> {
    const cmd = def.config.command;
    if (!cmd) return { allowed: true };

    const { spawn } = await import("node:child_process");
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TOOL_NAME: ctx.toolName ?? "",
      TASK_ID: ctx.taskId ?? "",
      HOOK_TYPE: ctx.hookType,
    };

    return new Promise((resolve) => {
      const proc = spawn("sh", ["-c", cmd], { env, timeout: 10_000 });
      let stderr = "";
      let stdout = "";

      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });

      proc.on("close", (code) => {
        if (code === 0) {
          // Try to parse stdout as JSON for extended result support
          const result = this.parseHookOutput(stdout.trim());
          resolve(result);
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
    ctx: HookContext,
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
          hookType: ctx.hookType,
          toolName: ctx.toolName,
          toolInput: ctx.toolInput,
          taskId: ctx.taskId,
          customInstructions: ctx.customInstructions,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (resp.ok) {
        const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
        const allowed = body.allowed !== false;
        const error = typeof body.error === "string" ? body.error : undefined;
        const modifiedInput = body.modifiedInput as Record<string, unknown> | undefined;
        return { allowed, error, modifiedInput };
      }
      // Non-2xx: don't block
      return { allowed: true };
    } catch {
      // Network error: don't block
      return { allowed: true };
    }
  }

  /**
   * Parse hook stdout for extended result support.
   * Supports JSON output: { "allowed": false, "error": "...", "modifiedInput": {...} }
   * Falls back to allowed: true for empty/non-JSON output.
   */
  private parseHookOutput(stdout: string): HookResult {
    if (!stdout) return { allowed: true };

    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      return {
        allowed: parsed.allowed !== false,
        error: typeof parsed.error === "string" ? parsed.error : undefined,
        modifiedInput: parsed.modifiedInput as Record<string, unknown> | undefined,
      };
    } catch {
      // Non-JSON stdout — treat as success
      return { allowed: true };
    }
  }
}
