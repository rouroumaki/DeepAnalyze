import { useState, useEffect, useCallback } from "react";
import {
  api,
  type ProviderConfig,
  type ProviderDefaults,
  type ProviderTestResult,
  type ProviderSettings,
} from "../api/client";

// ---------------------------------------------------------------------------
// Provider metadata from registry
// ---------------------------------------------------------------------------

interface ProviderMetadata {
  id: string;
  name: string;
  defaultApiBase: string;
  defaultModel: string;
  isLocal: boolean;
}

// ---------------------------------------------------------------------------
// SettingsPanel - modelled after AIE_new's ProviderConfig.vue
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const [registry, setRegistry] = useState<ProviderMetadata[]>([]);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [modelName, setModelName] = useState("");
  const [maxTokens, setMaxTokens] = useState(32768);
  const [enabled, setEnabled] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Load registry + settings
  const loadData = useCallback(async () => {
    try {
      // Load provider registry
      const registryResp = await fetch("/api/settings/registry");
      if (registryResp.ok) {
        const regData = await registryResp.json();
        setRegistry(regData);
      }

      // Load configured providers
      const settingsData = await api.getProviders();
      setSettings(settingsData);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-dismiss messages
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(t);
    }
  }, [message]);

  // Get current provider metadata
  const currentMeta = registry.find((p) => p.id === selectedProvider);
  const isLocal = currentMeta?.isLocal ?? false;

  // Get current configured provider from settings
  const currentConfigured = settings?.providers.find((p) => p.id === selectedProvider);

  // When provider selection changes, populate form
  useEffect(() => {
    if (!selectedProvider) return;

    const meta = registry.find((p) => p.id === selectedProvider);
    const configured = settings?.providers.find((p) => p.id === selectedProvider);

    if (configured) {
      setApiKey(configured.apiKey);
      setApiBase(configured.endpoint);
      setModelName(configured.model);
      setMaxTokens(configured.maxTokens);
      setEnabled(configured.enabled);
    } else {
      setApiKey("");
      setApiBase(meta?.defaultApiBase ?? "");
      setModelName(meta?.defaultModel ?? "");
      setMaxTokens(32768);
      setEnabled(true);
    }
    setTestResult(null);
  }, [selectedProvider, registry, settings]);

  // Initialize with currently configured provider
  useEffect(() => {
    if (settings && settings.defaults.main && !selectedProvider) {
      setSelectedProvider(settings.defaults.main);
    } else if (settings && settings.providers.length > 0 && !selectedProvider) {
      setSelectedProvider(settings.providers[0].id);
    }
  }, [settings, selectedProvider]);

  // Save provider configuration
  const handleSave = async () => {
    if (!selectedProvider) return;

    setSaving(true);
    try {
      const provider: ProviderConfig = {
        id: selectedProvider,
        name: currentMeta?.name ?? selectedProvider,
        type: "openai-compatible",
        endpoint: apiBase,
        apiKey,
        model: modelName,
        maxTokens,
        supportsToolUse: true,
        enabled,
      };

      await api.saveProvider(provider);
      setMessage({ type: "ok", text: "配置已保存" });
      await loadData();
    } catch {
      setMessage({ type: "err", text: "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  // Test connection
  const handleTest = async () => {
    if (!selectedProvider) return;

    setTesting(true);
    setTestResult(null);
    try {
      // Save first so the provider exists in DB
      await handleSave();
      const result = await api.testProvider(selectedProvider);
      setTestResult({
        success: result.success,
        message: result.success
          ? result.models && result.models.length > 0
            ? `连接成功! 可用模型: ${result.models.slice(0, 5).join(", ")}`
            : "连接成功!"
          : result.error ?? "连接失败",
      });
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "连接失败",
      });
    } finally {
      setTesting(false);
    }
  };

  // Update default role
  const handleSetDefault = async (role: string) => {
    try {
      await api.saveDefaults({ [role]: selectedProvider });
      setMessage({ type: "ok", text: "默认模型已更新" });
      await loadData();
    } catch {
      setMessage({ type: "err", text: "更新默认模型失败" });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800">
            模型配置
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            选择并配置 AI 模型提供商。支持远端 API (OpenAI, Claude, DeepSeek 等) 和本地模型 (Ollama, vLLM)。
          </p>
          {settings && settings.defaults.main && (
            <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <span className="text-gray-500">当前使用:</span>{" "}
              <span className="font-medium text-blue-700">
                {settings.providers.find((p) => p.id === settings!.defaults.main)?.name ?? settings.defaults.main}
                {" / "}
                {settings.providers.find((p) => p.id === settings!.defaults.main)?.model ?? ""}
              </span>
            </div>
          )}
        </div>

        {/* Messages */}
        {message && (
          <div
            className={`px-4 py-3 rounded-lg text-sm ${
              message.type === "ok"
                ? "bg-green-50 border border-green-200 text-green-700"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Provider selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            选择提供商
          </label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">-- 选择一个提供商 --</option>
            <optgroup label="远端 API">
              {registry
                .filter((p) => !p.isLocal)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="本地模型">
              {registry
                .filter((p) => p.isLocal)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </div>

        {/* Provider config form */}
        {selectedProvider ? (
          <div className="space-y-4 bg-gray-50 border border-gray-200 rounded-xl p-5">
            {/* Model name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                模型名称
              </label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={currentMeta?.defaultModel || "模型 ID"}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">
                填写模型 ID，如 gpt-4o, deepseek-chat, qwen-plus 等
              </p>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key{" "}
                {isLocal && (
                  <span className="font-normal text-gray-400">(可选)</span>
                )}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  isLocal
                    ? "本地模型无需 API Key"
                    : "sk-..."
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* API Base URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API 地址{" "}
                {currentMeta?.defaultApiBase && (
                  <span className="font-normal text-gray-400">(可选，默认已填)</span>
                )}
              </label>
              <input
                type="text"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                placeholder={currentMeta?.defaultApiBase || "https://..."}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {currentMeta?.defaultApiBase && (
                <p className="text-xs text-gray-400 mt-1">
                  默认: {currentMeta.defaultApiBase}
                </p>
              )}
            </div>

            {/* Max tokens */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                最大 Token 数
              </label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 32768)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Enabled toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">启用此提供商</span>
            </label>

            {/* Test result */}
            {testResult && (
              <div
                className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm ${
                  testResult.success
                    ? "bg-green-50 border border-green-200 text-green-700"
                    : "bg-red-50 border border-red-200 text-red-700"
                }`}
              >
                <span className="text-base">{testResult.success ? "✓" : "✗"}</span>
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
              >
                {saving ? "保存中..." : "保存配置"}
              </button>
              <button
                onClick={handleTest}
                disabled={testing || (!isLocal && !apiKey)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 text-gray-700 text-sm font-medium rounded-lg transition-colors cursor-pointer"
              >
                {testing ? "测试中..." : "测试连接"}
              </button>
              <button
                onClick={() => handleSetDefault("main")}
                className="px-4 py-2 bg-green-50 hover:bg-green-100 text-green-700 text-sm font-medium rounded-lg transition-colors cursor-pointer"
              >
                设为默认
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-400">请选择一个提供商进行配置</p>
          </div>
        )}

        {/* Configured providers list */}
        {settings && settings.providers.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              已配置的提供商
            </h3>
            <div className="space-y-2">
              {settings.providers.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-4 py-3 bg-white border rounded-lg cursor-pointer transition-colors ${
                    p.id === selectedProvider
                      ? "border-blue-400 bg-blue-50/30"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => setSelectedProvider(p.id)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        p.enabled ? "bg-green-500" : "bg-gray-300"
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {p.name}
                        {settings.defaults.main === p.id && (
                          <span className="ml-2 text-xs text-blue-600 font-normal">
                            (默认)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">
                        {p.model} | {p.endpoint.replace(/https?:\/\//, "").split("/")[0]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetDefaultFor(p.id);
                      }}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-blue-600 cursor-pointer"
                    >
                      设为默认
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p.id);
                      }}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-red-600 cursor-pointer"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  async function handleSetDefaultFor(id: string) {
    try {
      await api.saveDefaults({ main: id });
      setMessage({ type: "ok", text: "默认模型已更新" });
      await loadData();
    } catch {
      setMessage({ type: "err", text: "更新失败" });
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteProvider(id);
      setMessage({ type: "ok", text: "提供商已删除" });
      if (selectedProvider === id) {
        setSelectedProvider("");
      }
      await loadData();
    } catch {
      setMessage({ type: "err", text: "删除失败" });
    }
  }
}
