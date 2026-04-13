// =============================================================================
// DeepAnalyze - SettingsPanel Component
// Settings panel with internal left sidebar navigation
// Designed for rendering inside the RightPanel
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import type { ProviderConfig, ProviderSettings, ProviderMetadata, ProviderDefaults, AgentSettings } from "../../types/index";
import { ChannelsPanel } from "../channels/ChannelsPanel";
import { useToast } from "../../hooks/useToast";
import { useUIStore, type ThemeMode } from "../../store/ui";
import { ModelsPanel } from "./ModelsPanel";
import {
  CheckCircle2,
  XCircle,
  Trash2,
  Star,
  Save,
  Wifi,
  ShieldCheck,
  Server,
  Globe,
  Info,
  Settings2,
  Plus,
  MessageCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Settings tab type
// ---------------------------------------------------------------------------

type SettingsTabId = "models" | "channels" | "general";

const settingsTabs: { id: SettingsTabId; label: string; icon: React.ReactNode }[] = [
  { id: "models", label: "模型配置", icon: <Server size={16} /> },
  { id: "channels", label: "通信渠道", icon: <MessageCircle size={16} /> },
  { id: "general", label: "通用", icon: <Globe size={16} /> },
];

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const { success, error: showError } = useToast();
  const themeMode = useUIStore((s) => s.themeMode);
  const setThemeMode = useUIStore((s) => s.setThemeMode);

  const [activeTab, setActiveTab] = useState<SettingsTabId>("models");

  // Provider data (shared across sub-tabs)
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

  // About tab state
  const [healthInfo, setHealthInfo] = useState<{ status: string; version: string } | null>(null);

  // Agent settings
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [agentSaving, setAgentSaving] = useState(false);

  // Load data
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

  // Load health info
  useEffect(() => {
    api.health().then((info) => setHealthInfo(info)).catch(() => setHealthInfo(null));
  }, []);

  // Load agent settings when general tab is active
  useEffect(() => {
    if (activeTab !== "general") return;
    api.getAgentSettings().then((s) => setAgentSettings(s)).catch(() => setAgentSettings(null));
  }, [activeTab]);

  const currentMeta = registry.find((p) => p.id === selectedProvider);
  const isLocal = currentMeta?.isLocal ?? false;

  // --- Provider CRUD handlers ---

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

  const handleAgentSave = async () => {
    if (!agentSettings) return;
    setAgentSaving(true);
    try {
      const result = await api.saveAgentSettings(agentSettings);
      setAgentSettings(result.settings);
      success("Agent 设置已保存");
    } catch {
      showError("保存 Agent 设置失败");
    } finally {
      setAgentSaving(false);
    }
  };

  // =====================================================================
  // Render
  // =====================================================================

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left sidebar navigation */}
      <nav style={{
        width: 64,
        minWidth: 64,
        borderRight: "1px solid var(--border-primary)",
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "var(--space-2) var(--space-1)",
        overflowY: "auto",
      }}>
        {settingsTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              padding: "var(--space-2) var(--space-1)",
              border: "none",
              borderRadius: "var(--radius-md)",
              background: activeTab === tab.id ? "var(--interactive-light)" : "transparent",
              color: activeTab === tab.id ? "var(--interactive)" : "var(--text-secondary)",
              cursor: "pointer",
              transition: "all var(--transition-fast)",
              position: "relative" as const,
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
              }
            }}
          >
            {tab.icon}
            <span style={{ fontSize: "var(--text-xs)", lineHeight: 1 }}>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Main content area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

          {/* ============================================================= */}
          {/* Models Tab */}
          {/* ============================================================= */}
          {activeTab === "models" && (
            <>
              {/* Provider management section */}
              <div>
                <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0, marginBottom: "var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <Server size={14} />
                  Provider 管理
                </h3>

                {/* Provider selection + config form */}
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  <div>
                    <label style={labelStyle}>选择提供商</label>
                    <select
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                      style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}
                    >
                      <option value="">-- 选择 --</option>
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

                  {selectedProvider && (
                    <div style={{
                      display: "flex", flexDirection: "column", gap: "var(--space-3)",
                      background: "var(--bg-secondary)", border: "1px solid var(--border-primary)",
                      borderRadius: "var(--radius-xl)", padding: "var(--space-4)",
                    }}>
                      <div>
                        <label style={labelStyle}>模型名称</label>
                        <input type="text" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder={currentMeta?.defaultModel || "模型 ID"} style={inputStyle} />
                      </div>
                      <div>
                        <label style={labelStyle}>API Key {isLocal && <span style={{ color: "var(--text-tertiary)" }}>(可选)</span>}</label>
                        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isLocal ? "本地模型无需 API Key" : "sk-..."} style={inputStyle} />
                      </div>
                      <div>
                        <label style={labelStyle}>API 地址</label>
                        <input type="text" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder={currentMeta?.defaultApiBase || "https://..."} style={inputStyle} />
                        {currentMeta?.defaultApiBase && <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", margin: 0, marginTop: 2 }}>默认: {currentMeta.defaultApiBase}</p>}
                      </div>
                      <div>
                        <label style={labelStyle}>最大 Tokens</label>
                        <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value) || 32768)} style={inputStyle} />
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16 }} />
                        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>启用</span>
                      </label>

                      {testResult && (
                        <div style={{
                          display: "flex", alignItems: "flex-start", gap: "var(--space-2)",
                          padding: "8px var(--space-3)", borderRadius: "var(--radius-lg)", fontSize: "var(--text-sm)",
                          background: testResult.success ? "var(--success-light)" : "var(--error-light)",
                          border: `1px solid ${testResult.success ? "var(--success)" : "var(--error)"}`,
                          color: testResult.success ? "var(--success)" : "var(--error)",
                        }}>
                          {testResult.success ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
                          <span>{testResult.message}</span>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" as const }}>
                        <button onClick={handleSave} disabled={saving} style={{
                          display: "flex", alignItems: "center", gap: "var(--space-1)",
                          padding: "var(--space-2) var(--space-4)", background: "var(--interactive)", color: "#fff",
                          fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", borderRadius: "var(--radius-lg)",
                          border: "none", cursor: "pointer", opacity: saving ? 0.5 : 1,
                        }}><Save size={14} />{saving ? "保存中..." : "保存"}</button>
                        <button onClick={handleTest} disabled={testing || (!isLocal && !apiKey)} style={{
                          display: "flex", alignItems: "center", gap: "var(--space-1)",
                          padding: "var(--space-2) var(--space-4)", background: "var(--bg-hover)", color: "var(--text-secondary)",
                          fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", borderRadius: "var(--radius-lg)",
                          border: "none", cursor: "pointer", opacity: testing || (!isLocal && !apiKey) ? 0.5 : 1,
                        }}><Wifi size={14} />{testing ? "测试中..." : "测试连接"}</button>
                        <button onClick={() => handleSetDefault("main")} style={{
                          display: "flex", alignItems: "center", gap: "var(--space-1)",
                          padding: "var(--space-2) var(--space-4)", background: "var(--success-light)", color: "var(--success)",
                          fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", borderRadius: "var(--radius-lg)",
                          border: "none", cursor: "pointer",
                        }}><ShieldCheck size={14} />设为默认</button>
                      </div>
                    </div>
                  )}

                  {/* Configured providers list */}
                  {settings && settings.providers.length > 0 && (
                    <div style={{ marginTop: "var(--space-3)" }}>
                      <h4 style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-tertiary)", margin: 0, marginBottom: "var(--space-2)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
                        已配置 ({settings.providers.length})
                      </h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {settings.providers.map((p) => (
                          <div key={p.id} onClick={() => setSelectedProvider(p.id)} style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "var(--space-2) var(--space-3)", background: "var(--bg-secondary)",
                            border: "1px solid", borderColor: p.id === selectedProvider ? "var(--interactive-light)" : "var(--border-primary)",
                            borderRadius: "var(--radius-md)", cursor: "pointer", transition: "border-color var(--transition-fast)",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.enabled ? "var(--success)" : "var(--text-tertiary)" }} />
                              <div>
                                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 500 }}>
                                  {p.name}
                                  {settings.defaults.main === p.id && <span style={{ marginLeft: "var(--space-1)", fontSize: "var(--text-xs)", color: "var(--interactive)" }}>★</span>}
                                </span>
                                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginLeft: "var(--space-2)" }}>
                                  {p.model}
                                </span>
                              </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} style={{
                              padding: 2, border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer",
                            }} onMouseEnter={(e) => { e.currentTarget.style.color = "var(--error)"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Model role configuration section */}
              <div style={{ borderTop: "1px solid var(--border-primary)", paddingTop: "var(--space-4)" }}>
                <ModelsPanel
                  providers={settings?.providers ?? []}
                  settings={settings}
                  registry={registry}
                  onSettingsChanged={loadData}
                />
              </div>
            </>
          )}

          {/* ============================================================= */}
          {/* ============================================================= */}
          {/* Channels Tab */}
          {/* ============================================================= */}
          {activeTab === "channels" && (
            <ChannelsPanel />
          )}

          {/* ============================================================= */}
          {/* General Tab */}
          {/* ============================================================= */}
          {activeTab === "general" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              {/* Theme */}
              <div style={{ padding: "var(--space-4)", background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-xl)" }}>
                <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0, marginBottom: "var(--space-3)" }}>
                  主题
                </h3>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  {([
                    { value: "light", label: "浅色" },
                    { value: "dark", label: "深色" },
                    { value: "system", label: "跟随系统" },
                  ] as const).map((opt) => (
                    <button key={opt.value} onClick={() => setThemeMode(opt.value)} style={{
                      padding: "var(--space-2) var(--space-4)", border: "1px solid",
                      borderColor: themeMode === opt.value ? "var(--interactive)" : "var(--border-primary)",
                      borderRadius: "var(--radius-lg)",
                      background: themeMode === opt.value ? "var(--interactive-light)" : "var(--bg-primary)",
                      color: themeMode === opt.value ? "var(--interactive)" : "var(--text-secondary)",
                      fontSize: "var(--text-sm)", fontWeight: themeMode === opt.value ? 500 : 400,
                      cursor: "pointer", transition: "all var(--transition-fast)",
                    }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Agent settings */}
              <div style={{ padding: "var(--space-4)", background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-xl)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                  <Settings2 size={16} style={{ color: "var(--interactive)" }} />
                  <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0 }}>
                    Agent 运行参数
                  </h3>
                </div>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 0, marginBottom: "var(--space-4)" }}>
                  修改后即时生效，无需重启。
                </p>

                {agentSettings ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    <div>
                      <label style={labelStyle}>最大轮次</label>
                      <select value={agentSettings.maxTurns} onChange={(e) => setAgentSettings({ ...agentSettings, maxTurns: parseInt(e.target.value) })} style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}>
                        <option value={50}>50 轮</option>
                        <option value={100}>100 轮</option>
                        <option value={200}>200 轮</option>
                        <option value={500}>500 轮</option>
                        <option value={-1}>无限制</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>上下文窗口</label>
                      <select value={agentSettings.contextWindow} onChange={(e) => setAgentSettings({ ...agentSettings, contextWindow: parseInt(e.target.value) })} style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}>
                        <option value={32000}>32K</option>
                        <option value={64000}>64K</option>
                        <option value={128000}>128K (默认)</option>
                        <option value={200000}>200K</option>
                        <option value={256000}>256K</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>压缩缓冲区</label>
                      <select value={agentSettings.compactionBuffer} onChange={(e) => setAgentSettings({ ...agentSettings, compactionBuffer: parseInt(e.target.value) })} style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}>
                        <option value={8000}>8K</option>
                        <option value={13000}>13K (默认)</option>
                        <option value={20000}>20K</option>
                        <option value={30000}>30K</option>
                      </select>
                    </div>
                    <button onClick={handleAgentSave} disabled={agentSaving} style={{
                      display: "flex", alignItems: "center", gap: "var(--space-1)",
                      padding: "var(--space-2) var(--space-4)", background: "var(--interactive)", color: "#fff",
                      fontSize: "var(--text-sm)", borderRadius: "var(--radius-lg)", border: "none",
                      cursor: agentSaving ? "not-allowed" : "pointer", opacity: agentSaving ? 0.5 : 1, alignSelf: "flex-start",
                    }}>
                      <Save size={14} /> {agentSaving ? "保存中..." : "保存设置"}
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>加载中...</p>
                )}
              </div>

              {/* About */}
              <div style={{ padding: "var(--space-4)", background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-xl)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                  <Info size={16} style={{ color: "var(--interactive)" }} />
                  <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0 }}>
                    关于
                  </h3>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-1) 0", borderBottom: "1px solid var(--border-primary)" }}>
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>版本</span>
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 500 }}>{healthInfo?.version ?? "---"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-1) 0" }}>
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>状态</span>
                    <span style={{ fontSize: "var(--text-sm)", color: healthInfo?.status === "ok" ? "var(--success)" : "var(--text-tertiary)", fontWeight: 500 }}>
                      {healthInfo?.status === "ok" ? "正常" : "---"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
