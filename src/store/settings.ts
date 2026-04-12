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

  // -----------------------------------------------------------------------
  // Provider settings
  // -----------------------------------------------------------------------

  /** Get the full provider configuration from the settings table. */
  getProviderSettings(): ProviderSettings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = 'providers'")
      .get() as { value: string } | undefined;

    if (!row) {
      return { providers: [], defaults: { main: "", summarizer: "", embedding: "", vlm: "" } };
    }

    return JSON.parse(row.value) as ProviderSettings;
  }

  /** Save the full provider configuration. */
  saveProviderSettings(settings: ProviderSettings): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('providers', ?, datetime('now'))"
      )
      .run(JSON.stringify(settings));
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
}
