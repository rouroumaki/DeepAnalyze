import type { AgentDefinition } from "./types.js";
import type { SkillManifest } from "./skill-loader.js";
import { loadSkillsFromDir } from "./skill-loader.js";

// ---------------------------------------------------------------------------
// Plugin manifest (file-based)
// ---------------------------------------------------------------------------

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  capabilities: Array<"skills" | "agents" | "hooks" | "tools">;
  skills?: Array<{ dir: string }>;
  agents?: Array<{ file: string }>;
  hooks?: Record<string, string>;
  tools?: Array<{ file: string }>;
}

// ---------------------------------------------------------------------------
// Loaded plugin
// ---------------------------------------------------------------------------

export interface LoadedPlugin {
  manifest: PluginManifest;
  rootDir: string;
  skills: SkillManifest[];
  agents: AgentDefinition[];
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Plugin Manager (file-based)
// ---------------------------------------------------------------------------

/**
 * Manages plugin lifecycle for file-system-based plugins.
 * Loads plugins from directories containing plugin.json manifests.
 * Complements the DB-backed PluginManager in services/plugins/.
 */
export class AgentPluginManager {
  private plugins = new Map<string, LoadedPlugin>();

  /**
   * Load a plugin from a directory.
   * Expects: plugin.json + optional skills/ and agents/ subdirectories.
   */
  async loadPlugin(dirPath: string): Promise<LoadedPlugin> {
    const { readFile } = await import("fs/promises");
    const path = await import("path");

    const manifestPath = path.join(dirPath, "plugin.json");
    const manifestContent = await readFile(manifestPath, "utf-8");
    const manifest: PluginManifest = JSON.parse(manifestContent);

    const plugin: LoadedPlugin = {
      manifest,
      rootDir: dirPath,
      skills: [],
      agents: [],
      enabled: true,
    };

    // Load skills
    if (manifest.skills) {
      for (const skillRef of manifest.skills) {
        const skillDir = path.join(dirPath, skillRef.dir);
        try {
          const skills = await loadSkillsFromDir(skillDir);
          plugin.skills.push(...skills);
        } catch (err) {
          console.warn(`[AgentPluginManager] Failed to load skills from ${skillDir}:`, err);
        }
      }
    }

    // Load agents
    if (manifest.agents) {
      for (const agentRef of manifest.agents) {
        const agentFile = path.join(dirPath, agentRef.file);
        try {
          const content = await readFile(agentFile, "utf-8");
          const agentDef = parseAgentMd(content, path.basename(agentFile));
          plugin.agents.push(agentDef);
        } catch (err) {
          console.warn(`[AgentPluginManager] Failed to load agent from ${agentFile}:`, err);
        }
      }
    }

    this.plugins.set(manifest.name, plugin);
    return plugin;
  }

  /** Get all skills from all enabled plugins */
  getAllSkills(): SkillManifest[] {
    const skills: SkillManifest[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.enabled) skills.push(...plugin.skills);
    }
    return skills;
  }

  /** Get all agents from all enabled plugins */
  getAllAgents(): AgentDefinition[] {
    const agents: AgentDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.enabled) agents.push(...plugin.agents);
    }
    return agents;
  }

  /** Enable or disable a plugin */
  setEnabled(name: string, enabled: boolean): void {
    const plugin = this.plugins.get(name);
    if (plugin) plugin.enabled = enabled;
  }

  /** Unload a plugin */
  unload(name: string): boolean {
    return this.plugins.delete(name);
  }

  /** Get a loaded plugin by name */
  get(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  /** List all loaded plugins */
  list(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }
}

// ---------------------------------------------------------------------------
// Agent MD parser
// ---------------------------------------------------------------------------

/**
 * Parse an agent definition from a Markdown file.
 * Uses YAML frontmatter for metadata, body for system prompt.
 */
function parseAgentMd(content: string, fileName: string): AgentDefinition {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // No frontmatter — use entire content as system prompt
    return {
      agentType: fileName.replace(/\.md$/, ""),
      description: "",
      systemPrompt: content.trim(),
      tools: ["*"],
    };
  }

  const yaml = frontmatterMatch[1]!;
  const body = frontmatterMatch[2]!.trim();
  const meta = parseSimpleFrontmatter(yaml);

  return {
    agentType: (meta.agentType as string) ?? fileName.replace(/\.md$/, ""),
    description: (meta.description as string) ?? "",
    systemPrompt: body,
    tools: typeof meta.tools === "string"
      ? [meta.tools]
      : Array.isArray(meta.tools) ? meta.tools : ["*"],
    modelRole: meta["model-role"] as AgentDefinition["modelRole"],
    maxTurns: meta.maxTurns as number | undefined,
    readOnly: meta.readOnly as boolean | undefined,
  };
}

function parseSimpleFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const match = line.trim().match(/^([\w-]+):\s*(.*)$/);
    if (match) {
      const key = match[1]!;
      const value = match[2]!.trim();
      if (value.startsWith("[") && value.endsWith("]")) {
        result[key] = value.slice(1, -1).split(",").map(s => s.trim());
      } else if (value === "true") {
        result[key] = true;
      } else if (value === "false") {
        result[key] = false;
      } else if (!isNaN(Number(value))) {
        result[key] = Number(value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}
