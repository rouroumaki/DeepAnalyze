// =============================================================================
// DeepAnalyze - Embedding Model Management
// Provides embedding generation via OpenAI-compatible APIs or a hash-based
// fallback when no embedding model is configured.
// =============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ModelRouter } from "./router.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Result of embedding a single piece of text. */
export interface EmbeddingResult {
  /** The embedding vector. */
  embedding: Float32Array;
  /** The original text that was embedded. */
  text: string;
  /** Estimated token count for the text. */
  tokenCount: number;
}

/** Contract for an embedding provider. */
export interface EmbeddingProvider {
  /** Human-readable name for this provider. */
  readonly name: string;
  /** Dimensionality of the embedding vectors. */
  readonly dimension: number;
  /** Generate embeddings for a batch of texts. */
  embed(texts: string[]): Promise<EmbeddingResult[]>;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible embedding provider
// ---------------------------------------------------------------------------

export interface OpenAIEmbeddingOptions {
  name: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  dimension: number;
}

/**
 * Embedding provider that calls an OpenAI-compatible /v1/embeddings endpoint.
 * Works with Ollama, vLLM, LiteLLM, and any server implementing the protocol.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(opts: OpenAIEmbeddingOptions) {
    this.name = opts.name;
    this.dimension = opts.dimension;
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const url = `${this.endpoint}/embeddings`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      input: texts,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(
        `Embedding provider "${this.name}" returned HTTP ${response.status}: ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{
        embedding: number[];
        index: number;
      }>;
      usage?: {
        prompt_tokens: number;
        total_tokens: number;
      };
    };

    if (!data.data || data.data.length === 0) {
      throw new Error(
        `Embedding provider "${this.name}" returned no embeddings`,
      );
    }

    // Sort by index to ensure correct ordering
    const sorted = [...data.data].sort((a, b) => a.index - b.index);

    return sorted.map((item, i) => ({
      embedding: new Float32Array(item.embedding),
      text: texts[i] ?? "",
      tokenCount: Math.ceil((texts[i] ?? "").length / 4),
    }));
  }
}

// ---------------------------------------------------------------------------
// Hash-based fallback embedding provider
// ---------------------------------------------------------------------------

/**
 * Simple hash-based embedding provider for when no real embedding model is
 * available. Uses overlapping n-gram hashing to create pseudo-embeddings.
 *
 * This allows the system to function without a real embedding model, but
 * will NOT provide meaningful semantic search -- only approximate lexical
 * matching. The vectors are deterministic for the same input text.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = "hash-fallback";
  readonly dimension = 256;

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    return texts.map((text) => ({
      embedding: this.hashEmbed(text),
      text,
      tokenCount: Math.ceil(text.length / 4),
    }));
  }

  /**
   * Create a fixed-dimension pseudo-embedding from text using n-gram hashing.
   * Splits text into overlapping character n-grams, hashes each, and maps
   * hash values into vector positions, then normalizes the result.
   */
  private hashEmbed(text: string): Float32Array {
    const dim = this.dimension;
    const vec = new Float32Array(dim);

    if (text.length === 0) {
      return vec;
    }

    // Generate overlapping n-grams of sizes 2, 3, and 4
    const ngramSizes = [2, 3, 4];

    for (const n of ngramSizes) {
      for (let i = 0; i <= text.length - n; i++) {
        const ngram = text.substring(i, i + n);

        // Hash the n-gram using MD5 and extract two 32-bit values
        const hash = createHash("md5").update(ngram).digest();
        const h1 = hash.readUInt32LE(0);
        const h2 = hash.readUInt32LE(4);

        // Map to vector positions
        const pos1 = h1 % dim;
        const pos2 = h2 % dim;

        // Add weighted contributions
        vec[pos1] += 1.0;
        vec[pos2] -= 0.5;
      }
    }

    // Also hash individual words for single-word signals
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length === 0) continue;
      const hash = createHash("md5").update(word).digest();
      const h = hash.readUInt32LE(0);
      const pos = h % dim;
      vec[pos] += 2.0;
    }

    // Normalize to unit length
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        vec[i] /= norm;
      }
    }

    return vec;
  }
}

// ---------------------------------------------------------------------------
// EmbeddingManager - unified entry point
// ---------------------------------------------------------------------------

/**
 * Manages embedding generation. Attempts to use a configured embedding model
 * from the ModelRouter; falls back to the hash-based provider when none is
 * available.
 */
export class EmbeddingManager {
  private provider: EmbeddingProvider;

  constructor(router: ModelRouter) {
    // Try to get an embedding model from the router configuration.
    // If that fails or no embedding model is configured, use the hash fallback.
    this.provider = this.resolveProvider(router);
  }

  /** Initialize the manager (currently a no-op, reserved for future use). */
  async initialize(): Promise<void> {
    // Reserved for future lazy-loading or warm-up logic
  }

  /** Generate an embedding for a single piece of text. */
  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.provider.embed([text]);
    return results[0];
  }

  /** Generate embeddings for a batch of texts. */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    // Process in chunks of 64 to avoid overloading the API
    const batchSize = 64;
    const allResults: EmbeddingResult[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const results = await this.provider.embed(chunk);
      allResults.push(...results);
    }

    return allResults;
  }

  /** Get the dimensionality of the current embedding provider. */
  get dimension(): number {
    return this.provider.dimension;
  }

  /** Get the name of the current embedding provider. */
  get providerName(): string {
    return this.provider.name;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private resolveProvider(router: ModelRouter): EmbeddingProvider {
    try {
      const modelName = router.getDefaultModel("embedding");

      // Try to access the provider to verify it exists
      router.getProvider(modelName);

      // The provider exists in the router. We need to read the config
      // to get the endpoint and other settings for embedding API calls.
      return this.tryCreateFromConfig(modelName);
    } catch {
      // No embedding model configured or provider not found, use fallback
    }

    return new HashEmbeddingProvider();
  }

  /**
   * Attempt to create an OpenAIEmbeddingProvider by reading the config file
   * directly. Falls back to HashEmbeddingProvider on any failure.
   */
  private tryCreateFromConfig(modelName: string): EmbeddingProvider {
    try {
      const configPath = resolve("config/default.yaml");
      const raw = readFileSync(configPath, "utf-8");
      const parsed = parseYaml(raw);
      const modelConfig = parsed?.models?.[modelName];

      if (!modelConfig) {
        return new HashEmbeddingProvider();
      }

      // Determine dimension from the model config or use a reasonable default
      const dimension = modelConfig.dimension ?? 768;

      return new OpenAIEmbeddingProvider({
        name: modelName,
        endpoint: modelConfig.endpoint,
        apiKey: modelConfig.apiKey,
        model: modelConfig.model,
        dimension,
      });
    } catch {
      return new HashEmbeddingProvider();
    }
  }
}
