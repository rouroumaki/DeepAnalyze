// =============================================================================
// DeepAnalyze - Provider Registry
// =============================================================================
// Rich provider catalog with model metadata, thinking profiles, and feature flags.
// Aligned with OpenClaw/CountBot/AIE reference implementations.
// Updated April 2026.
// =============================================================================

/** Thinking/reasoning support level for a model */
export type ThinkingSupport = 'native' | 'compat' | 'experimental' | 'unsupported';

/** Configuration for passing thinking/reasoning parameters to a model */
export interface ThinkingConfig {
  /** Where to put the parameter: in extra_body or as a top-level field */
  type: 'extra_body' | 'top_level';
  /** The field name (e.g. "thinking", "enable_thinking", "reasoning_effort") */
  field: string;
  /** Values for enabled/disabled states */
  values: { enabled: unknown; disabled: unknown };
}

/** A single model within a provider's catalog */
export interface ModelMeta {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsToolUse: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  recommendedTemperature?: { min: number; max: number; default: number };
  recommendedTopP?: { min: number; max: number; default: number };
  thinkingSupport?: ThinkingSupport;
  thinkingConfig?: ThinkingConfig;
}

/** Feature flags for what a provider supports */
export interface ProviderFeatures {
  chat: boolean;
  embeddings: boolean;
  tts: boolean;
  imageGeneration: boolean;
  videoGeneration: boolean;
  musicGeneration: boolean;
  audioTranscription: boolean;
  vision: boolean;
}

/** Rich metadata for a provider entry */
export interface ProviderMetadata {
  id: string;
  name: string;
  apiBase: string;
  apiBaseCN?: string;
  defaultModel: string;
  models: ModelMeta[];
  isLocal: boolean;
  apiKeyEnvVar?: string;
  recommendedMaxTokens: number;
  contextWindow: number;
  features: ProviderFeatures;
}

// Helper to create a basic chat model entry
function chatModel(
  id: string, name: string, ctx: number, maxOut: number,
  toolUse = true, vision = false, stream = true,
  temp?: { min: number; max: number; default: number },
  thinking?: { support: ThinkingSupport; config: ThinkingConfig },
): ModelMeta {
  const m: ModelMeta = {
    id, name, contextWindow: ctx, maxOutputTokens: maxOut,
    supportsToolUse: toolUse, supportsVision: vision, supportsStreaming: stream,
  };
  if (temp) m.recommendedTemperature = temp;
  if (thinking) {
    m.thinkingSupport = thinking.support;
    m.thinkingConfig = thinking.config;
  }
  return m;
}

