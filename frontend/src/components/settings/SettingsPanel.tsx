// =============================================================================
// DeepAnalyze - SettingsPanel Component
// Provider configuration with registry-based selection
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import type { ProviderConfig, ProviderDefaults, ProviderSettings, ProviderMetadata } from "../../types/index";
import { useToast } from "../../hooks/useToast";

export function SettingsPanel() {
  const { success, error } = useToast();
  const [registry, setRegistry] = useState<ProviderMetadata[]>([]);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [modelName, setModelName] = useState("");
  const [maxTokens, setMaxTokens] = useState(32768);
  const [enabled, setEnabled] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [regData, settingsData] = await Promise.all([
        fetch("/api/settings/registry").then((r) => r.json()) as Promise<ProviderMetadata[]>,
        api.getProviders(),
      ]);
      setRegistry(regData);
      setSettings(settingsData);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-fill form on provider change
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

  // Initialize with current default
  useEffect(() => {
    if (settings && !selectedProvider) {
      if (settings.defaults.main) {
        setSelectedProvider(settings.defaults.main);
      } else if (settings.providers.length > 0) {
        setSelectedProvider(settings.providers[0].id);
      }
    }
  }, [settings, selectedProvider]);

  const currentMeta = registry.find((p) => p.id === selectedProvider);
  const isLocal = currentMeta?.isLocal ?? false;

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
      success("配置已保存");
      await loadData();
    } catch {
      error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!selectedProvider) return;
    setTesting(true);
    setTestResult(null);
    try {
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
      setTestResult({ success: false, message: err instanceof Error ? err.message : "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  const handleSetDefault = async (role: string) => {
    try {
      await api.saveDefaults({ [role]: selectedProvider });
      success("默认模型已更新");
      await loadData();
    } catch {
      error("更新默认模型失败");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProvider(id);
      success("提供商已删除");
      if (selectedProvider === id) setSelectedProvider("");
      await loadData();
    } catch {
      error("删除失败");
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-da-text">模型配置</h2>
          <p className="text-sm text-da-text-secondary mt-1">
            选择并配置 AI 模型提供商。支持远端 API 和本地模型。
          </p>
          {settings?.defaults.main && (
            <div className="mt-3 px-3 py-2 bg-da-accent/10 border border-da-accent/20 rounded-lg text-sm">
              <span className="text-da-text-muted">当前使用:</span>{" "}
              <span className="font-medium text-da-accent-hover">
                {settings.providers.find((p) => p.id === settings!.defaults.main)?.name ?? settings.defaults.main}
                {" / "}
                {settings.providers.find((p) => p.id === settings!.defaults.main)?.model ?? ""}
              </span>
            </div>
          )}
        </div>

        {/* Provider Selection */}
        <div>
          <label className="block text-sm font-medium text-da-text-secondary mb-1">选择提供商</label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="w-full px-3 py-2.5 border border-da-border rounded-lg text-sm bg-da-surface text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent/30 focus:border-da-accent"
          >
            <option value="">-- 选择一个提供商 --</option>
            <optgroup label="远端 API">
              {registry.filter((p) => !p.isLocal).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
            <optgroup label="本地模型">
              {registry.filter((p) => p.isLocal).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Configuration Form */}
        {selectedProvider ? (
          <div className="space-y-4 bg-da-surface border border-da-border rounded-xl p-5">
            {/* Model Name */}
            <div>
              <label className="block text-sm font-medium text-da-text-secondary mb-1">模型名称</label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={currentMeta?.defaultModel || "模型 ID"}
                className="w-full px-3 py-2 border border-da-border rounded-lg text-sm bg-da-bg text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent/30"
              />
              <p className="text-xs text-da-text-muted mt-1">填写模型 ID，如 gpt-4o, deepseek-chat, qwen-plus 等</p>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium text-da-text-secondary mb-1">
                API Key {isLocal && <span className="text-da-text-muted">(可选)</span>}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isLocal ? "本地模型无需 API Key" : "sk-..."}
                className="w-full px-3 py-2 border border-da-border rounded-lg text-sm bg-da-bg text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent/30"
              />
            </div>

            {/* API Base URL */}
            <div>
              <label className="block text-sm font-medium text-da-text-secondary mb-1">
                API 地址 {currentMeta?.defaultApiBase && <span className="text-da-text-muted">(可选)</span>}
              </label>
              <input
                type="text"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                placeholder={currentMeta?.defaultApiBase || "https://..."}
                className="w-full px-3 py-2 border border-da-border rounded-lg text-sm bg-da-bg text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent/30"
              />
              {currentMeta?.defaultApiBase && (
                <p className="text-xs text-da-text-muted mt-1">默认: {currentMeta.defaultApiBase}</p>
              )}
            </div>

            {/* Max Tokens */}
            <div>
              <label className="block text-sm font-medium text-da-text-secondary mb-1">最大 Token 数</label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 32768)}
                className="w-full px-3 py-2 border border-da-border rounded-lg text-sm bg-da-bg text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent/30"
              />
            </div>

            {/* Enabled */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-da-border bg-da-bg text-da-accent focus:ring-da-accent"
              />
              <span className="text-sm text-da-text-secondary">启用此提供商</span>
            </label>

            {/* Test Result */}
            {testResult && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm ${
                testResult.success
                  ? "bg-green-500/10 border border-green-500/20 text-green-400"
                  : "bg-red-500/10 border border-red-500/20 text-red-400"
              }`}>
                <span>{testResult.success ? "✓" : "✗"}</span>
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-da-accent hover:bg-da-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
              >
                {saving ? "保存中..." : "保存配置"}
              </button>
              <button
                onClick={handleTest}
                disabled={testing || (!isLocal && !apiKey)}
                className="px-4 py-2 bg-da-bg-hover hover:bg-da-surface-hover text-da-text-secondary text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {testing ? "测试中..." : "测试连接"}
              </button>
              <button
                onClick={() => handleSetDefault("main")}
                className="px-4 py-2 bg-da-green/10 hover:bg-da-green/20 text-da-green text-sm font-medium rounded-lg transition-colors cursor-pointer"
              >
                设为默认
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 bg-da-surface rounded-xl border border-da-border">
            <p className="text-da-text-muted">请选择一个提供商进行配置</p>
          </div>
        )}

        {/* Configured Providers */}
        {settings && settings.providers.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-da-text-secondary mb-3">已配置的提供商</h3>
            <div className="space-y-2">
              {settings.providers.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  className={`flex items-center justify-between px-4 py-3 bg-da-surface border rounded-lg cursor-pointer transition-colors ${
                    p.id === selectedProvider ? "border-da-accent/40 bg-da-accent/5" : "border-da-border hover:border-da-border-hover"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${p.enabled ? "bg-da-green" : "bg-da-text-muted"}`} />
                    <div>
                      <p className="text-sm font-medium text-da-text">
                        {p.name}
                        {settings.defaults.main === p.id && (
                          <span className="ml-2 text-xs text-da-accent font-normal">(默认)</span>
                        )}
                      </p>
                      <p className="text-xs text-da-text-muted">
                        {p.model} | {p.endpoint.replace(/https?:\/\//, "").split("/")[0]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSetDefault("main"); }}
                      className="px-2 py-1 text-xs text-da-text-muted hover:text-da-accent cursor-pointer"
                    >
                      设为默认
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                      className="px-2 py-1 text-xs text-da-text-muted hover:text-da-red cursor-pointer"
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
}
