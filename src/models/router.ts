/**
 * router.ts - Model Router
 *
 * Reads provider configuration from the database settings table (primary)
 * or the YAML config file (fallback), instantiates provider adapters, and
 * dispatches chat/chatStream calls to the appropriate provider.
 *
 * The router can be re-initialized at runtime when provider settings change
 * via the Settings API.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { AppConfigSchema, type AppConfig, type ModelRole } from "./provider";
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ModelProvider,
  StreamChunk,
} from "./provider";
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleOptions,
} from "./openai-compatible";
import type { ProviderConfig } from "../store/settings.js";

// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------

export class ModelRouter {
  private providers = new Map<string, ModelProvider>();
  private config: AppConfig | null = null;
  /** Maps provider IDs to provider names for role resolution */
  private providerIdToName = new Map<string, string>();
  /** Default role assignments from DB settings */
  private dbDefaults: { main: string; summarizer: string; embedding: string; vlm: string } | null = null;

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize the router. Tries database settings first (from the settings
   * store), then falls back to the YAML config file.
   *
   * @param configPath - Path to the YAML config file (fallback).
   */
  async initialize(configPath?: string): Promise<void> {
    // Try database settings first
    const dbLoaded = await this.tryLoadFromDatabase();
    if (dbLoaded) {
      console.log("[ModelRouter] Loaded provider config from database");
      return;
    }

    // Fallback to YAML config
    this.loadFromYaml(configPath);
    console.log("[ModelRouter] Loaded provider config from YAML file");
  }

  /**
   * Re-initialize from database settings (called when providers are updated
   * via the Settings API).
   */
  async reload(): Promise<void> {
    this.providers.clear();
    this.config = null;
    this.providerIdToName.clear();
    this.dbDefaults = null;
    await this.initialize();
  }

  // -----------------------------------------------------------------------
  // Provider access
  // -----------------------------------------------------------------------

  /**
   * Return a provider by its config name, or the default main provider
   * if no name is given.
   */
  getProvider(name?: string): ModelProvider {
    if (!this.config && this.dbDefaults) {
      // Using database config - resolve by ID or default
      const providerId = name ?? this.dbDefaults.main;
      const provider = this.providers.get(providerId);
      if (!provider) {
        const available = [...this.providers.keys()].join(", ");
        throw new Error(
          `ModelRouter: provider "${providerId}" not found. Available: ${available}`,
        );
      }
      return provider;
    }

    if (!this.config) {
      throw new Error("ModelRouter: not initialized. Call initialize() first.");
    }

    const providerName = name ?? this.config.defaults.main;
    const provider = this.providers.get(providerName);
    if (!provider) {
      const available = [...this.providers.keys()].join(", ");
      throw new Error(
        `ModelRouter: provider "${providerName}" not found. Available: ${available}`,
      );
    }
    return provider;
  }

  // -----------------------------------------------------------------------
  // Convenience methods that delegate to the default (or named) provider
  // -----------------------------------------------------------------------

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    // options.model is a provider lookup key (e.g. "minimax"), NOT the API model name.
    // Strip it before forwarding to the provider so the provider uses its own defaultModel.
    const { model: _providerKey, ...providerOptions } = options;
    return this.getProvider(options.model).chat(messages, providerOptions);
  }

  async *chatStream(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    const { model: _providerKey, ...providerOptions } = options;
    const provider = this.getProvider(options.model);
    yield* provider.chatStream(messages, providerOptions);
  }

  estimateTokens(text: string): number {
    return this.getProvider().estimateTokens(text);
  }

  // -----------------------------------------------------------------------
  // Default model lookup by role
  // -----------------------------------------------------------------------

  getDefaultModel(role: ModelRole): string {
    // Database config path
    if (this.dbDefaults) {
      const modelId = this.dbDefaults[role];
      if (modelId) return modelId;
      return this.dbDefaults.main;
    }

    // YAML config path
    if (!this.config) {
      throw new Error("ModelRouter: not initialized. Call initialize() first.");
    }

    const modelName =
      this.config.defaults[role as keyof typeof this.config.defaults];
    if (modelName) {
      return modelName;
    }

    if (this.config.models[role]) {
      return role;
    }

    return this.config.defaults.main;
  }

  // -----------------------------------------------------------------------
  // List configured providers (for API exposure)
  // -----------------------------------------------------------------------

  /** Return the names of all configured providers. */
  listProviderNames(): string[] {
    return [...this.providers.keys()];
  }

  // -----------------------------------------------------------------------
  // Internal - Database loading
  // -----------------------------------------------------------------------

  private async tryLoadFromDatabase(): Promise<boolean> {
    try {
      // Dynamic import to avoid circular dependency at module load time.
      // DB singleton is initialized in main.ts before the ModelRouter.
      const { DB } = await import("../store/database.js");
      if (!DB.isReady()) return false;

      const db = DB.getInstance();

      // Check if the settings table exists yet
      const table = db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
        .get() as { name: string } | undefined;
      if (!table) return false;

      const row = db.raw
        .prepare("SELECT value FROM settings WHERE key = 'providers'")
        .get() as { value: string } | undefined;
      if (!row) return false;

      const settings = JSON.parse(row.value) as {
        providers: ProviderConfig[];
        defaults: { main: string; summarizer: string; embedding: string; vlm: string };
      };

      if (!settings.providers || settings.providers.length === 0) return false;

      // Clear and rebuild from DB config
      this.providers.clear();
      this.providerIdToName.clear();

      for (const p of settings.providers) {
        if (!p.enabled) continue;
        const provider = this.createProviderFromConfig(p);
        this.providers.set(p.id, provider);
        this.providerIdToName.set(p.id, p.id);
      }

      if (this.providers.size === 0) return false;

      const availableProviderIds = [...this.providers.keys()];
      const rawDefaults = settings.defaults ?? { main: "", summarizer: "", embedding: "", vlm: "" };
      const resolveRoleDefault = (value: string | undefined): string =>
        value && availableProviderIds.includes(value) ? value : "";
      const resolvedMain = resolveRoleDefault(rawDefaults.main) || availableProviderIds[0];

      this.dbDefaults = {
        main: resolvedMain,
        summarizer: resolveRoleDefault(rawDefaults.summarizer),
        embedding: resolveRoleDefault(rawDefaults.embedding),
        vlm: resolveRoleDefault(rawDefaults.vlm),
      };
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Internal - YAML loading (fallback)
  // -----------------------------------------------------------------------

  private loadFromYaml(configPath?: string): void {
    const resolvedPath = resolve(configPath ?? "config/default.yaml");

    let raw: string;
    try {
      raw = readFileSync(resolvedPath, "utf-8");
    } catch (err) {
      throw new Error(
        `ModelRouter: failed to read config at "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(
        `ModelRouter: failed to parse YAML config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const result = AppConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`ModelRouter: invalid config schema: ${issues}`);
    }

    this.config = result.data;
    this.providers.clear();

    for (const [name, modelConfig] of Object.entries(this.config.models)) {
      const provider = this.createProvider(name, modelConfig);
      this.providers.set(name, provider);
    }
  }

  // -----------------------------------------------------------------------
  // Internal - Provider factory
  // -----------------------------------------------------------------------

  private createProvider(
    name: string,
    modelConfig: AppConfig["models"][string],
  ): ModelProvider {
    switch (modelConfig.provider) {
      case "openai-compatible": {
        const options: OpenAICompatibleOptions = {
          name,
          endpoint: modelConfig.endpoint,
          apiKey: modelConfig.apiKey,
          model: modelConfig.model,
          maxTokens: modelConfig.maxTokens,
        };
        return new OpenAICompatibleProvider(options);
      }

      default: {
        const _exhaustive: never = modelConfig.provider;
        throw new Error(
          `ModelRouter: unsupported provider type "${String(_exhaustive)}" for model "${name}"`,
        );
      }
    }
  }

  private createProviderFromConfig(p: ProviderConfig): ModelProvider {
    // All provider types use OpenAI-compatible protocol for now
    // (Ollama, vLLM, LM Studio, LiteLLM, OpenAI, DeepSeek, etc.)
    const options: OpenAICompatibleOptions = {
      name: p.id,
      endpoint: p.endpoint,
      apiKey: p.apiKey || undefined,
      model: p.model,
      maxTokens: p.maxTokens,
    };
    return new OpenAICompatibleProvider(options);
  }
}
