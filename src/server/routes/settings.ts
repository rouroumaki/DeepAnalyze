// =============================================================================
// DeepAnalyze - Settings & Provider API Routes
// =============================================================================
// REST API for managing model provider configurations and system settings.
// =============================================================================

import { Hono } from "hono";
import { SettingsStore, type ProviderConfig, type ProviderDefaults } from "../../store/settings.js";
import { getAllProviders, getProviderMetadata, type ProviderMetadata } from "../../models/provider-registry.js";

export function createSettingsRoutes(): Hono {
  const router = new Hono();
  const store = new SettingsStore();

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
  router.get("/providers", (c) => {
    const settings = store.getProviderSettings();
    return c.json(settings);
  });

  /** Get a single provider */
  router.get("/providers/:id", (c) => {
    const provider = store.getProvider(c.req.param("id"));
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

    store.upsertProvider(body);
    return c.json({ success: true, provider: body });
  });

  /** Delete a provider */
  router.delete("/providers/:id", (c) => {
    const deleted = store.deleteProvider(c.req.param("id"));
    if (!deleted) {
      return c.json({ error: "Provider not found" }, 404);
    }
    return c.json({ success: true });
  });

  // -----------------------------------------------------------------------
  // Default role assignments
  // -----------------------------------------------------------------------

  /** Get current defaults */
  router.get("/defaults", (c) => {
    const settings = store.getProviderSettings();
    return c.json(settings.defaults);
  });

  /** Update default role assignments */
  router.put("/defaults", async (c) => {
    const body = await c.req.json<Partial<ProviderDefaults>>();
    store.updateDefaults(body);
    const settings = store.getProviderSettings();
    return c.json({ success: true, defaults: settings.defaults });
  });

  // -----------------------------------------------------------------------
  // Test provider connectivity
  // -----------------------------------------------------------------------

  /** Test if a provider endpoint is reachable */
  router.post("/providers/:id/test", async (c) => {
    const provider = store.getProvider(c.req.param("id"));
    if (!provider) {
      return c.json({ error: "Provider not found" }, 404);
    }

    try {
      const url = provider.endpoint.replace(/\/+$/, "") + "/models";
      const headers: Record<string, string> = {};
      if (provider.apiKey) {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        return c.json({
          success: true,
          status: resp.status,
          models: data.data?.map?.((m: { id: string }) => m.id) ?? [],
        });
      }
      return c.json({
        success: false,
        status: resp.status,
        error: `HTTP ${resp.status}`,
      });
    } catch (err) {
      return c.json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Generic settings
  // -----------------------------------------------------------------------

  /** Get a setting value */
  router.get("/key/:key", (c) => {
    const value = store.get(c.req.param("key"));
    if (value === null) {
      return c.json({ error: "Setting not found" }, 404);
    }
    return c.json({ key: c.req.param("key"), value });
  });

  /** Set a setting value */
  router.put("/key/:key", async (c) => {
    const { value } = await c.req.json<{ value: string }>();
    store.set(c.req.param("key"), value);
    return c.json({ success: true });
  });

  return router;
}
