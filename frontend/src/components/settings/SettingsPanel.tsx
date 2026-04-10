// =============================================================================
// DeepAnalyze - SettingsPanel Component
// Provider configuration with registry-based selection
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import type { ProviderConfig, ProviderSettings, ProviderMetadata, ProviderDefaults } from "../../types/index";
import { useToast } from "../../hooks/useToast";
import { useUIStore, type ThemeMode } from "../../store/ui";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Star,
  Save,
  Wifi,
  ShieldCheck,
  Server,
  Globe,
  Info,
  Cpu,
} from "lucide-react";

export function SettingsPanel() {
  const { success, error: showError } = useToast();
  const themeMode = useUIStore((s) => s.themeMode);
  const setThemeMode = useUIStore((s) => s.setThemeMode);

  const [activeTab, setActiveTab] = useState<"models" | "embedding" | "general" | "about">("models");
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

  // Embedding tab state
  const [embeddingDefaults, setEmbeddingDefaults] = useState<ProviderDefaults | null>(null);
  const [embeddingProvider, setEmbeddingProvider] = useState("");
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [embeddingTesting, setEmbeddingTesting] = useState(false);

  // About tab state
  const [healthInfo, setHealthInfo] = useState<{ status: string; version: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [regData, settingsData] = await Promise.all([
        api.getProviderRegistry(),
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

  // Load embedding defaults when tab is active
  useEffect(() => {
    if (activeTab !== "embedding") return;
    api.getDefaults().then((defaults) => {
      setEmbeddingDefaults(defaults);
      setEmbeddingProvider(defaults.embedding ?? "");
    }).catch(() => {});
  }, [activeTab]);

  // Load health info when about tab is active
  useEffect(() => {
    if (activeTab !== "about") return;
    api.health().then((info) => {
      setHealthInfo(info);
    }).catch(() => {
      setHealthInfo(null);
    });
  }, [activeTab]);

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
      showError("保存失败");
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
      showError("更新默认模型失败");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProvider(id);
      success("提供商已删除");
      if (selectedProvider === id) setSelectedProvider("");
      await loadData();
    } catch {
      showError("删除失败");
    }
  };

  const handleEmbeddingSave = async () => {
    try {
      await api.saveDefaults({ embedding: embeddingProvider });
      success("嵌入模型已更新");
      const defaults = await api.getDefaults();
      setEmbeddingDefaults(defaults);
    } catch {
      showError("更新嵌入模型失败");
    }
  };

  const handleEmbeddingTest = async () => {
    if (!embeddingProvider) return;
    setEmbeddingTesting(true);
    setEmbeddingTestResult(null);
    try {
      await handleEmbeddingSave();
      const result = await api.testProvider(embeddingProvider);
      setEmbeddingTestResult({
        success: result.success,
        message: result.success ? "嵌入模型连接成功!" : (result.error ?? "连接失败"),
      });
    } catch (err) {
      setEmbeddingTestResult({ success: false, message: err instanceof Error ? err.message : "连接失败" });
    } finally {
      setEmbeddingTesting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-primary)",
    borderRadius: "var(--radius-lg)",
    fontSize: "var(--text-sm)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color var(--transition-fast)",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "var(--text-sm)",
    fontWeight: "var(--font-medium)",
    color: "var(--text-secondary)",
    marginBottom: "var(--space-1)",
  };

  const tabs = [
    { id: "models", label: "模型配置", icon: <Server size={14} /> },
    { id: "embedding", label: "嵌入模型", icon: <Cpu size={14} /> },
    { id: "general", label: "通用设置", icon: <Globe size={14} /> },
    { id: "about", label: "关于", icon: <Info size={14} /> },
  ];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 768, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {/* Header */}
        <div>
          <h2 style={{
            fontSize: "var(--text-lg)",
            fontWeight: "var(--font-semibold)",
            color: "var(--text-primary)",
            margin: 0,
          }}>
            设置
          </h2>
          <p style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            marginTop: "var(--space-1)",
            margin: 0,
          }}>
            管理模型配置、嵌入模型和通用设置。
          </p>
        </div>

        {/* Sub-tab bar */}
        <div style={{
          display: "flex",
          gap: "var(--space-1)",
          borderBottom: "1px solid var(--border-primary)",
          paddingBottom: "var(--space-1)",
        }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding: "var(--space-2) var(--space-3)",
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid var(--interactive)" : "2px solid transparent",
                borderRadius: "var(--radius-md) var(--radius-md) 0 0",
                background: activeTab === tab.id ? "var(--interactive-light)" : "transparent",
                color: activeTab === tab.id ? "var(--interactive)" : "var(--text-secondary)",
                fontSize: "var(--text-sm)",
                fontWeight: activeTab === tab.id ? 500 : 400,
                cursor: "pointer",
                transition: "all var(--transition-fast)",
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Models Tab */}
        {activeTab === "models" && (
          <>
            {settings?.defaults.main && (
              <div style={{
                padding: "var(--space-2) var(--space-3)",
                background: "var(--interactive-light)",
                border: "1px solid var(--interactive-light)",
                borderRadius: "var(--radius-lg)",
                fontSize: "var(--text-sm)",
              }}>
                <span style={{ color: "var(--text-tertiary)" }}>当前使用:</span>{" "}
                <span style={{
                  fontWeight: "var(--font-medium)",
                  color: "var(--interactive)",
                }}>
                  {settings.providers.find((p) => p.id === settings!.defaults.main)?.name ?? settings.defaults.main}
                  {" / "}
                  {settings.providers.find((p) => p.id === settings!.defaults.main)?.model ?? ""}
                </span>
              </div>
            )}

            {/* Provider Selection */}
            <div>
              <label style={labelStyle}>选择提供商</label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                style={{
                  ...inputStyle,
                  padding: "10px var(--space-3)",
                  cursor: "pointer",
                }}
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
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-xl)",
                padding: "var(--space-5)",
              }}>
                {/* Model Name */}
                <div>
                  <label style={labelStyle}>模型名称</label>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder={currentMeta?.defaultModel || "模型 ID"}
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
                  />
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: "var(--space-1)", margin: 0 }}>
                    填写模型 ID，如 gpt-4o, deepseek-chat, qwen-plus 等
                  </p>
                </div>

                {/* API Key */}
                <div>
                  <label style={labelStyle}>
                    API Key {isLocal && <span style={{ color: "var(--text-tertiary)" }}>(可选)</span>}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={isLocal ? "本地模型无需 API Key" : "sk-..."}
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
                  />
                </div>

                {/* API Base URL */}
                <div>
                  <label style={labelStyle}>
                    API 地址 {currentMeta?.defaultApiBase && <span style={{ color: "var(--text-tertiary)" }}>(可选)</span>}
                  </label>
                  <input
                    type="text"
                    value={apiBase}
                    onChange={(e) => setApiBase(e.target.value)}
                    placeholder={currentMeta?.defaultApiBase || "https://..."}
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
                  />
                  {currentMeta?.defaultApiBase && (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: "var(--space-1)", margin: 0 }}>
                      默认: {currentMeta.defaultApiBase}
                    </p>
                  )}
                </div>

                {/* Max Tokens */}
                <div>
                  <label style={labelStyle}>最大 Token 数</label>
                  <input
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value) || 32768)}
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
                  />
                </div>

                {/* Enabled */}
                <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    style={{ width: 16, height: 16 }}
                  />
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>启用此提供商</span>
                </label>

                {/* Test Result */}
                {testResult && (
                  <div style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--space-2)",
                    padding: "10px var(--space-3)",
                    borderRadius: "var(--radius-lg)",
                    fontSize: "var(--text-sm)",
                    background: testResult.success ? "var(--success-light)" : "var(--error-light)",
                    border: `1px solid ${testResult.success ? "var(--success)" : "var(--error)"}`,
                    color: testResult.success ? "var(--success)" : "var(--error)",
                  }}>
                    {testResult.success
                      ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                      : <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    }
                    <span>{testResult.message}</span>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", paddingTop: "var(--space-1)" }}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "var(--space-2) var(--space-4)",
                      background: "var(--interactive)",
                      color: "#fff",
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--font-medium)",
                      borderRadius: "var(--radius-lg)",
                      border: "none",
                      cursor: "pointer",
                      opacity: saving ? 0.5 : 1,
                      transition: "background var(--transition-fast)",
                    }}
                    onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "var(--interactive-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--interactive)"; }}
                  >
                    <Save size={14} />
                    {saving ? "保存中..." : "保存配置"}
                  </button>
                  <button
                    onClick={handleTest}
                    disabled={testing || (!isLocal && !apiKey)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "var(--space-2) var(--space-4)",
                      background: "var(--bg-hover)",
                      color: "var(--text-secondary)",
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--font-medium)",
                      borderRadius: "var(--radius-lg)",
                      border: "none",
                      cursor: testing || (!isLocal && !apiKey) ? "not-allowed" : "pointer",
                      opacity: testing || (!isLocal && !apiKey) ? 0.5 : 1,
                      transition: "background var(--transition-fast)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  >
                    <Wifi size={14} />
                    {testing ? "测试中..." : "测试连接"}
                  </button>
                  <button
                    onClick={() => handleSetDefault("main")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "var(--space-2) var(--space-4)",
                      background: "var(--success-light)",
                      color: "var(--success)",
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--font-medium)",
                      borderRadius: "var(--radius-lg)",
                      border: "none",
                      cursor: "pointer",
                      transition: "background var(--transition-fast)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                  >
                    <ShieldCheck size={14} />
                    设为默认
                  </button>
                </div>
              </div>
            ) : (
              <div style={{
                textAlign: "center",
                padding: "48px 0",
                background: "var(--bg-secondary)",
                borderRadius: "var(--radius-xl)",
                border: "1px solid var(--border-primary)",
              }}>
                <p style={{ color: "var(--text-tertiary)", margin: 0 }}>请选择一个提供商进行配置</p>
              </div>
            )}

            {/* Configured Providers */}
            {settings && settings.providers.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-semibold)",
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-3)",
                  margin: 0,
                }}>
                  已配置的提供商
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {settings.providers.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProvider(p.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "var(--space-3) var(--space-4)",
                        background: "var(--bg-secondary)",
                        border: "1px solid",
                        borderColor: p.id === selectedProvider ? "var(--interactive-light)" : "var(--border-primary)",
                        borderRadius: "var(--radius-lg)",
                        cursor: "pointer",
                        transition: "border-color var(--transition-fast)",
                      }}
                      onMouseEnter={(e) => {
                        if (p.id !== selectedProvider) {
                          e.currentTarget.style.borderColor = "var(--border-secondary)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (p.id !== selectedProvider) {
                          e.currentTarget.style.borderColor = "var(--border-primary)";
                        }
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                        <div style={{
                          width: 10,
                          height: 10,
                          borderRadius: "var(--radius-full)",
                          background: p.enabled ? "var(--success)" : "var(--text-tertiary)",
                          flexShrink: 0,
                        }} />
                        <div>
                          <p style={{
                            fontSize: "var(--text-sm)",
                            fontWeight: "var(--font-medium)",
                            color: "var(--text-primary)",
                            margin: 0,
                          }}>
                            {p.name}
                            {settings.defaults.main === p.id && (
                              <span style={{
                                marginLeft: "var(--space-2)",
                                fontSize: "var(--text-xs)",
                                color: "var(--interactive)",
                                fontWeight: "normal",
                              }}>
                                (默认)
                              </span>
                            )}
                          </p>
                          <p style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--text-tertiary)",
                            margin: 0,
                            marginTop: 2,
                          }}>
                            {p.model} | {p.endpoint.replace(/https?:\/\//, "").split("/")[0]}
                          </p>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSetDefault("main"); }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 8px",
                            fontSize: "var(--text-xs)",
                            color: "var(--text-tertiary)",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            transition: "color var(--transition-fast)",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--interactive)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                        >
                          <Star size={12} />
                          设为默认
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 8px",
                            fontSize: "var(--text-xs)",
                            color: "var(--text-tertiary)",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            transition: "color var(--transition-fast)",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--error)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Embedding Tab */}
        {activeTab === "embedding" && (
          <>
            {/* Current embedding model */}
            <div style={{
              padding: "var(--space-4)",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-xl)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                <Cpu size={16} style={{ color: "var(--interactive)" }} />
                <h3 style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-semibold)",
                  color: "var(--text-primary)",
                  margin: 0,
                }}>
                  嵌入模型配置
                </h3>
              </div>
              <p style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                marginTop: 0,
                marginBottom: "var(--space-4)",
              }}>
                嵌入模型用于文档向量化，直接影响知识库检索质量。
              </p>

              {embeddingDefaults && (
                <div style={{
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--interactive-light)",
                  border: "1px solid var(--interactive-light)",
                  borderRadius: "var(--radius-lg)",
                  fontSize: "var(--text-sm)",
                  marginBottom: "var(--space-4)",
                }}>
                  <span style={{ color: "var(--text-tertiary)" }}>当前嵌入模型:</span>{" "}
                  <span style={{
                    fontWeight: "var(--font-medium)",
                    color: "var(--interactive)",
                  }}>
                    {(() => {
                      const p = settings?.providers.find((pr) => pr.id === embeddingDefaults.embedding);
                      return p ? `${p.name} / ${p.model}` : (embeddingDefaults.embedding || "未设置");
                    })()}
                  </span>
                </div>
              )}

              {/* Provider selector */}
              <div style={{ marginBottom: "var(--space-3)" }}>
                <label style={labelStyle}>选择嵌入模型提供商</label>
                <select
                  value={embeddingProvider}
                  onChange={(e) => setEmbeddingProvider(e.target.value)}
                  style={{
                    ...inputStyle,
                    padding: "10px var(--space-3)",
                    cursor: "pointer",
                  }}
                >
                  <option value="">-- 选择提供商 --</option>
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

              {/* Test result */}
              {embeddingTestResult && (
                <div style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-2)",
                  padding: "10px var(--space-3)",
                  borderRadius: "var(--radius-lg)",
                  fontSize: "var(--text-sm)",
                  background: embeddingTestResult.success ? "var(--success-light)" : "var(--error-light)",
                  border: `1px solid ${embeddingTestResult.success ? "var(--success)" : "var(--error)"}`,
                  color: embeddingTestResult.success ? "var(--success)" : "var(--error)",
                  marginBottom: "var(--space-3)",
                }}>
                  {embeddingTestResult.success
                    ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    : <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  }
                  <span>{embeddingTestResult.message}</span>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <button
                  onClick={handleEmbeddingSave}
                  disabled={!embeddingProvider}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    padding: "var(--space-2) var(--space-4)",
                    background: "var(--interactive)",
                    color: "#fff",
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--font-medium)",
                    borderRadius: "var(--radius-lg)",
                    border: "none",
                    cursor: embeddingProvider ? "pointer" : "not-allowed",
                    opacity: embeddingProvider ? 1 : 0.5,
                    transition: "background var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => { if (embeddingProvider) e.currentTarget.style.background = "var(--interactive-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--interactive)"; }}
                >
                  <Save size={14} />
                  保存
                </button>
                <button
                  onClick={handleEmbeddingTest}
                  disabled={embeddingTesting || !embeddingProvider}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    padding: "var(--space-2) var(--space-4)",
                    background: "var(--bg-hover)",
                    color: "var(--text-secondary)",
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--font-medium)",
                    borderRadius: "var(--radius-lg)",
                    border: "none",
                    cursor: embeddingTesting || !embeddingProvider ? "not-allowed" : "pointer",
                    opacity: embeddingTesting || !embeddingProvider ? 0.5 : 1,
                    transition: "background var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                >
                  <Wifi size={14} />
                  {embeddingTesting ? "测试中..." : "测试"}
                </button>
              </div>
            </div>
          </>
        )}

        {/* General Tab */}
        {activeTab === "general" && (
          <>
            <div style={{
              padding: "var(--space-4)",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-xl)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
                <Globe size={16} style={{ color: "var(--interactive)" }} />
                <h3 style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-semibold)",
                  color: "var(--text-primary)",
                  margin: 0,
                }}>
                  通用设置
                </h3>
              </div>

              {/* Theme selection */}
              <div style={{ marginBottom: "var(--space-5)" }}>
                <label style={labelStyle}>主题</label>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  {([
                    { value: "light", label: "浅色" },
                    { value: "dark", label: "深色" },
                    { value: "system", label: "跟随系统" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setThemeMode(opt.value)}
                      style={{
                        padding: "var(--space-2) var(--space-4)",
                        border: "1px solid",
                        borderColor: themeMode === opt.value ? "var(--interactive)" : "var(--border-primary)",
                        borderRadius: "var(--radius-lg)",
                        background: themeMode === opt.value ? "var(--interactive-light)" : "var(--bg-primary)",
                        color: themeMode === opt.value ? "var(--interactive)" : "var(--text-secondary)",
                        fontSize: "var(--text-sm)",
                        fontWeight: themeMode === opt.value ? 500 : 400,
                        cursor: "pointer",
                        transition: "all var(--transition-fast)",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div>
                <label style={labelStyle}>语言</label>
                <select
                  value="zh"
                  disabled
                  style={{
                    ...inputStyle,
                    padding: "10px var(--space-3)",
                    cursor: "not-allowed",
                    opacity: 0.7,
                  }}
                >
                  <option value="zh">中文</option>
                </select>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: "var(--space-1)", margin: 0 }}>
                  更多语言即将推出
                </p>
              </div>
            </div>
          </>
        )}

        {/* About Tab */}
        {activeTab === "about" && (
          <>
            <div style={{
              padding: "var(--space-4)",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-xl)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
                <Info size={16} style={{ color: "var(--interactive)" }} />
                <h3 style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-semibold)",
                  color: "var(--text-primary)",
                  margin: 0,
                }}>
                  关于 DeepAnalyze
                </h3>
              </div>

              {/* Version info */}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "var(--space-2) 0",
                  borderBottom: "1px solid var(--border-primary)",
                }}>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>版本</span>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 500 }}>
                    {healthInfo?.version ?? "加载中..."}
                  </span>
                </div>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "var(--space-2) 0",
                  borderBottom: "1px solid var(--border-primary)",
                }}>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>状态</span>
                  <span style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    color: healthInfo?.status === "ok" ? "var(--success)" : "var(--text-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                  }}>
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: "var(--radius-full)",
                      background: healthInfo?.status === "ok" ? "var(--success)" : "var(--text-tertiary)",
                    }} />
                    {healthInfo?.status === "ok" ? "正常" : (healthInfo?.status ?? "加载中...")}
                  </span>
                </div>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "var(--space-2) 0",
                  borderBottom: "1px solid var(--border-primary)",
                }}>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Agent 引擎</span>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 500 }}>
                    DeepAnalyze Agent Engine
                  </span>
                </div>
              </div>

              {/* Links */}
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                marginTop: "var(--space-4)",
                paddingTop: "var(--space-3)",
                borderTop: "1px solid var(--border-primary)",
              }}>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-2) 0",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "var(--text-sm)",
                    color: "var(--interactive)",
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                >
                  查看系统日志
                </button>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-2) 0",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "var(--text-sm)",
                    color: "var(--interactive)",
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                >
                  查看开源许可
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
