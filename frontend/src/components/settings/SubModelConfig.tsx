// =============================================================================
// DeepAnalyze - SubModelConfig
// Auxiliary/sub model configuration (辅助模型)
// =============================================================================

import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { ModelConfigCard } from "./ModelConfigCard";
import type { ProviderConfig, ProviderDefaults, ProviderMetadata } from "../../types/index";
import { ShieldCheck } from "lucide-react";

interface SubModelConfigProps {
  providers: ProviderConfig[];
  defaults: ProviderDefaults | null;
  registry: ProviderMetadata[];
  onSetDefault: (role: string, providerId: string) => void;
}

export function SubModelConfig({ providers, defaults, registry, onSetDefault }: SubModelConfigProps) {
  const { success, error: showError } = useToast();

  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.5);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [enabled, setEnabled] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Initialize from defaults
  useEffect(() => {
    if (defaults?.summarizer) {
      const p = providers.find((pr) => pr.id === defaults.summarizer);
      setProviderId(defaults.summarizer);
      setModel(p?.model ?? "");
      setMaxTokens(p?.maxTokens ?? 2048);
      setEnabled(true);
    }
  }, [defaults, providers]);

  const handleConfigChange = (config: { providerId: string; model: string; temperature: number; maxTokens: number; enabled: boolean }) => {
    setProviderId(config.providerId);
    setModel(config.model);
    setTemperature(config.temperature);
    setMaxTokens(config.maxTokens);
    setEnabled(config.enabled);
  };

  const handleTest = async () => {
    if (!providerId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testProvider(providerId);
      setTestResult({
        success: result.success,
        message: result.success ? "连接成功!" : result.error ?? "连接失败",
      });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  const defaultProvider = defaults?.summarizer ? providers.find((p) => p.id === defaults.summarizer) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {defaultProvider && (
        <div style={{
          padding: "var(--space-2) var(--space-3)",
          background: "var(--interactive-light)",
          border: "1px solid var(--interactive-light)",
          borderRadius: "var(--radius-lg)",
          fontSize: "var(--text-sm)",
        }}>
          <span style={{ color: "var(--text-tertiary)" }}>当前辅助模型:</span>{" "}
          <span style={{ fontWeight: "var(--font-medium)", color: "var(--interactive)" }}>
            {defaultProvider.name} / {defaultProvider.model}
          </span>
        </div>
      )}

      <ModelConfigCard
        title="辅助模型"
        description="用于文档编译、摘要生成等轻量任务的辅助模型（对应 summarizer 角色）。"
        providerId={providerId}
        model={model}
        temperature={temperature}
        maxTokens={maxTokens}
        maxTokensLimit={8192}
        enabled={enabled}
        showEnable={true}
        providers={providers}
        registry={registry}
        onConfigChange={handleConfigChange}
        onTest={handleTest}
        testing={testing}
        testResult={testResult}
        extra={
          <>
            {/* Max concurrent slider */}
            <div style={{ marginTop: "var(--space-2)" }}>
              <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>
                最大并发: <span style={{ color: "var(--interactive)", fontWeight: 600 }}>{maxConcurrent}</span>
              </label>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "var(--interactive)" }}
              />
            </div>

            {/* Set as default */}
            {providerId && enabled && defaults?.summarizer !== providerId && (
              <div style={{ marginTop: "var(--space-2)" }}>
                <button
                  onClick={() => onSetDefault("summarizer", providerId)}
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
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                >
                  <ShieldCheck size={14} />
                  设为默认辅助模型
                </button>
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