export const PROVIDER_REGISTRY: Record<string, ProviderMetadata> = {
  openrouter: {
    id: 'openrouter', name: 'OpenRouter',
    apiBase: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-4.5-sonnet',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    isLocal: false, recommendedMaxTokens: 128000, contextWindow: 1000000,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: true },
    models: [
      chatModel('anthropic/claude-4.5-sonnet', 'Claude 4.5 Sonnet', 200000, 64000, true, true, true),
      chatModel('anthropic/claude-opus-4-6', 'Claude Opus 4.6', 200000, 32000, true, true, true),
      chatModel('openai/gpt-5.4', 'GPT-5.4', 1047576, 32768, true, true, true),
      chatModel('google/gemini-2.5-pro', 'Gemini 2.5 Pro', 1048576, 65536, true, true, true),
    ],
  },
  anthropic: {
    id: 'anthropic', name: 'Anthropic (Claude)',
    apiBase: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    isLocal: false, recommendedMaxTokens: 64000, contextWindow: 200000,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: true },
    models: [
      chatModel('claude-opus-4-6', 'Claude Opus 4.6', 200000, 32000, true, true, true,
        { min: 0, max: 1, default: 0.5 },
        { support: 'native', config: { type: 'extra_body', field: 'thinking', values: { enabled: { type: 'enabled' }, disabled: { type: 'disabled' } } } }),
      chatModel('claude-sonnet-4-20250514', 'Claude Sonnet 4', 200000, 64000, true, true, true,
        { min: 0, max: 1, default: 0.5 }),
    ],
  },
  openai: {
    id: 'openai', name: 'OpenAI',
    apiBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    isLocal: false, recommendedMaxTokens: 32768, contextWindow: 1047576,
    features: { chat: true, embeddings: true, tts: true, imageGeneration: true, videoGeneration: false, musicGeneration: false, audioTranscription: true, vision: true },
    models: [
      chatModel('gpt-5.4', 'GPT-5.4', 1047576, 32768, true, true, true,
        { min: 0, max: 2, default: 0.7 },
        { support: 'compat', config: { type: 'top_level', field: 'reasoning_effort', values: { enabled: 'high', disabled: 'none' } } }),
      chatModel('gpt-5.3', 'GPT-5.3', 1047576, 32768, true, true, true),
      chatModel('gpt-4o', 'GPT-4o', 128000, 16384, true, true, true),
      chatModel('gpt-4o-mini', 'GPT-4o Mini', 128000, 16384, true, true, true),
      chatModel('o4-mini', 'o4-mini', 200000, 100000, true, false, true),
      chatModel('o3', 'o3', 200000, 100000, true, true, true),
    ],
  },
  deepseek: {
    id: 'deepseek', name: 'DeepSeek',
    apiBase: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    isLocal: false, recommendedMaxTokens: 8192, contextWindow: 131072,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [
      chatModel('deepseek-chat', 'DeepSeek V3', 131072, 8192, true, false, true,
        { min: 0, max: 2, default: 0.7 },
        { support: 'native', config: { type: 'extra_body', field: 'thinking', values: { enabled: { type: 'enabled' }, disabled: { type: 'disabled' } } } }),
      chatModel('deepseek-reasoner', 'DeepSeek R1', 131072, 8192),
    ],
  },
  qwen: {
    id: 'qwen', name: '通义千问 (Qwen)',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiBaseCN: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModel: 'qwen3.5-plus',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    isLocal: false, recommendedMaxTokens: 8192, contextWindow: 131072,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: true },
    models: [
      chatModel('qwen3.5-plus', 'Qwen 3.5 Plus', 131072, 8192, true, false, true,
        { min: 0, max: 2, default: 0.7 },
        { support: 'native', config: { type: 'extra_body', field: 'enable_thinking', values: { enabled: true, disabled: false } } }),
      chatModel('qwen3-plus', 'Qwen 3 Plus', 131072, 8192),
      chatModel('qwen-turbo', 'Qwen Turbo', 131072, 8192),
      chatModel('qwen-vl-max', 'Qwen VL Max', 32768, 8192, false, true, true),
      chatModel('qwen-vl-plus', 'Qwen VL Plus', 32768, 8192, false, true, true),
    ],
  },
  moonshot: {
    id: 'moonshot', name: '月之暗面 (Kimi)',
    apiBase: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
    apiKeyEnvVar: 'MOONSHOT_API_KEY',
    isLocal: false, recommendedMaxTokens: 66000, contextWindow: 256000,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [
      chatModel('kimi-k2.5', 'Kimi K2.5', 256000, 66000, true, false, true,
        { min: 1.0, max: 1.0, default: 1.0 },
        { support: 'native', config: { type: 'extra_body', field: 'thinking', values: { enabled: { type: 'enabled' }, disabled: { type: 'disabled' } } } }),
    ],
  },
  zhipu: {
    id: 'zhipu', name: '智谱 AI (GLM)',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.1',
    apiKeyEnvVar: 'ZHIPUAI_API_KEY',
    isLocal: false, recommendedMaxTokens: 131072, contextWindow: 200000,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: true },
    models: [
      chatModel('glm-5.1', 'GLM-5.1', 200000, 131072, true, false, true,
        undefined,
        { support: 'native', config: { type: 'extra_body', field: 'thinking', values: { enabled: { type: 'enabled' }, disabled: { type: 'disabled' } } } }),
      chatModel('glm-5', 'GLM-5', 200000, 131072),
      chatModel('glm-4.7-flash', 'GLM-4.7 Flash', 128000, 8192, true, true, true),
      chatModel('glm-4v-plus', 'GLM-5V-Turbo', 200000, 131072, true, true, true),
    ],
  },
  ernie: {
    id: 'ernie', name: '百度文心 (Ernie)',
    apiBase: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-4.0-8k',
    apiKeyEnvVar: 'QIANFAN_API_KEY',
    isLocal: false, recommendedMaxTokens: 8192, contextWindow: 128000,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [
      chatModel('ernie-4.0-8k', 'ERNIE 4.0 8K', 128000, 8192),
    ],
  },
  doubao: {
    id: 'doubao', name: '字节豆包 (Doubao)',
    apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-pro-32k',
    apiKeyEnvVar: 'ARK_API_KEY',
    isLocal: false, recommendedMaxTokens: 32000, contextWindow: 2000000,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [
      chatModel('doubao-pro-32k', 'Doubao Pro 32K', 32000, 4096),
    ],
  },
  minimax: {
    id: 'minimax', name: 'MiniMax (海螺)',
    apiBase: 'https://api.minimaxi.com/v1',
    defaultModel: 'M2.7',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    isLocal: false, recommendedMaxTokens: 131072, contextWindow: 1000000,
    features: { chat: true, embeddings: true, tts: true, imageGeneration: true, videoGeneration: true, musicGeneration: true, audioTranscription: false, vision: false },
    models: [
      chatModel('M2.7', 'M2.7', 1000000, 131072, true, false, true),
      chatModel('M2.7-highspeed', 'M2.7 Highspeed', 1000000, 131072, true, false, true),
    ],
  },
  groq: {
    id: 'groq', name: 'Groq',
    apiBase: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    apiKeyEnvVar: 'GROQ_API_KEY',
    isLocal: false, recommendedMaxTokens: 32000, contextWindow: 128000,
    features: { chat: true, embeddings: false, tts: true, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: true, vision: false },
    models: [
      chatModel('llama-3.3-70b-versatile', 'Llama 3.3 70B', 128000, 32000, true, false, true,
        undefined,
        { support: 'compat', config: { type: 'top_level', field: 'include_reasoning', values: { enabled: true, disabled: false } } }),
    ],
  },
  mistral: {
    id: 'mistral', name: 'Mistral AI',
    apiBase: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    isLocal: false, recommendedMaxTokens: 32000, contextWindow: 128000,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [
      chatModel('mistral-large-latest', 'Mistral Large', 128000, 32000),
    ],
  },
  gemini: {
    id: 'gemini', name: 'Google Gemini',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    isLocal: false, recommendedMaxTokens: 65536, contextWindow: 1048576,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: true },
    models: [
      chatModel('gemini-2.5-pro', 'Gemini 2.5 Pro', 1048576, 65536, true, true, true),
      chatModel('gemini-2.5-flash', 'Gemini 2.5 Flash', 1048576, 65536, true, true, true),
    ],
  },
  cohere: {
    id: 'cohere', name: 'Cohere',
    apiBase: 'https://api.cohere.com/v2',
    defaultModel: 'command-r-plus',
    apiKeyEnvVar: 'COHERE_API_KEY',
    isLocal: false, recommendedMaxTokens: 16000, contextWindow: 128000,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [
      chatModel('command-r-plus', 'Command R+', 128000, 16000),
    ],
  },
  together_ai: {
    id: 'together_ai', name: 'Together AI',
    apiBase: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    apiKeyEnvVar: 'TOGETHERAI_API_KEY',
    isLocal: false, recommendedMaxTokens: 32000, contextWindow: 128000,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [
      chatModel('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo', 128000, 32000),
    ],
  },
  hunyuan: {
    id: 'hunyuan', name: '腾讯混元',
    apiBase: 'https://hunyuan.tencentcloudapi.com',
    defaultModel: 'hunyuan-lite',
    apiKeyEnvVar: 'HUNYUAN_API_KEY',
    isLocal: false, recommendedMaxTokens: 32000, contextWindow: 128000,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [ chatModel('hunyuan-lite', 'Hunyuan Lite', 128000, 32000) ],
  },
  yi: {
    id: 'yi', name: '01.AI (Yi)',
    apiBase: 'https://api.lingyiwanwu.com/v1',
    defaultModel: 'yi-large',
    apiKeyEnvVar: 'YI_API_KEY',
    isLocal: false, recommendedMaxTokens: 8000, contextWindow: 16000,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [ chatModel('yi-large', 'Yi Large', 16000, 8000) ],
  },
  baichuan: {
    id: 'baichuan', name: '百川 AI',
    apiBase: 'https://api.baichuan-ai.com/v1',
    defaultModel: 'Baichuan4',
    apiKeyEnvVar: 'BAICHUAN_API_KEY',
    isLocal: false, recommendedMaxTokens: 4096, contextWindow: 192000,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [ chatModel('Baichuan4', 'Baichuan 4', 192000, 4096) ],
  },
  vllm: {
    id: 'vllm', name: 'vLLM',
    apiBase: 'http://localhost:8000/v1',
    defaultModel: '',
    isLocal: true, recommendedMaxTokens: 4096, contextWindow: 4096,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [],
  },
  ollama: {
    id: 'ollama', name: 'Ollama',
    apiBase: 'http://localhost:11434/v1',
    defaultModel: '',
    isLocal: true, recommendedMaxTokens: 4096, contextWindow: 4096,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [],
  },
  lm_studio: {
    id: 'lm_studio', name: 'LM Studio',
    apiBase: 'http://localhost:1234/v1',
    defaultModel: '',
    isLocal: true, recommendedMaxTokens: 4096, contextWindow: 4096,
    features: { chat: true, embeddings: true, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [],
  },
  custom_openai: {
    id: 'custom_openai', name: 'Custom (OpenAI compat)',
    apiBase: '',
    defaultModel: '',
    isLocal: false, recommendedMaxTokens: 4096, contextWindow: 4096,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [],
  },
  custom_anthropic: {
    id: 'custom_anthropic', name: 'Custom (Anthropic compat)',
    apiBase: '',
    defaultModel: '',
    isLocal: false, recommendedMaxTokens: 4096, contextWindow: 4096,
    features: { chat: true, embeddings: false, tts: false, imageGeneration: false, videoGeneration: false, musicGeneration: false, audioTranscription: false, vision: false },
    models: [],
  },
};

export function getAllProviders(): ProviderMetadata[] {
  return Object.values(PROVIDER_REGISTRY);
}

export function getProviderMetadata(id: string): ProviderMetadata | undefined {
  return PROVIDER_REGISTRY[id];
}

export function getProviderIds(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}
