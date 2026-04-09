/**
 * router.ts - Model Router
 *
 * Reads the YAML configuration, instantiates provider adapters, and
 * dispatches chat/chatStream calls to the appropriate provider.
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

// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------

export class ModelRouter {
  private providers = new Map<string, ModelProvider>();
  private config: AppConfig | null = null;

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize the router by reading and validating the YAML config file,
   * then instantiating a provider for every named model entry.
   *
   * @param configPath - Absolute or relative path to the YAML config file.
   *   Defaults to "config/default.yaml" relative to the cwd.
   */
  async initialize(configPath?: string): Promise<void> {
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
  // Provider access
  // -----------------------------------------------------------------------

  /**
   * Return a provider by its config name, or the default main provider
   * if no name is given.
   */
  getProvider(name?: string): ModelProvider {
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
    return this.getProvider(options.model).chat(messages, options);
  }

  async *chatStream(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    // We cannot directly yield* from an async generator that requires a
    // provider lookup, so we obtain the provider and delegate.
    const provider = this.getProvider(options.model);
    yield* provider.chatStream(messages, options);
  }

  estimateTokens(text: string): number {
    return this.getProvider().estimateTokens(text);
  }

  // -----------------------------------------------------------------------
  // Default model lookup by role
  // -----------------------------------------------------------------------

  /**
   * Return the model identifier for a given role.
   * Falls back to the "main" default if the requested role is not configured.
   */
  getDefaultModel(role: ModelRole): string {
    if (!this.config) {
      throw new Error("ModelRouter: not initialized. Call initialize() first.");
    }

    const modelName =
      this.config.defaults[role as keyof typeof this.config.defaults];
    if (modelName) {
      return modelName;
    }

    // Fallback: if the role itself exists as a model name, return it
    if (this.config.models[role]) {
      return role;
    }

    // Final fallback: return whatever "main" resolves to
    return this.config.defaults.main;
  }

  // -----------------------------------------------------------------------
  // Internal
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
        // TypeScript exhaustive check - should never reach here due to
        // Zod enum validation, but we handle it gracefully.
        const _exhaustive: never = modelConfig.provider;
        throw new Error(
          `ModelRouter: unsupported provider type "${String(_exhaustive)}" for model "${name}"`,
        );
      }
    }
  }
}
