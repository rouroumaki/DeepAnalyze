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
import { getProviderMetadata } from "./provider-registry";
import type { ProviderConfig } from "../store/repos/index.js";

// ---------------------------------------------------------------------------
// Global config version counter — incremented when settings change via API.
// Each ModelRouter instance checks this on each call and auto-reloads if stale.
// ---------------------------------------------------------------------------

let configVersion = 0;

/**
 * Increment the global config version. Called by the Settings API after
 * provider/defaults/enhanced-model changes. All ModelRouter instances will
 * reload on their next operation.
 */
export function bumpConfigVersion(): void {
  configVersion++;
  console.log(`[ModelRouter] Config version bumped to ${configVersion}`);
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  resetTimeout: number; // ms, default 60000
}

class CircuitBreaker {
  private circuits = new Map<string, CircuitBreakerState>();

  /** Check if the circuit for a provider is open (should be skipped). */
  isOpen(providerId: string): boolean {
    const circuit = this.circuits.get(providerId);
    if (!circuit) return false;

    if (circuit.state === "open") {
      // Check if reset timeout has elapsed
      if (Date.now() - circuit.lastFailure > circuit.resetTimeout) {
        circuit.state = "half-open";
        console.log(`[CircuitBreaker] ${providerId} entering half-open state`);
        return false;
      }
      return true;
    }

    return false;
  }

  /** Record a successful call — reset the circuit. */
  recordSuccess(providerId: string): void {
    const circuit = this.circuits.get(providerId);
    if (circuit) {
      circuit.failures = 0;
      circuit.state = "closed";
    }
  }

  /** Record a failed call — open the circuit if threshold reached. */
  recordFailure(providerId: string): void {
    let circuit = this.circuits.get(providerId);
    if (!circuit) {
      circuit = { failures: 0, lastFailure: 0, state: "closed", resetTimeout: 60000 };
      this.circuits.set(providerId, circuit);
    }

    circuit.failures++;
    circuit.lastFailure = Date.now();

    if (circuit.state === "half-open") {
      circuit.state = "open";
      console.warn(`[CircuitBreaker] ${providerId} half-open test failed, re-opening circuit`);
    } else if (circuit.failures >= 3) {
      circuit.state = "open";
      console.warn(`[CircuitBreaker] ${providerId} circuit opened after ${circuit.failures} failures`);
    }
  }
}

// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------

