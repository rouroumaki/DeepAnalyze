// =============================================================================
// DeepAnalyze - Settings & Provider API Routes
// =============================================================================
// REST API for managing model provider configurations and system settings.
// =============================================================================

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { getRepos } from "../../store/repos/index.js";
import type { ProviderConfig, ProviderDefaults, DoclingConfig } from "../../store/repos/index.js";
import { getAllProviders, getProviderMetadata, type ProviderMetadata } from "../../models/provider-registry.js";
import { bumpConfigVersion } from "../../models/router.js";
import { DEFAULT_AGENT_SETTINGS } from "../../services/agent/types.js";
import type { AgentSettings } from "../../services/agent/types.js";

const DEFAULT_DOCLING_CONFIG: DoclingConfig = {
  layout_model: "docling-project/docling-layout-egret-xlarge",
  ocr_engine: "rapidocr",
  ocr_backend: "torch",
  table_mode: "accurate",
  use_vlm: false,
  vlm_model: "",
};

const EMPTY_PROVIDER_DEFAULTS: ProviderDefaults = {
  main: "", summarizer: "", embedding: "", vlm: "", tts: "", image_gen: "", video_gen: "", music_gen: "",
};

export function createSettingsRoutes(): Hono {
  const router = new Hono();

  // -----------------------------------------------------------------------
  // Root — endpoint discovery
  // -----------------------------------------------------------------------

  router.get("/", (c) => c.json({
    status: "ok",
    message: "Settings API",
    endpoints: [
      "GET    /registry — List all known provider types",
      "GET    /registry/:id — Get provider type metadata",
      "GET    /providers — List configured providers",
      "GET    /providers/:id — Get provider settings",
      "PUT    /providers/:id — Create/update provider",
      "DELETE /providers/:id — Delete provider",
      "POST   /providers/:id/test — Test provider connectivity",
      "GET    /defaults — Get default role assignments",
      "PUT    /defaults — Update default role assignments",
      "GET    /agent — Get agent runtime settings",
      "PUT    /agent — Update agent runtime settings",
      "GET    /key/:key — Get a single setting value",
      "PUT    /key/:key — Set a single setting value",
      "GET    /enhanced-models — List enhanced model configs",
      "PUT    /enhanced-models — Update enhanced model configs",
      "POST   /auto-configure — Auto-discover and configure providers from env vars",
    ],
  }));

  // -----------------------------------------------------------------------
  // Provider registry (read-only metadata about all known providers)
  // -----------------------------------------------------------------------

  /** List all known provider types from the registry */
  router.get("/registry", (c) => {
    return c.json(getAllProviders());
  });

  /** Get metadata for a single provider type */
  router.get("/registry/:id", (c) => {
    const meta = getProviderMetadata(c.req.param("id"));
    if (!meta) {
      return c.json({ error: "Provider type not found in registry" }, 404);
    }
    return c.json(meta);
  });

  // -----------------------------------------------------------------------
  // Provider CRUD (user-configured instances)
  // -----------------------------------------------------------------------

  /** List all configured providers */
  router.get("/providers", async (c) => {
    const repos = await getRepos();
    const settings = await repos.settings.getProviderSettings();
    return c.json(settings);
  });

  /** Get a single provider */
  router.get("/providers/:id", async (c) => {
    const repos = await getRepos();
    const allSettings = await repos.settings.getProviderSettings();
    const provider = allSettings.providers.find((p: ProviderConfig) => p.id === c.req.param("id"));
    if (!provider) {
      return c.json({ error: "Provider not found" }, 404);
    }
    return c.json(provider);
  });

  /** Create or update a provider */
  router.put("/providers/:id", async (c) => {
    const body = await c.req.json<ProviderConfig>();
    const id = c.req.param("id");

    if (body.id !== id) {
      return c.json({ error: "Provider ID in body does not match URL" }, 400);
    }

    const repos = await getRepos();
    const settings = await repos.settings.getProviderSettings();
    const idx = settings.providers.findIndex((p: ProviderConfig) => p.id === id);
    if (idx >= 0) {
      settings.providers[idx] = body;
    } else {
      settings.providers.push(body);
    }

    // Auto-assign as default main provider if no default is set yet
    if (!settings.defaults.main && body.enabled) {
      console.log(`[Settings] Auto-assigning "${id}" as default main provider`);
      settings.defaults.main = id;
    }

    await repos.settings.saveProviderSettings(settings);

    bumpConfigVersion();
    return c.json({ success: true, provider: body, defaults: settings.defaults });
  });

  /** Delete a provider */
  router.delete("/providers/:id", async (c) => {
    const repos = await getRepos();
    const settings = await repos.settings.getProviderSettings();
    const before = settings.providers.length;
    settings.providers = settings.providers.filter((p: ProviderConfig) => p.id !== c.req.param("id"));
    if (settings.providers.length === before) {
      return c.json({ error: "Provider not found" }, 404);
    }
    await repos.settings.saveProviderSettings(settings);
    bumpConfigVersion();
    return c.json({ success: true });
  });

  // -----------------------------------------------------------------------
  // Default role assignments
  // -----------------------------------------------------------------------

  /** Get current defaults */
  router.get("/defaults", async (c) => {
    const repos = await getRepos();
    const settings = await repos.settings.getProviderSettings();
    return c.json(settings.defaults);
  });

  /** Update default role assignments */
  router.put("/defaults", async (c) => {
    const body = await c.req.json<Partial<ProviderDefaults>>();
    const repos = await getRepos();
    const settings = await repos.settings.getProviderSettings();
    settings.defaults = { ...settings.defaults, ...body };
    console.log(`[Settings] Updating defaults:`, JSON.stringify(body), `→ main="${settings.defaults.main}"`);
    await repos.settings.saveProviderSettings(settings);
    bumpConfigVersion();
    return c.json({ success: true, defaults: settings.defaults });
  });

  // -----------------------------------------------------------------------
  // Test provider connectivity
  // -----------------------------------------------------------------------

  /** Test if a provider endpoint is reachable */
  router.post("/providers/:id/test", async (c) => {
    const repos = await getRepos();
    const allSettings = await repos.settings.getProviderSettings();
    const provider = allSettings.providers.find((p: ProviderConfig) => p.id === c.req.param("id"));
    if (!provider) {
      return c.json({ error: "Provider not found" }, 404);
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider.apiKey) {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
      }

      // Strategy 1: Try /models endpoint (standard OpenAI-compatible)
      const modelsUrl = provider.endpoint.replace(/\/+$/, "") + "/models";
      const controller1 = new AbortController();
      const timeout1 = setTimeout(() => controller1.abort(), 8000);

      const modelsResp = await fetch(modelsUrl, {
        signal: controller1.signal,
        headers: { Authorization: headers["Authorization"] },
      }).catch(() => null);
      clearTimeout(timeout1);

      if (modelsResp?.ok) {
        const data = await modelsResp.json();
        return c.json({
          success: true,
          status: modelsResp.status,
          models: data.data?.map?.((m: { id: string }) => m.id) ?? [],
        });
      }

      // Strategy 2: Fallback to a minimal chat completion request
      // Many providers (MiniMax, Qwen Coding Plan) don't implement /models
      const chatUrl = provider.endpoint.replace(/\/+$/, "") + "/chat/completions";
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 15000);

      const chatResp = await fetch(chatUrl, {
        signal: controller2.signal,
        headers,
        method: "POST",
        body: JSON.stringify({
          model: provider.model || "default",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
      });
      clearTimeout(timeout2);

      if (chatResp.ok) {
        return c.json({
          success: true,
          status: chatResp.status,
          models: [provider.model],
        });
      }

      // Both failed
      const errorBody = await chatResp.text().catch(() => "");
      return c.json({
        success: false,
        status: chatResp.status,
        error: `HTTP ${chatResp.status}: ${errorBody.slice(0, 200)}`,
      });
    } catch (err) {
      return c.json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Agent settings (runtime-configurable)
  // -----------------------------------------------------------------------

  /** Get agent runtime settings */
  router.get("/agent", async (c) => {
    const repos = await getRepos();
    const raw = await repos.settings.get("agent_settings");
    if (!raw) return c.json({ ...DEFAULT_AGENT_SETTINGS });
    try {
      const parsed = JSON.parse(raw) as Partial<AgentSettings>;
      return c.json({ ...DEFAULT_AGENT_SETTINGS, ...parsed });
    } catch {
      return c.json({ ...DEFAULT_AGENT_SETTINGS });
    }
  });

  /** Update agent runtime settings */
  router.put("/agent", async (c) => {
    const body = await c.req.json<Partial<AgentSettings>>();
    const repos = await getRepos();

    // Get current settings
    const raw = await repos.settings.get("agent_settings");
    let current = { ...DEFAULT_AGENT_SETTINGS };
    if (raw) {
      try { current = { ...DEFAULT_AGENT_SETTINGS, ...JSON.parse(raw) }; } catch {}
    }
    const merged = { ...current, ...body };
    await repos.settings.set("agent_settings", JSON.stringify(merged));

    return c.json({ success: true, settings: merged });
  });

  // -----------------------------------------------------------------------
  // Generic settings
  // -----------------------------------------------------------------------

  /** Get a setting value */
  router.get("/key/:key", async (c) => {
    const repos = await getRepos();
    const value = await repos.settings.get(c.req.param("key"));
    if (value === null) {
      return c.json({ error: "Setting not found" }, 404);
    }
    return c.json({ key: c.req.param("key"), value });
  });

  /** Set a setting value */
  router.put("/key/:key", async (c) => {
    const { value } = await c.req.json<{ value: string }>();
    const repos = await getRepos();
    await repos.settings.set(c.req.param("key"), value);
    return c.json({ success: true });
  });

  // -----------------------------------------------------------------------
  // Enhanced models
  // -----------------------------------------------------------------------

  /** Get enhanced model entries */
  router.get("/enhanced-models", async (c) => {
    const repos = await getRepos();
    const raw = await repos.settings.get("enhanced_models");
    if (!raw) return c.json([]);
    try {
      return c.json(JSON.parse(raw));
    } catch {
      return c.json([]);
    }
  });

  /** Save enhanced model entries */
  router.put("/enhanced-models", async (c) => {
    const models = await c.req.json<unknown[]>();
    const repos = await getRepos();
    await repos.settings.set("enhanced_models", JSON.stringify(models));
    bumpConfigVersion();
    return c.json({ success: true, count: models.length });
  });

  // -----------------------------------------------------------------------
  // Auto-configure providers from env vars
  // -----------------------------------------------------------------------

  /** Auto-discover and configure providers from environment variables */
  router.post("/auto-configure", async (c) => {
    const results: Array<{ provider: string; status: string; error?: string }> = [];

    // Map of env var names to provider registry IDs
    const envToProvider: Record<string, { id: string; modelRole: string; model: string; extraModels?: Array<{ id: string; model: string; role: string }> }> = {
      MINIMAX_API_KEY: {
        id: "minimax",
        modelRole: "main",
        model: "MiniMax-M2.7-highspeed",
        extraModels: [
          { id: "minimax-embedding", model: "embo-01", role: "embedding" },
          { id: "minimax-tts", model: "speech-01-hd", role: "tts" },
          { id: "minimax-image", model: "image-01", role: "image_gen" },
          { id: "minimax-video", model: "video-01", role: "video_gen" },
          { id: "minimax-music", model: "music-2.6", role: "music_gen" },
        ],
      },
      OPENAI_API_KEY: {
        id: "openai",
        modelRole: "main",
        model: "gpt-5.4",
      },
      ANTHROPIC_API_KEY: {
        id: "anthropic",
        modelRole: "main",
        model: "claude-opus-4-6",
      },
      DEEPSEEK_API_KEY: {
        id: "deepseek",
        modelRole: "main",
        model: "deepseek-chat",
      },
      OPENROUTER_API_KEY: {
        id: "openrouter",
        modelRole: "main",
        model: "anthropic/claude-opus-4-6",
      },
      DASHSCOPE_API_KEY: {
        id: "qwen",
        modelRole: "main",
        model: "qwen3.6-plus",
      },
      MOONSHOT_API_KEY: {
        id: "moonshot",
        modelRole: "main",
        model: "kimi-k2.5",
      },
      ZHIPUAI_API_KEY: {
        id: "zhipu",
        modelRole: "main",
        model: "glm-5.1",
      },
      GROQ_API_KEY: {
        id: "groq",
        modelRole: "main",
        model: "llama-3.3-70b-versatile",
      },
      MISTRAL_API_KEY: {
        id: "mistral",
        modelRole: "main",
        model: "mistral-large-latest",
      },
    };

    const repos = await getRepos();
    const settings = await repos.settings.getProviderSettings();
    const existingIds = new Set(settings.providers.map((p) => p.id));

    // Per-provider recommended max output tokens
    const RECOMMENDED_MAX_TOKENS: Record<string, number> = {
      openai: 128000,
      anthropic: 128000,
      deepseek: 32000,
      minimax: 131072,
      qwen: 32000,
      moonshot: 66000,
      zhipu: 128000,
      openrouter: 128000,
      groq: 32000,
      mistral: 32000,
    };

    for (const [envKey, config] of Object.entries(envToProvider)) {
      const apiKey = process.env[envKey];
      if (!apiKey) {
        results.push({ provider: config.id, status: "skipped", error: `Env var ${envKey} not set` });
        continue;
      }

      const meta = getProviderMetadata(config.id);
      if (!meta) {
        results.push({ provider: config.id, status: "skipped", error: "Provider not in registry" });
        continue;
      }

      // Create main provider
      const provider: ProviderConfig = {
        id: config.id,
        name: meta.name,
        type: "openai-compatible",
        endpoint: meta.defaultApiBase,
        apiKey,
        model: config.model,
        maxTokens: RECOMMENDED_MAX_TOKENS[config.id] ?? 16384,
        supportsToolUse: true,
        enabled: true,
      };

      if (!existingIds.has(config.id)) {
        settings.providers.push(provider);
      } else {
        const idx = settings.providers.findIndex((p) => p.id === config.id);
        if (idx >= 0) settings.providers[idx] = provider;
      }

      results.push({ provider: config.id, status: "configured" });

      // Create extra models (e.g. embedding, TTS, etc.)
      if (config.extraModels) {
        for (const extra of config.extraModels) {
          const extraProvider: ProviderConfig = {
            id: extra.id,
            name: `${meta.name} (${extra.model})`,
            type: "openai-compatible",
            endpoint: meta.defaultApiBase,
            apiKey,
            model: extra.model,
            maxTokens: 8192,
            supportsToolUse: false,
            enabled: true,
          };

          if (!existingIds.has(extra.id)) {
            settings.providers.push(extraProvider);
          } else {
            const idx = settings.providers.findIndex((p) => p.id === extra.id);
            if (idx >= 0) settings.providers[idx] = extraProvider;
          }

          results.push({ provider: extra.id, status: "configured" });
        }
      }

      // Set as default for its primary role if not already set
      const roleKey = config.modelRole as keyof typeof settings.defaults;
      if (!settings.defaults[roleKey]) {
        (settings.defaults as unknown as Record<string, string>)[roleKey] = config.id;
      }
    }

    // Save updated settings
    await repos.settings.saveProviderSettings(settings);
    bumpConfigVersion();

    return c.json({
      success: true,
      configured: results.filter((r) => r.status === "configured").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
    });
  });

  // -----------------------------------------------------------------------
  // Docling document processing configuration
  // -----------------------------------------------------------------------

  /** Get current Docling config */
  router.get("/docling-config", async (c) => {
    const repos = await getRepos();
    const raw = await repos.settings.get("docling_config");
    if (!raw) return c.json({ ...DEFAULT_DOCLING_CONFIG });
    try {
      const parsed = JSON.parse(raw) as Partial<DoclingConfig>;
      return c.json({ ...DEFAULT_DOCLING_CONFIG, ...parsed });
    } catch {
      return c.json({ ...DEFAULT_DOCLING_CONFIG });
    }
  });

  /** Update Docling config */
  router.put("/docling-config", async (c) => {
    const body = await c.req.json<Partial<DoclingConfig>>();
    const repos = await getRepos();

    // Get current config
    const raw = await repos.settings.get("docling_config");
    let current = { ...DEFAULT_DOCLING_CONFIG };
    if (raw) {
      try { current = { ...DEFAULT_DOCLING_CONFIG, ...JSON.parse(raw) }; } catch {}
    }
    const merged = { ...current, ...body };
    await repos.settings.set("docling_config", JSON.stringify(merged));

    return c.json({ success: true, config: merged });
  });

  /** Scan data/models/docling/ directory for available models */
  router.get("/docling-models", (c) => {
    const dataDir = process.env.DATA_DIR ?? "data";
    const doclingDir = path.resolve(dataDir, "models", "docling");

    const categories = ["layout", "table", "vlm", "ocr"] as const;
    const result: Record<string, Array<{ id: string; name: string; path: string }>> = {};

    for (const cat of categories) {
      result[cat] = [];
      const catDir = path.join(doclingDir, cat);
      try {
        const entries = fs.readdirSync(catDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() || entry.isSymbolicLink()) {
            const fullPath = path.join(catDir, entry.name);
            // Convert directory name back to repo_id format (first -- to /)
            const repoId = entry.name.replace("--", "/");
            result[cat].push({
              id: repoId,
              name: entry.name,
              path: fullPath,
            });
          }
        }
      } catch {
        // Directory doesn't exist, return empty
      }
    }

    return c.json(result);
  });

  return router;
}
