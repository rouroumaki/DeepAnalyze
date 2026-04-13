// =============================================================================
// DeepAnalyze - EmbeddingModelConfig
// Embedding model configuration (嵌入模型)
// =============================================================================

import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import type { ProviderConfig, ProviderDefaults } from "../../types/index";
import { CheckCircle2, XCircle, Cpu, Save, Wifi } from "lucide-react";

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

interface EmbeddingModelConfigProps {
  providers: ProviderConfig[];
  defaults: ProviderDefaults | null;
  onSave: (providerId: string) => Promise<void>;
  onTest: (providerId: string) => Promise<{ success: boolean; message: string }>;
}

export function EmbeddingModelConfig({ providers, defaults, onSave, onTest }: EmbeddingModelConfigProps) {
  const { success, error: showError } = useToast();

  const [embeddingProvider, setEmbeddingProvider] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (defaults?.embedding) {
      setEmbeddingProvider(defaults.embedding);
    }
  }, [defaults]);

  const handleSave = async () => {
    if (!embeddingProvider) return;
    try {
      await onSave(embeddingProvider);
      success("嵌入模型已更新");
    } catch {
      showError("更新嵌入模型失败");
    }
  };

  const handleTest = async () => {
    if (!embeddingProvider) return;
    setTesting(true);
    setTestResult(null);
    try {
      await handleSave();
      const result = await onTest(embeddingProvider);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  };

  const currentProvider = defaults?.embedding ? providers.find((p) => p.id === defaults.embedding) : null;

  return (
    <div style={{
      padding: "var(--space-4)",
      background: "var(--bg-secondary)",
      border: "1px solid var(--border-primary)",
      borderRadius: "var(--radius-xl)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <Cpu size={16} style={{ color: "var(--interactive)" }} />
        <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0 }}>
          嵌入模型配置
        </h3>
      </div>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 0, marginBottom: "var(--space-4)" }}>
        嵌入模型用于文档向量化，直接影响知识库检索质量。
      </p>

      {/* Current embedding info */}
      {currentProvider && (
        <div style={{
          padding: "var(--space-2) var(--space-3)",
          background: "var(--interactive-light)",
          border: "1px solid var(--interactive-light)",
          borderRadius: "var(--radius-lg)",
          fontSize: "var(--text-sm)",
          marginBottom: "var(--space-4)",
        }}>
          <span style={{ color: "var(--text-tertiary)" }}>当前嵌入模型:</span>{" "}
          <span style={{ fontWeight: "var(--font-medium)", color: "var(--interactive)" }}>
            {currentProvider.name} / {currentProvider.model}
          </span>
        </div>
      )}

      {/* Provider selector */}
      <div style={{ marginBottom: "var(--space-3)" }}>
        <label style={labelStyle}>选择嵌入模型提供商</label>
        <select
          value={embeddingProvider}
          onChange={(e) => setEmbeddingProvider(e.target.value)}
          style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}
        >
          <option value="">-- 选择提供商 --</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Test result */}
      {testResult && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: "var(--space-2)",
          padding: "8px var(--space-3)", borderRadius: "var(--radius-lg)", fontSize: "var(--text-sm)",
          background: testResult.success ? "var(--success-light)" : "var(--error-light)",
          border: `1px solid ${testResult.success ? "var(--success)" : "var(--error)"}`,
          color: testResult.success ? "var(--success)" : "var(--error)",
          marginBottom: "var(--space-3)",
        }}>
          {testResult.success ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{testResult.message}</span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <button onClick={handleSave} disabled={!embeddingProvider} style={{
          display: "flex", alignItems: "center", gap: "var(--space-1)",
          padding: "var(--space-2) var(--space-4)", background: "var(--interactive)", color: "#fff",
          fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", borderRadius: "var(--radius-lg)",
          border: "none", cursor: embeddingProvider ? "pointer" : "not-allowed", opacity: embeddingProvider ? 1 : 0.5,
          transition: "background var(--transition-fast)",
        }} onMouseEnter={(e) => { if (embeddingProvider) e.currentTarget.style.background = "var(--interactive-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--interactive)"; }}>
          <Save size={14} /> 保存
        </button>
        <button onClick={handleTest} disabled={testing || !embeddingProvider} style={{
          display: "flex", alignItems: "center", gap: "var(--space-1)",
          padding: "var(--space-2) var(--space-4)", background: "var(--bg-hover)", color: "var(--text-secondary)",
          fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", borderRadius: "var(--radius-lg)",
          border: "none", cursor: testing || !embeddingProvider ? "not-allowed" : "pointer",
          opacity: testing || !embeddingProvider ? 0.5 : 1, transition: "background var(--transition-fast)",
        }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}>
          <Wifi size={14} /> {testing ? "测试中..." : "测试"}
        </button>
      </div>
    </div>
  );
}
