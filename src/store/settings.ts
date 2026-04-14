// =============================================================================
// DeepAnalyze - Settings Store
// =============================================================================
// Manages runtime configuration: model providers, defaults, and other settings.
// All settings are stored in the SQLite `settings` table as JSON values.
// =============================================================================

import { DB } from "./database.js";
import type { AgentSettings } from "../services/agent/types.js";
import { DEFAULT_AGENT_SETTINGS } from "../services/agent/types.js";

// ---------------------------------------------------------------------------
// Provider configuration types
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: string;
  name: string;
  type: "openai-compatible" | "anthropic" | "ollama";
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  supportsToolUse: boolean;
  enabled: boolean;
  /** Context window size in tokens (default: 128000) */
  contextWindow?: number;
}

export interface ProviderDefaults {
  main: string;
  summarizer: string;
  embedding: string;
  vlm: string;
}

export interface ProviderSettings {
  providers: ProviderConfig[];
  defaults: ProviderDefaults;
}

// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

export class SettingsStore {
  private get db() {
    return DB.getInstance().raw;
  }

  private emptyProviderSettings(): ProviderSettings {
    return {
      providers: [],
      defaults: { main: "", summarizer: "", embedding: "", vlm: "" },
    };
  }

  private normalizeProviderSettings(input: unknown): ProviderSettings {
    if (!input || typeof input !== "object") {
      return this.emptyProviderSettings();
    }

    const raw = input as Partial<ProviderSettings>;
    const providers = Array.isArray(raw.providers)
      ? raw.providers.filter((p): p is ProviderConfig => !!p && typeof p.id === "string")
      : [];

    const defaultObj = (raw.defaults && typeof raw.defaults === "object")
      ? raw.defaults as Partial<ProviderDefaults>
      : {};

    const enabledProviderIds = providers.filter((p) => p.enabled).map((p) => p.id);
    const allProviderIds = providers.map((p) => p.id);
    const candidateIds = enabledProviderIds.length > 0 ? enabledProviderIds : allProviderIds;

    const main = candidateIds.includes(defaultObj.main ?? "")
      ? (defaultObj.main as string)
      : (candidateIds[0] ?? "");

    const normalizeRole = (roleValue: unknown): string => {
      if (typeof roleValue !== "string" || roleValue.length === 0) {
        return "";
      }
      return candidateIds.includes(roleValue) ? roleValue : "";
    };

    return {
      providers,
      defaults: {
        main,
        summarizer: normalizeRole(defaultObj.summarizer),
        embedding: normalizeRole(defaultObj.embedding),
        vlm: normalizeRole(defaultObj.vlm),
      },
    };
  }

  // -----------------------------------------------------------------------
  // Provider settings
  // -----------------------------------------------------------------------

  /** Get the full provider configuration from the settings table. */
  getProviderSettings(): ProviderSettings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = 'providers'")
      .get() as { value: string } | undefined;

    if (!row) {
      return this.emptyProviderSettings();
    }

    try {
      const parsed = JSON.parse(row.value) as unknown;
      const normalized = this.normalizeProviderSettings(parsed);

      // Auto-repair stale defaults (e.g. defaults.main points to a removed provider).
      if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
        this.saveProviderSettings(normalized);
      }

      return normalized;
    } catch {
      return this.emptyProviderSettings();
    }
  }

  /** Save the full provider configuration. */
  saveProviderSettings(settings: ProviderSettings): void {
    const normalized = this.normalizeProviderSettings(settings);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('providers', ?, datetime('now'))"
      )
      .run(JSON.stringify(normalized));
  }

  /** Get a single provider by ID. */
  getProvider(id: string): ProviderConfig | undefined {
    const settings = this.getProviderSettings();
    return settings.providers.find((p) => p.id === id);
  }

  /** Add or update a provider. */
  upsertProvider(provider: ProviderConfig): void {
    const settings = this.getProviderSettings();
    const idx = settings.providers.findIndex((p) => p.id === provider.id);
    if (idx >= 0) {
      settings.providers[idx] = provider;
    } else {
      settings.providers.push(provider);
    }
    this.saveProviderSettings(settings);
  }

  /** Delete a provider by ID. */
  deleteProvider(id: string): boolean {
    const settings = this.getProviderSettings();
    const before = settings.providers.length;
    settings.providers = settings.providers.filter((p) => p.id !== id);
    if (settings.providers.length === before) return false;
    this.saveProviderSettings(settings);
    return true;
  }

  /** Update the default role assignments. */
  updateDefaults(defaults: Partial<ProviderDefaults>): void {
    const settings = this.getProviderSettings();
    settings.defaults = { ...settings.defaults, ...defaults };
    this.saveProviderSettings(settings);
  }

  // -----------------------------------------------------------------------
  // Generic settings
  // -----------------------------------------------------------------------

  /** Get a setting value by key. Returns null if not found. */
  get(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /** Set a setting value. */
  set(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      )
      .run(key, value);
  }

  /** Delete a setting by key. */
  delete(key: string): boolean {
    const result = this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // Agent settings
  // -----------------------------------------------------------------------

  /** Get agent runtime settings, merged with defaults. */
  getAgentSettings(): AgentSettings {
    const raw = this.get("agent_settings");
    if (!raw) return { ...DEFAULT_AGENT_SETTINGS };
    try {
      const parsed = JSON.parse(raw) as Partial<AgentSettings>;
      return { ...DEFAULT_AGENT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_AGENT_SETTINGS };
    }
  }

  /** Save agent runtime settings. */
  saveAgentSettings(settings: Partial<AgentSettings>): AgentSettings {
    const current = this.getAgentSettings();
    const merged = { ...current, ...settings };
    this.set("agent_settings", JSON.stringify(merged));
    return merged;
  }

  // -----------------------------------------------------------------------
  // Enhanced models
  // -----------------------------------------------------------------------

  /** Get enhanced model entries from settings. */
  getEnhancedModels(): Array<{
    id: string;
    modelType: string;
    name: string;
    description: string;
    providerId: string;
    model: string;
    enabled: boolean;
    capabilities: string[];
    priority: number;
    temperature?: number;
    maxTokens?: number;
  }> {
    const raw = this.get("enhanced_models");
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** Save enhanced model entries. */
  saveEnhancedModels(models: unknown[]): void {
    this.set("enhanced_models", JSON.stringify(models));
  }
}
