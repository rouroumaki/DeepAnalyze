/**
 * Feature flags system.
 * Priority: env var > DB config > default
 *
 * Reference: Claude Code's GrowthBook feature flags
 */

export interface FeatureFlagConfig {
  concurrentToolExecution: boolean;
  promptCaching: boolean;
  streamingToolExecution: boolean;
  hierarchicalCompression: boolean;
  cacheEditing: boolean;
  longOutputContinuation: boolean;
  maxToolConcurrency: number;
  pluginSystem: boolean;
  markdownSkills: boolean;
}

const ENV_FLAG_MAP: Record<keyof FeatureFlagConfig, string> = {
  concurrentToolExecution: "DA_CONCURRENT_TOOLS",
  promptCaching: "DA_PROMPT_CACHING",
  streamingToolExecution: "DA_STREAMING_TOOLS",
  hierarchicalCompression: "DA_HIERARCHICAL_COMPACT",
  cacheEditing: "DA_CACHE_EDITING",
  longOutputContinuation: "DA_LONG_OUTPUT",
  maxToolConcurrency: "DA_MAX_CONCURRENCY",
  pluginSystem: "DA_PLUGINS",
  markdownSkills: "DA_MARKDOWN_SKILLS",
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlagConfig = {
  concurrentToolExecution: true,
  promptCaching: true,
  streamingToolExecution: false,
  hierarchicalCompression: false,
  cacheEditing: true,
  longOutputContinuation: true,
  maxToolConcurrency: 10,
  pluginSystem: true,
  markdownSkills: true,
};

/**
 * Resolve feature flags from env vars and DB config.
 * Priority: env var > dbConfig > defaults
 */
export function resolveFeatureFlags(
  dbConfig?: Partial<FeatureFlagConfig>,
): FeatureFlagConfig {
  const result = { ...DEFAULT_FEATURE_FLAGS };

  if (dbConfig) {
    Object.assign(result, dbConfig);
  }

  for (const [key, envName] of Object.entries(ENV_FLAG_MAP)) {
    const envValue = process.env[envName];
    if (envValue !== undefined) {
      if (key === "maxToolConcurrency") {
        (result as any)[key] = parseInt(envValue, 10);
      } else {
        (result as any)[key] = envValue === "true" || envValue === "1";
      }
    }
  }

  return result;
}
