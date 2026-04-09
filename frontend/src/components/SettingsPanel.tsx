import { useState, useEffect, useCallback } from "react";
import {
  api,
  type ProviderConfig,
  type ProviderDefaults,
  type ProviderTestResult,
} from "../api/client";

// ---------------------------------------------------------------------------
// Provider type options
// ---------------------------------------------------------------------------

const PROVIDER_TYPES = [
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "ollama", label: "Ollama (Local)" },
  { value: "anthropic", label: "Anthropic (Claude)" },
] as const;

const PROVIDER_PRESETS: Record<string, Partial<ProviderConfig>> = {
  "openai-compatible": {
    endpoint: "https://api.openai.com/v1",
    maxTokens: 32768,
    supportsToolUse: true,
  },
  ollama: {
    endpoint: "http://localhost:11434/v1",
    maxTokens: 32768,
    supportsToolUse: true,
  },
  anthropic: {
    endpoint: "https://api.anthropic.com/v1",
    maxTokens: 32768,
    supportsToolUse: true,
  },
};

function generateId(): string {
  return `provider-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Empty provider template
// ---------------------------------------------------------------------------

function emptyProvider(type: ProviderConfig["type"]): ProviderConfig {
  const preset = PROVIDER_PRESETS[type] ?? {};
  return {
    id: generateId(),
    name: "",
    type,
    endpoint: preset.endpoint ?? "",
    apiKey: "",
    model: "",
    maxTokens: preset.maxTokens ?? 32768,
    supportsToolUse: preset.supportsToolUse ?? true,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// SettingsPanel component
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [defaults, setDefaults] = useState<ProviderDefaults>({
    main: "",
    summarizer: "",
    embedding: "",
    vlm: "",
  });
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load providers on mount
  const loadProviders = useCallback(async () => {
    try {
      const settings = await api.getProviders();
      setProviders(settings.providers);
      setDefaults(settings.defaults);
    } catch (err) {
      setError("Failed to load provider settings");
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // Clear messages after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const t = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(t);
    }
  }, [successMessage]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleAddProvider = () => {
    setEditingProvider(emptyProvider("openai-compatible"));
    setIsNew(true);
    setTestResult(null);
    setError(null);
  };

  const handleEditProvider = (provider: ProviderConfig) => {
    setEditingProvider({ ...provider });
    setIsNew(false);
    setTestResult(null);
    setError(null);
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      await api.deleteProvider(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
      setSuccessMessage("Provider deleted");
      if (editingProvider?.id === id) {
        setEditingProvider(null);
      }
    } catch (err) {
      setError("Failed to delete provider");
    }
  };

  const handleSaveProvider = async () => {
    if (!editingProvider) return;
    if (!editingProvider.name || !editingProvider.endpoint || !editingProvider.model) {
      setError("Name, endpoint, and model are required");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await api.saveProvider(editingProvider);
      setSuccessMessage(isNew ? "Provider created" : "Provider updated");
      setEditingProvider(null);
      setIsNew(false);
      await loadProviders();
    } catch (err) {
      setError("Failed to save provider");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestProvider = async () => {
    if (!editingProvider) return;
    setIsTesting(true);
    setTestResult(null);
    setError(null);
    try {
      // Save first if it's new, so we can test it
      if (isNew) {
        await api.saveProvider(editingProvider);
        setIsNew(false);
        await loadProviders();
      }
      const result = await api.testProvider(editingProvider.id);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : "Connection failed",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleUpdateDefaults = async (role: keyof ProviderDefaults, value: string) => {
    const newDefaults = { ...defaults, [role]: value };
    setDefaults(newDefaults);
    try {
      await api.saveDefaults({ [role]: value });
      setSuccessMessage("Default model updated");
    } catch {
      setError("Failed to update defaults");
    }
  };

  const handleFieldChange = (
    field: keyof ProviderConfig,
    value: string | number | boolean,
  ) => {
    if (!editingProvider) return;

    let updated = { ...editingProvider, [field]: value };

    // When type changes, apply preset defaults
    if (field === "type" && typeof value === "string") {
      const preset = PROVIDER_PRESETS[value] ?? {};
      updated = {
        ...updated,
        endpoint: preset.endpoint ?? updated.endpoint,
        maxTokens: preset.maxTokens ?? updated.maxTokens,
        supportsToolUse: preset.supportsToolUse ?? updated.supportsToolUse,
      };
    }

    setEditingProvider(updated);
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              Model Provider Settings
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Configure the AI model backends for DeepAnalyze. Supports remote APIs (OpenAI, Claude) and local models (Ollama, vLLM).
            </p>
          </div>
          <button
            onClick={handleAddProvider}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            + Add Provider
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
            <button
              onClick={() => setError(null)}
              className="float-right font-bold cursor-pointer"
            >
              x
            </button>
          </div>
        )}
        {successMessage && (
          <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            {successMessage}
          </div>
        )}

        {/* Provider list */}
        <div className="space-y-3">
          {providers.length === 0 && !editingProvider && (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-400">No providers configured.</p>
              <p className="text-gray-400 text-sm mt-1">
                Click "Add Provider" to configure your first model backend.
              </p>
            </div>
          )}

          {providers.map((provider) => (
            <div
              key={provider.id}
              className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${provider.enabled ? "bg-green-500" : "bg-gray-300"}`}
                />
                <div>
                  <p className="font-medium text-gray-800">
                    {provider.name || provider.id}
                  </p>
                  <p className="text-xs text-gray-500">
                    {PROVIDER_TYPES.find((t) => t.value === provider.type)?.label ?? provider.type}
                    {" | "}
                    {provider.model}
                    {" | "}
                    {provider.endpoint.replace(/https?:\/\//, "").split("/")[0]}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEditProvider(provider)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors cursor-pointer"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteProvider(provider.id)}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 rounded-md transition-colors cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Edit form */}
        {editingProvider && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold text-gray-800">
              {isNew ? "New Provider" : `Edit: ${editingProvider.name}`}
            </h3>

            <div className="grid grid-cols-2 gap-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={editingProvider.name}
                  onChange={(e) => handleFieldChange("name", e.target.value)}
                  placeholder="My OpenAI Provider"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Provider Type
                </label>
                <select
                  value={editingProvider.type}
                  onChange={(e) => handleFieldChange("type", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {PROVIDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Endpoint */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  API Endpoint *
                </label>
                <input
                  type="text"
                  value={editingProvider.endpoint}
                  onChange={(e) => handleFieldChange("endpoint", e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={editingProvider.apiKey}
                  onChange={(e) => handleFieldChange("apiKey", e.target.value)}
                  placeholder="sk-... (leave empty for local models)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Model Name *
                </label>
                <input
                  type="text"
                  value={editingProvider.model}
                  onChange={(e) => handleFieldChange("model", e.target.value)}
                  placeholder="gpt-4o / qwen2.5-14b / claude-3.5-sonnet"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Max Tokens */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={editingProvider.maxTokens}
                  onChange={(e) =>
                    handleFieldChange("maxTokens", parseInt(e.target.value) || 32768)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Tool Use */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingProvider.supportsToolUse}
                  onChange={(e) =>
                    handleFieldChange("supportsToolUse", e.target.checked)
                  }
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label className="text-sm text-gray-700">
                  Supports Tool/Function Calling
                </label>
              </div>

              {/* Enabled */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingProvider.enabled}
                  onChange={(e) => handleFieldChange("enabled", e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label className="text-sm text-gray-700">Enabled</label>
              </div>
            </div>

            {/* Test result */}
            {testResult && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  testResult.success
                    ? "bg-green-50 border border-green-200 text-green-700"
                    : "bg-red-50 border border-red-200 text-red-700"
                }`}
              >
                {testResult.success ? (
                  <span>
                    Connection successful! Available models:
                    {testResult.models && testResult.models.length > 0
                      ? ` ${testResult.models.slice(0, 10).join(", ")}${testResult.models.length > 10 ? "..." : ""}`
                      : " (none listed)"}
                  </span>
                ) : (
                  <span>Connection failed: {testResult.error}</span>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveProvider}
                disabled={isSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
              >
                {isSaving ? "Saving..." : isNew ? "Create" : "Save Changes"}
              </button>
              <button
                onClick={handleTestProvider}
                disabled={isTesting}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors cursor-pointer"
              >
                {isTesting ? "Testing..." : "Test Connection"}
              </button>
              <button
                onClick={() => {
                  setEditingProvider(null);
                  setTestResult(null);
                }}
                className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Default role assignments */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Default Model Roles</h3>
          <p className="text-sm text-gray-500 mb-4">
            Assign providers to specific roles. The &quot;main&quot; role is used for general chat and analysis tasks.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {(["main", "summarizer", "embedding", "vlm"] as const).map((role) => (
              <div key={role}>
                <label className="block text-xs font-medium text-gray-600 mb-1 capitalize">
                  {role === "vlm" ? "Vision-Language" : role}
                </label>
                <select
                  value={defaults[role]}
                  onChange={(e) => handleUpdateDefaults(role, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- None --</option>
                  {providers
                    .filter((p) => p.enabled)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id} ({p.model})
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Preset buttons for quick setup */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Quick Setup</h3>
          <p className="text-sm text-gray-500 mb-4">
            Click a preset to quickly add a common provider configuration.
          </p>
          <div className="flex flex-wrap gap-3">
            {[
              {
                label: "OpenAI GPT-4o",
                config: {
                  ...emptyProvider("openai-compatible"),
                  name: "OpenAI GPT-4o",
                  endpoint: "https://api.openai.com/v1",
                  model: "gpt-4o",
                },
              },
              {
                label: "DeepSeek Chat",
                config: {
                  ...emptyProvider("openai-compatible"),
                  name: "DeepSeek Chat",
                  endpoint: "https://api.deepseek.com/v1",
                  model: "deepseek-chat",
                },
              },
              {
                label: "Ollama Local",
                config: {
                  ...emptyProvider("ollama"),
                  name: "Ollama Local",
                  endpoint: "http://localhost:11434/v1",
                  model: "qwen2.5:14b",
                },
              },
              {
                label: "Claude (via OpenAI proxy)",
                config: {
                  ...emptyProvider("openai-compatible"),
                  name: "Claude 3.5 Sonnet",
                  endpoint: "https://api.anthropic.com/v1",
                  model: "claude-3-5-sonnet-20241022",
                },
              },
            ].map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  setEditingProvider(preset.config);
                  setIsNew(true);
                  setTestResult(null);
                  setError(null);
                }}
                className="px-4 py-2 border border-gray-300 hover:border-blue-400 hover:bg-blue-50 text-sm font-medium text-gray-700 rounded-lg transition-colors cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
