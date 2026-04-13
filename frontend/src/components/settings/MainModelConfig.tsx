// =============================================================================
// DeepAnalyze - MainModelConfig
// Main agent model configuration (主模型)
// =============================================================================

import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { ModelConfigCard } from "./ModelConfigCard";
import type { ProviderConfig, ProviderDefaults } from "../../types/index";
import { ShieldCheck } from "lucide-react";

interface MainModelConfigProps {
  providers: ProviderConfig[];
  defaults: ProviderDefaults | null;
  onSetDefault: (role: string, providerId: string) => void;
}

export function MainModelConfig({ providers, defaults, onSetDefault }: MainModelConfigProps) {
  const { success, error: showError } = useToast();

  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [maxIterations, setMaxIterations] = useState(50);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Initialize from defaults
  useEffect(() => {
    if (defaults?.main) {
      const p = providers.find((pr) => pr.id === defaults.main);
      setProviderId(defaults.main);
      setModel(p?.model ?? "");
      setMaxTokens(p?.maxTokens ?? 4096);
    }
  }, [defaults, providers]);

  const handleConfigChange = (config: { providerId: string; model: string; temperature: number; maxTokens: number }) => {
    setProviderId(config.providerId);
    setModel(config.model);
    setTemperature(config.temperature);
    setMaxTokens(config.maxTokens);
  };

  const handleTest = async () => {
    if (!providerId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testProvider(providerId);
      setTestResult({
        success: result.success,
        message: result.success
          ? result.models?.length
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

  // Current default info banner
  const defaultProvider = defaults?.main ? providers.find((p) => p.id === defaults.main) : null;

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
          <span style={{ color: "var(--text-tertiary)" }}>当前主模型:</span>{" "}
          <span style={{ fontWeight: "var(--font-medium)", color: "var(--interactive)" }}>
            {defaultProvider.name} / {defaultProvider.model}
          </span>
        </div>
      )}

      <ModelConfigCard
        title="主模型"
        description="主要对话和分析使用的模型，承担核心任务处理。"
        providerId={providerId}
        model={model}
        temperature={temperature}
        maxTokens={maxTokens}
        maxTokensLimit={128000}
        enabled={true}
        providers={providers}
        onConfigChange={handleConfigChange}
        onTest={handleTest}
        testing={testing}
        testResult={testResult}
        extra={
          <>
            {/* Max iterations slider */}
            <div style={{ marginTop: "var(--space-2)" }}>
              <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>
                最大迭代: <span style={{ color: "var(--interactive)", fontWeight: 600 }}>{maxIterations}</span>
              </label>
              <input
                type="range"
                min={1}
                max={9999}
                step={1}
                value={maxIterations}
                onChange={(e) => setMaxIterations(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "var(--interactive)" }}
              />
            </div>

            {/* Set as default button */}
            {providerId && defaults?.main !== providerId && (
              <div style={{ marginTop: "var(--space-2)" }}>
                <button
                  onClick={() => onSetDefault("main", providerId)}
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
                  设为默认主模型
                </button>
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