export class ModelRouter {
  private providers = new Map<string, ModelProvider>();
  private config: AppConfig | null = null;
  /** Maps provider IDs to provider names for role resolution */
  private providerIdToName = new Map<string, string>();
  /** Default role assignments from DB settings */
  private dbDefaults: { main: string; summarizer: string; embedding: string; vlm: string; tts: string; image_gen: string; video_gen: string; music_gen: string; audio_transcribe: string; video_understand: string } | null = null;
  /** Config version at the time of last initialization */
  private loadedVersion = -1;
  private circuitBreaker = new CircuitBreaker();

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
      this.loadedVersion = configVersion;
      console.log("[ModelRouter] Loaded provider config from database");
      return;
    }

    // Fallback to YAML config
    this.loadFromYaml(configPath);
    this.loadedVersion = configVersion;
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
   * Ensure the router has the latest config. Auto-reloads if the global
   * config version has changed since last initialization.
   */
  async ensureCurrent(): Promise<void> {
    if (this.loadedVersion < configVersion) {
      await this.reload();
    }
  }

  /**
   * Return a provider by its config name, or the default main provider
   * if no name is given. Skips providers with open circuits.
   */
  getProvider(name?: string): ModelProvider {
    const targetId = name ?? this.getDefaultProviderId();

    // If the target provider is not open-circuited, use it
    if (!this.circuitBreaker.isOpen(targetId)) {
      const provider = this.providers.get(targetId);
      if (provider) return provider;
    }

    // Try to find an alternate provider that isn't open-circuited
    for (const [id, provider] of this.providers) {
      if (id !== targetId && !this.circuitBreaker.isOpen(id)) {
        console.warn(`[ModelRouter] Provider "${targetId}" unavailable, falling back to "${id}"`);
        return provider;
      }
    }

    // All alternatives exhausted — try the original anyway
    const provider = this.providers.get(targetId);
    if (provider) return provider;

    const available = [...this.providers.keys()].join(", ");
    throw new Error(
      `ModelRouter: provider "${targetId}" not found. Available: ${available}`,
    );
  }

  /** Get the default provider ID from either DB or YAML config. */
  private getDefaultProviderId(): string {
    if (this.dbDefaults) {
      return this.dbDefaults.main || this.providers.keys().next().value || "";
    }
    if (!this.config) {
      throw new Error("ModelRouter: not initialized. Call initialize() first.");
    }
    return this.config.defaults.main;
  }

  // -----------------------------------------------------------------------
  // Convenience methods that delegate to the default (or named) provider
  // -----------------------------------------------------------------------

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    await this.ensureCurrent();
    const { model: _providerKey, ...providerOptions } = options;
    const providerId = this.resolveProviderId(options.model);
    const provider = this.getProvider(options.model);

    try {
      const result = await provider.chat(messages, providerOptions);
      this.circuitBreaker.recordSuccess(providerId);
      return result;
    } catch (err) {
      this.circuitBreaker.recordFailure(providerId);
      throw err;
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    await this.ensureCurrent();
    const { model: _providerKey, ...providerOptions } = options;
    const providerId = this.resolveProviderId(options.model);
    const provider = this.getProvider(options.model);

    let firstChunk = true;
    try {
      for await (const chunk of provider.chatStream(messages, providerOptions)) {
        if (firstChunk) {
          this.circuitBreaker.recordSuccess(providerId);
          firstChunk = false;
        }
        yield chunk;
      }
    } catch (err) {
      if (firstChunk) {
        this.circuitBreaker.recordFailure(providerId);
      }
      throw err;
    }
  }

  /** Resolve the actual provider ID from an options.model value. */
  private resolveProviderId(model?: string): string {
    return model ?? this.getDefaultProviderId();
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
      if (this.dbDefaults.main) return this.dbDefaults.main;
      // No default configured — fall back to first available provider
      const firstId = this.providers.keys().next().value;
      if (firstId) return firstId;
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
      const { getRepos } = await import("../store/repos/index.js");
      const repos = await getRepos();
      const settings = await repos.settings.getProviderSettings();

      if (!settings.providers || settings.providers.length === 0) return false;

      // Clean up stale "default" provider seeded by migration 004 (now removed).
      // It pointed to localhost:11434 with model "qwen2.5-14b" and no API key.
      let changed = false;
      settings.providers = settings.providers.filter((p: ProviderConfig) => {
        if (p.id === "default" && (!p.apiKey || p.apiKey === "") && p.endpoint?.includes("localhost:11434")) {
          console.log("[ModelRouter] Removing stale 'default' provider (migration seed)");
          changed = true;
          return false;
        }
        return true;
      });
      // Also clear defaults references to the removed "default" provider
      if (changed) {
        const defaults = settings.defaults as unknown as Record<string, string>;
        for (const key of Object.keys(defaults)) {
          if (defaults[key] === "default") {
            defaults[key] = "";
          }
        }
        await repos.settings.saveProviderSettings(settings);
      }

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

      this.dbDefaults = settings.defaults;
      console.log(`[ModelRouter] Loaded defaults: main="${settings.defaults.main}", summarizer="${settings.defaults.summarizer}", embedding="${settings.defaults.embedding}"`);
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
    // Look up thinking config from registry if available
    const meta = getProviderMetadata(p.id);
    const defaultModel = meta?.models.find(m => m.id === p.model);

    const options: OpenAICompatibleOptions = {
      name: p.id,
      endpoint: p.endpoint,
      apiKey: p.apiKey || undefined,
      model: p.model,
      maxTokens: p.maxTokens,
      temperature: p.temperature,
      topP: p.topP,
      topK: p.topK,
      frequencyPenalty: p.frequencyPenalty,
      presencePenalty: p.presencePenalty,
      thinkingEnabled: p.thinkingEnabled,
      thinkingConfig: defaultModel?.thinkingConfig,
    };
    return new OpenAICompatibleProvider(options);
  }
}
