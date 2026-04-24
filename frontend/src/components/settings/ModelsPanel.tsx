// =============================================================================
// DeepAnalyze - ModelsPanel
// 4-tab container for model configuration: main/sub/embedding/enhanced
// =============================================================================

import { useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { MainModelConfig } from "./MainModelConfig";
import { SubModelConfig } from "./SubModelConfig";
import { EmbeddingModelConfig } from "./EmbeddingModelConfig";
import { VLMModelConfig } from "./VLMModelConfig";
import { ASRModelConfig } from "./ASRModelConfig";
import { VideoUnderstandModelConfig } from "./VideoUnderstandModelConfig";
import { EnhancedModelsConfig } from "./EnhancedModelsConfig";
import { DoclingConfig } from "./DoclingConfig";
import type { ProviderConfig, ProviderDefaults, ProviderSettings, ProviderMetadata } from "../../types/index";
import {
  Bot,
  Sparkles,
  Binary,
  Eye,
  Mic,
  Video,
  Wand,
  FileText,
} from "lucide-react";

type ModelTabId = "main" | "sub" | "embedding" | "vlm" | "audio_transcribe" | "video_understand" | "enhanced" | "docling";

const modelTabs: { id: ModelTabId; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { id: "main", label: "主模型", shortLabel: "主模型", icon: <Bot size={14} /> },
  { id: "sub", label: "辅助模型", shortLabel: "辅助", icon: <Sparkles size={14} /> },
  { id: "embedding", label: "嵌入模型", shortLabel: "嵌入", icon: <Binary size={14} /> },
  { id: "vlm", label: "图像理解", shortLabel: "VLM", icon: <Eye size={14} /> },
  { id: "audio_transcribe", label: "ASR 模型", shortLabel: "ASR", icon: <Mic size={14} /> },
  { id: "video_understand", label: "视频理解", shortLabel: "视频", icon: <Video size={14} /> },
  { id: "enhanced", label: "生成模型", shortLabel: "生成", icon: <Wand size={14} /> },
  { id: "docling", label: "文档处理", shortLabel: "文档", icon: <FileText size={14} /> },
];

interface ModelsPanelProps {
  providers: ProviderConfig[];
  settings: ProviderSettings | null;
  registry: ProviderMetadata[];
  onSettingsChanged: () => void;
}

export function ModelsPanel({ providers, settings, registry, onSettingsChanged }: ModelsPanelProps) {
  const { success, error: showError } = useToast();
  const [activeTab, setActiveTab] = useState<ModelTabId>("main");

  const defaults = settings?.defaults ?? null;

  const handleSetDefault = async (role: string, providerId: string) => {
    try {
      await api.saveDefaults({ [role]: providerId });
      success("默认模型已更新");
      onSettingsChanged();
    } catch {
      showError("更新默认模型失败");
    }
  };

  const handleEmbeddingSave = async (providerId: string) => {
    await api.saveDefaults({ embedding: providerId });
    onSettingsChanged();
  };

  const handleEmbeddingTest = async (providerId: string) => {
    const result = await api.testProvider(providerId);
    return {
      success: result.success,
      message: result.success ? "嵌入模型连接成功!" : (result.error ?? "连接失败"),
    };
  };

  const handleSaveProvider = async (provider: ProviderConfig) => {
    await api.saveProvider(provider);
    onSettingsChanged();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* Sub-tabs */}
      <div style={{
        display: "flex",
        gap: "var(--space-1)",
        borderBottom: "1px solid var(--border-primary)",
        paddingBottom: "var(--space-1)",
      }}>
        {modelTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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

      {/* Tab content */}
      {activeTab === "main" && (
        <MainModelConfig providers={providers} defaults={defaults} registry={registry} onSetDefault={handleSetDefault} onSaveProvider={handleSaveProvider} />
      )}
      {activeTab === "sub" && (
        <SubModelConfig providers={providers} defaults={defaults} registry={registry} onSetDefault={handleSetDefault} onSaveProvider={handleSaveProvider} />
      )}
      {activeTab === "embedding" && (
        <EmbeddingModelConfig providers={providers} defaults={defaults} onSave={handleEmbeddingSave} onTest={handleEmbeddingTest} />
      )}
      {activeTab === "vlm" && (
        <VLMModelConfig providers={providers} defaults={defaults} registry={registry} onSetDefault={handleSetDefault} onSaveProvider={handleSaveProvider} />
      )}
      {activeTab === "audio_transcribe" && (
        <ASRModelConfig providers={providers} defaults={defaults} registry={registry} onSetDefault={handleSetDefault} onSaveProvider={handleSaveProvider} />
      )}
      {activeTab === "video_understand" && (
        <VideoUnderstandModelConfig providers={providers} defaults={defaults} registry={registry} onSetDefault={handleSetDefault} onSaveProvider={handleSaveProvider} />
      )}
      {activeTab === "enhanced" && (
        <EnhancedModelsConfig providers={providers} />
      )}
      {activeTab === "docling" && (
        <DoclingConfig />
      )}
    </div>
  );
}
