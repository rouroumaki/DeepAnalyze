// =============================================================================
// DeepAnalyze - EmbeddingModelConfig
// Embedding model configuration (嵌入模型) with provider and custom modes
// =============================================================================

import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import type { ProviderConfig, ProviderDefaults } from "../../types/index";
import { CheckCircle2, XCircle, Cpu, Save, Wifi, AlertTriangle, Link2 } from "lucide-react";

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

type EmbeddingMode = "provider" | "custom";

interface EmbeddingModelConfigProps {
  providers: ProviderConfig[];
  defaults: ProviderDefaults | null;
  onSave: (providerId: string) => Promise<void>;
  onTest: (providerId: string) => Promise<{ success: boolean; message: string }>;
}

export function EmbeddingModelConfig({ providers, defaults, onSave, onTest }: EmbeddingModelConfigProps) {
  const { success, error: showError } = useToast();

  // Mode toggle
  const [mode, setMode] = useState<EmbeddingMode>("provider");

  // Provider mode state
  const [embeddingProvider, setEmbeddingProvider] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Custom mode state
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customDimension, setCustomDimension] = useState(768);
  const [customTesting, setCustomTesting] = useState(false);
  const [customTestResult, setCustomTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (defaults?.embedding) {
      setEmbeddingProvider(defaults.embedding);
    }
  }, [defaults]);

  // Provider mode handlers
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

  // Custom mode: test by calling /v1/embeddings directly
  const handleCustomTest = async () => {
    if (!customEndpoint || !customModel) {
      showError("请填写端点地址和模型名称");
      return;
    }
    setCustomTesting(true);
    setCustomTestResult(null);
    try {
      const endpoint = customEndpoint.replace(/\/+$/, "");
      const url = `${endpoint}/embeddings`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (customApiKey) {
        headers["Authorization"] = `Bearer ${customApiKey}`;
      }

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: customModel,
          input: ["DeepAnalyze 嵌入模型测试"],
        }),
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => "unknown error");
        setCustomTestResult({
          success: false,
          message: `连接失败 (HTTP ${resp.status}): ${errorText}`,
        });
        return;
      }

      const data = await resp.json() as {
        data?: Array<{ embedding?: number[]; index?: number }>;
        usage?: { prompt_tokens: number; total_tokens: number };
      };

      if (data.data && data.data.length > 0 && data.data[0].embedding) {
        const dim = data.data[0].embedding.length;
        setCustomTestResult({
          success: true,
          message: `连接成功! 向量维度: ${dim}, 用量: ${data.usage?.total_tokens ?? "N/A"} tokens`,
        });
        // Auto-update dimension from response
        setCustomDimension(dim);
      } else {
        setCustomTestResult({
          success: false,
          message: "服务器返回了无效的嵌入响应",
        });
      }
    } catch (err) {
      setCustomTestResult({
        success: false,
        message: err instanceof Error ? err.message : "测试失败",
      });
    } finally {
      setCustomTesting(false);
    }
  };

  // Custom mode: save the custom embedding config as a special provider
  const handleCustomSave = async () => {
    if (!customEndpoint || !customModel) {
      showError("请填写端点地址和模型名称");
      return;
    }
    try {
      const providerId = `__custom_embedding__`;
      const provider: ProviderConfig = {
        id: providerId,
        name: `自定义嵌入 (${customModel})`,
        type: "openai-compatible",
        endpoint: customEndpoint,
        apiKey: customApiKey,
        model: customModel,
        maxTokens: customDimension,
        supportsToolUse: false,
        enabled: true,
      };
      await api.saveProvider(provider);
      await onSave(providerId);
      success("自定义嵌入模型已保存");
    } catch {
      showError("保存自定义嵌入模型失败");
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

      {/* Status banner */}
      {currentProvider ? (
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          background: "var(--interactive-light)",
          border: "1px solid var(--interactive-light)",
          borderRadius: "var(--radius-lg)",
          fontSize: "var(--text-sm)",
          marginBottom: "var(--space-4)",
        }}>
          <CheckCircle2 size={14} style={{ flexShrink: 0, color: "var(--success)" }} />
          <span>
            <span style={{ color: "var(--text-tertiary)" }}>当前嵌入策略:</span>{" "}
            <span style={{ fontWeight: "var(--font-medium)", color: "var(--interactive)" }}>
              {currentProvider.name}
            </span>
            <span style={{ color: "var(--text-tertiary)" }}> (模型: </span>
            <span style={{ fontWeight: "var(--font-medium)", color: "var(--interactive)" }}>
              {currentProvider.model}
            </span>
            <span style={{ color: "var(--text-tertiary)" }}>)</span>
          </span>
        </div>
      ) : (
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          background: "var(--warning-light, #fef3cd)",
          border: "1px solid var(--warning, #f59e0b)",
          borderRadius: "var(--radius-lg)",
          fontSize: "var(--text-sm)",
          color: "var(--warning, #d97706)",
          marginBottom: "var(--space-4)",
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>未配置嵌入模型，语义搜索不可用 (当前使用 Hash fallback)</span>
        </div>
      )}

      {/* Mode toggle */}
      <div style={{
        display: "flex",
        gap: "var(--space-1)",
        marginBottom: "var(--space-4)",
        borderBottom: "1px solid var(--border-primary)",
        paddingBottom: "var(--space-1)",
      }}>
        <button
          onClick={() => setMode("provider")}
          style={{
            display: "flex", alignItems: "center", gap: "var(--space-1)",
            padding: "var(--space-2) var(--space-3)",
            border: "none",
            borderBottom: mode === "provider" ? "2px solid var(--interactive)" : "2px solid transparent",
            borderRadius: "var(--radius-md) var(--radius-md) 0 0",
            background: mode === "provider" ? "var(--interactive-light)" : "transparent",
            color: mode === "provider" ? "var(--interactive)" : "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            fontWeight: mode === "provider" ? 500 : 400,
            cursor: "pointer",
            transition: "all var(--transition-fast)",
          }}
        >
          <Cpu size={14} />
          复用已有 Provider
        </button>
        <button
          onClick={() => setMode("custom")}
          style={{
            display: "flex", alignItems: "center", gap: "var(--space-1)",
            padding: "var(--space-2) var(--space-3)",
            border: "none",
            borderBottom: mode === "custom" ? "2px solid var(--interactive)" : "2px solid transparent",
            borderRadius: "var(--radius-md) var(--radius-md) 0 0",
            background: mode === "custom" ? "var(--interactive-light)" : "transparent",
            color: mode === "custom" ? "var(--interactive)" : "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            fontWeight: mode === "custom" ? 500 : 400,
            cursor: "pointer",
            transition: "all var(--transition-fast)",
          }}
        >
          <Link2 size={14} />
          自定义端点
        </button>
      </div>

      {/* Provider mode */}
      {mode === "provider" && (
        <>
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
        </>
      )}

      {/* Custom endpoint mode */}
      {mode === "custom" && (
        <>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "var(--space-3)" }}>
            直接配置 OpenAI 兼容的嵌入端点。适用于独立的嵌入模型服务 (如 Ollama, vLLM, Jina 等)。
          </p>

          {/* Endpoint URL */}
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={labelStyle}>端点地址</label>
            <input
              type="text"
              value={customEndpoint}
              onChange={(e) => setCustomEndpoint(e.target.value)}
              placeholder="https://api.example.com/v1"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
            />
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", margin: 0, marginTop: 2 }}>
              将在此地址后追加 /embeddings 进行调用
            </p>
          </div>

          {/* Model name */}
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={labelStyle}>模型名称</label>
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="如 text-embedding-3-small, bge-m3"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
            />
          </div>

          {/* API Key (optional) */}
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={labelStyle}>
              API Key <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(可选)</span>
            </label>
            <input
              type="password"
              value={customApiKey}
              onChange={(e) => setCustomApiKey(e.target.value)}
              placeholder="sk-... (本地服务可留空)"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
            />
          </div>

          {/* Dimension */}
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={labelStyle}>向量维度</label>
            <input
              type="number"
              value={customDimension}
              onChange={(e) => setCustomDimension(parseInt(e.target.value) || 768)}
              min={1}
              max={8192}
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--interactive-light)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
            />
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", margin: 0, marginTop: 2 }}>
              测试成功后会自动更新为实际维度
            </p>
          </div>

          {/* Test result */}
          {customTestResult && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: "var(--space-2)",
              padding: "8px var(--space-3)", borderRadius: "var(--radius-lg)", fontSize: "var(--text-sm)",
              background: customTestResult.success ? "var(--success-light)" : "var(--error-light)",
              border: `1px solid ${customTestResult.success ? "var(--success)" : "var(--error)"}`,
              color: customTestResult.success ? "var(--success)" : "var(--error)",
              marginBottom: "var(--space-3)",
            }}>
              {customTestResult.success ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
              <span>{customTestResult.message}</span>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <button onClick={handleCustomSave} disabled={!customEndpoint || !customModel} style={{
              display: "flex", alignItems: "center", gap: "var(--space-1)",
              padding: "var(--space-2) var(--space-4)", background: "var(--interactive)", color: "#fff",
              fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", borderRadius: "var(--radius-lg)",
              border: "none", cursor: customEndpoint && customModel ? "pointer" : "not-allowed",
              opacity: customEndpoint && customModel ? 1 : 0.5,
              transition: "background var(--transition-fast)",
            }} onMouseEnter={(e) => { if (customEndpoint && customModel) e.currentTarget.style.background = "var(--interactive-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--interactive)"; }}>
              <Save size={14} /> 保存
            </button>
            <button onClick={handleCustomTest} disabled={customTesting || !customEndpoint || !customModel} style={{
              display: "flex", alignItems: "center", gap: "var(--space-1)",
              padding: "var(--space-2) var(--space-4)", background: "var(--bg-hover)", color: "var(--text-secondary)",
              fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", borderRadius: "var(--radius-lg)",
              border: "none", cursor: customTesting || !customEndpoint || !customModel ? "not-allowed" : "pointer",
              opacity: customTesting || !customEndpoint || !customModel ? 0.5 : 1, transition: "background var(--transition-fast)",
            }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}>
              <Wifi size={14} /> {customTesting ? "测试中..." : "测试连接"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
