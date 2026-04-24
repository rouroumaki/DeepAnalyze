// =============================================================================
// DeepAnalyze - DoclingConfig Component
// Document processing model configuration panel
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import type { DoclingConfig, DoclingModels } from "../../types/index";
import {
  Save,
  LayoutGrid,
  ScanText,
  Table2,
  Eye,
  RefreshCw,
  Layers,
} from "lucide-react";

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

const cardStyle: React.CSSProperties = {
  padding: "var(--space-4)",
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-primary)",
  borderRadius: "var(--radius-xl)",
};

// ---------------------------------------------------------------------------
// DoclingConfig
// ---------------------------------------------------------------------------

export function DoclingConfig() {
  const { success, error: showError } = useToast();
  const [config, setConfig] = useState<DoclingConfig | null>(null);
  const [models, setModels] = useState<DoclingModels | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [cfg, mdl] = await Promise.all([
        api.getDoclingConfig(),
        api.getDoclingModels(),
      ]);
      setConfig(cfg);
      setModels(mdl);
    } catch (err) {
      console.error("Failed to load docling config:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.saveDoclingConfig(config);
      success("文档处理配置已保存");
    } catch {
      showError("保存文档处理配置失败");
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (patch: Partial<DoclingConfig>) => {
    setConfig((prev) => prev ? { ...prev, ...patch } : prev);
  };

  if (loading || !config) {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
        加载文档处理配置...
      </div>
    );
  }

  const layoutModels = models?.layout ?? [];
  const vlmModels = models?.vlm ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* Layout Model */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          <LayoutGrid size={16} style={{ color: "var(--interactive)" }} />
          <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0 }}>
            布局模型
          </h3>
        </div>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 0, marginBottom: "var(--space-3)" }}>
          负责文档页面中的区域检测（标题、正文、表格、图片等）
        </p>
        <select
          value={config.layout_model}
          onChange={(e) => updateConfig({ layout_model: e.target.value })}
          style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}
        >
          {layoutModels.length > 0 ? (
            layoutModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))
          ) : (
            <>
              <option value="docling-project/docling-layout-egret-xlarge">Egret-XLarge (高精度)</option>
              <option value="docling-project/docling-layout-heron">Heron (轻量)</option>
            </>
          )}
        </select>
      </div>

      {/* OCR Engine */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          <ScanText size={16} style={{ color: "var(--interactive)" }} />
          <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0 }}>
            OCR 引擎
          </h3>
        </div>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 0, marginBottom: "var(--space-3)" }}>
          光学字符识别引擎，用于提取文档中的文字内容
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <select
            value={config.ocr_engine}
            onChange={(e) => updateConfig({ ocr_engine: e.target.value as DoclingConfig["ocr_engine"] })}
            style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}
          >
            <option value="rapidocr">RapidOCR (推荐，GPU 加速)</option>
            <option value="easyocr">EasyOCR</option>
            <option value="tesseract">Tesseract</option>
          </select>

          {config.ocr_engine === "rapidocr" && (
            <div>
              <label style={labelStyle}>推理后端</label>
              <select
                value={config.ocr_backend}
                onChange={(e) => updateConfig({ ocr_backend: e.target.value as DoclingConfig["ocr_backend"] })}
                style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}
              >
                <option value="torch">PyTorch GPU (推荐)</option>
                <option value="onnxruntime">ONNX Runtime</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Table Mode */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          <Table2 size={16} style={{ color: "var(--interactive)" }} />
          <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0 }}>
            表格识别
          </h3>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {([
            { value: "accurate", label: "精确模式", desc: "高质量，速度较慢" },
            { value: "fast", label: "快速模式", desc: "速度快，精度略低" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateConfig({ table_mode: opt.value })}
              style={{
                flex: 1,
                padding: "var(--space-3)",
                border: "1px solid",
                borderColor: config.table_mode === opt.value ? "var(--interactive)" : "var(--border-primary)",
                borderRadius: "var(--radius-lg)",
                background: config.table_mode === opt.value ? "var(--interactive-light)" : "var(--bg-primary)",
                color: config.table_mode === opt.value ? "var(--interactive)" : "var(--text-secondary)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all var(--transition-fast)",
              }}
            >
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{opt.label}</div>
              <div style={{ fontSize: "var(--text-xs)", marginTop: 2, opacity: 0.7 }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* VLM Toggle + Model */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Eye size={16} style={{ color: "var(--interactive)" }} />
            <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0 }}>
              VLM 视觉模型
            </h3>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={config.use_vlm}
              onChange={(e) => updateConfig({ use_vlm: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: "var(--interactive)" }}
            />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>启用</span>
          </label>
        </div>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 0, marginBottom: "var(--space-3)" }}>
          使用视觉语言模型进行高精度 OCR，适用于手写体、复杂排版等场景
        </p>

        {config.use_vlm && (
          <select
            value={config.vlm_model}
            onChange={(e) => updateConfig({ vlm_model: e.target.value })}
            style={{ ...inputStyle, padding: "8px var(--space-3)", cursor: "pointer" }}
          >
            <option value="">-- 选择 VLM 模型 --</option>
            {vlmModels.length > 0 ? (
              vlmModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))
            ) : (
              <option value="stepfun-ai/GOT-OCR-2.0-hf">GOT-OCR-2.0</option>
            )}
          </select>
        )}
      </div>

      {/* Parallelism */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          <Layers size={16} style={{ color: "var(--interactive)" }} />
          <h3 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)", color: "var(--text-primary)", margin: 0 }}>
            并行度
          </h3>
        </div>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", margin: "0 0 var(--space-3) 0" }}>
          同时处理的文档数量，增大可提升吞吐但增加 CPU/GPU 负载
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <input
            type="range"
            min={1}
            max={10}
            value={config.parallelism ?? 5}
            onChange={(e) => updateConfig({ parallelism: parseInt(e.target.value) })}
            style={{ flex: 1, accentColor: "var(--interactive)" }}
          />
          <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-medium)", color: "var(--text-primary)", minWidth: "2ch", textAlign: "center" }}>
            {config.parallelism ?? 5}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
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
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.5 : 1,
          }}
        >
          <Save size={14} />
          {saving ? "保存中..." : "保存配置"}
        </button>
        <button
          onClick={loadData}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            padding: "var(--space-2) var(--space-3)",
            background: "var(--bg-hover)",
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            borderRadius: "var(--radius-lg)",
            border: "none",
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </div>
    </div>
  );
}
