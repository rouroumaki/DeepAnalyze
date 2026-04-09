// =============================================================================
// DeepAnalyze - Provider Registry
// =============================================================================
// Pre-configured provider metadata, ported from AIE_new's registry.py.
// Each provider has a default API base, default model, and env key hint.
// Users configure API keys through the web UI Settings tab.
// =============================================================================

export interface ProviderMetadata {
  id: string;
  name: string;
  defaultApiBase: string;
  defaultModel: string;
  envKey: string;
  /** Local providers don't require API keys (Ollama, vLLM, LM Studio) */
  isLocal: boolean;
}

/**
 * All known providers, keyed by ID.
 * Ported from AIE_new/backend/infra/llm/registry.py
 */
export const PROVIDER_REGISTRY: Record<string, ProviderMetadata> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    defaultApiBase: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-4.5-sonnet",
    envKey: "OPENROUTER_API_KEY",
    isLocal: false,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic (Claude)",
    defaultApiBase: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    envKey: "ANTHROPIC_API_KEY",
    isLocal: false,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultApiBase: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    envKey: "OPENAI_API_KEY",
    isLocal: false,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    defaultApiBase: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    envKey: "DEEPSEEK_API_KEY",
    isLocal: false,
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot AI / Kimi",
    defaultApiBase: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    envKey: "MOONSHOT_API_KEY",
    isLocal: false,
  },
  zhipu: {
    id: "zhipu",
    name: "Zhipu AI (智谱 GLM)",
    defaultApiBase: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    envKey: "ZHIPUAI_API_KEY",
    isLocal: false,
  },
  groq: {
    id: "groq",
    name: "Groq",
    defaultApiBase: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    envKey: "GROQ_API_KEY",
    isLocal: false,
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    defaultApiBase: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    envKey: "MISTRAL_API_KEY",
    isLocal: false,
  },
  qwen: {
    id: "qwen",
    name: "阿里云百炼 (Qwen)",
    defaultApiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    envKey: "DASHSCOPE_API_KEY",
    isLocal: false,
  },
  hunyuan: {
    id: "hunyuan",
    name: "腾讯混元",
    defaultApiBase: "https://hunyuan.tencentcloudapi.com",
    defaultModel: "hunyuan-lite",
    envKey: "HUNYUAN_API_KEY",
    isLocal: false,
  },
  ernie: {
    id: "ernie",
    name: "百度千帆 (文心)",
    defaultApiBase: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-8k",
    envKey: "QIANFAN_API_KEY",
    isLocal: false,
  },
  doubao: {
    id: "doubao",
    name: "字节火山引擎 (豆包)",
    defaultApiBase: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
    envKey: "ARK_API_KEY",
    isLocal: false,
  },
  yi: {
    id: "yi",
    name: "零一万物 (Yi)",
    defaultApiBase: "https://api.lingyiwanwu.com/v1",
    defaultModel: "yi-large",
    envKey: "YI_API_KEY",
    isLocal: false,
  },
  baichuan: {
    id: "baichuan",
    name: "百川 AI",
    defaultApiBase: "https://api.baichuan-ai.com/v1",
    defaultModel: "Baichuan4",
    envKey: "BAICHUAN_API_KEY",
    isLocal: false,
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    defaultApiBase: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-M2.7-highspeed",
    envKey: "MINIMAX_API_KEY",
    isLocal: false,
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    defaultApiBase: "https://api.cohere.com/v2",
    defaultModel: "command-r-plus",
    envKey: "COHERE_API_KEY",
    isLocal: false,
  },
  together_ai: {
    id: "together_ai",
    name: "Together AI",
    defaultApiBase: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    envKey: "TOGETHERAI_API_KEY",
    isLocal: false,
  },
  vllm: {
    id: "vllm",
    name: "vLLM",
    defaultApiBase: "http://localhost:8000/v1",
    defaultModel: "",
    envKey: "",
    isLocal: true,
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    defaultApiBase: "http://localhost:11434/v1",
    defaultModel: "qwen2.5:14b",
    envKey: "",
    isLocal: true,
  },
  lm_studio: {
    id: "lm_studio",
    name: "LM Studio",
    defaultApiBase: "http://localhost:1234/v1",
    defaultModel: "",
    envKey: "",
    isLocal: true,
  },
  custom_openai: {
    id: "custom_openai",
    name: "自定义接口 (OpenAI 兼容)",
    defaultApiBase: "",
    defaultModel: "",
    envKey: "",
    isLocal: false,
  },
};

/** Get all provider metadata as an array. */
export function getAllProviders(): ProviderMetadata[] {
  return Object.values(PROVIDER_REGISTRY);
}

/** Get a single provider by ID. */
export function getProviderMetadata(id: string): ProviderMetadata | undefined {
  return PROVIDER_REGISTRY[id];
}

/** Get all provider IDs. */
export function getProviderIds(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}
