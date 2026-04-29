/**
 * Skill loader supporting SKILL.md format (YAML frontmatter + Markdown body).
 * Also supports loading skills from directories containing SKILL.md files.
 */

export interface SkillManifest {
  name: string;
  description: string;
  tools: string[];
  modelRole?: string;
  scheduling?: "pipeline" | "graph" | "council" | "parallel" | "single";
  arguments?: Array<{ name: string; description: string; required: boolean }>;
  systemPrompt: string;
}

/**
 * Parse a SKILL.md file into a SkillManifest.
 * Format:
 * ---
 * description: Skill description
 * tools: [kb_search, expand]
 * model-role: main
 * ---
 *
 * # Skill system prompt here
 */
export function parseSkillMd(content: string, fileName: string): SkillManifest {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error(`Invalid SKILL.md format: ${fileName}. Missing frontmatter.`);
  }

  const yaml = frontmatterMatch[1]!;
  const body = frontmatterMatch[2]!.trim();
  const meta = parseSimpleYaml(yaml);

  return {
    name: fileName.replace(/\.md$/, "").replace(/SKILL$/, "").replace(/\/$/, ""),
    description: meta.description ?? "",
    tools: typeof meta.tools === "string"
      ? [meta.tools]
      : Array.isArray(meta.tools) ? meta.tools : ["*"],
    modelRole: meta["model-role"] ?? "main",
    scheduling: meta.scheduling as SkillManifest["scheduling"],
    arguments: meta.arguments as SkillManifest["arguments"],
    systemPrompt: body,
  };
}

/**
 * Load all SKILL.md files from a directory.
 */
export async function loadSkillsFromDir(dirPath: string): Promise<SkillManifest[]> {
  const { readdir, readFile, stat } = await import("fs/promises");
  const path = await import("path");

  const skills: SkillManifest[] = [];
  let entries;

  try {
    entries = await readdir(dirPath);
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        const skillFile = path.join(fullPath, "SKILL.md");
        try {
          const content = await readFile(skillFile, "utf-8");
          skills.push(parseSkillMd(content, entry));
        } catch { /* no SKILL.md */ }
      } else if (entry.endsWith(".md")) {
        const content = await readFile(fullPath, "utf-8");
        skills.push(parseSkillMd(content, entry));
      }
    } catch { /* skip */ }
  }

  return skills;
}

/**
 * Simple YAML parser for frontmatter.
 * Handles: key: value, key: [a, b], and - list items.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey = "";
  let currentArray: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && currentKey) {
      currentArray.push(trimmed.slice(2).trim());
      continue;
    }

    // Flush previous array
    if (currentKey && currentArray.length > 0) {
      result[currentKey] = currentArray;
      currentArray = [];
    }

    const kvMatch = trimmed.match(/^([\w-]+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1]!;
      const value = kvMatch[2]!.trim();

      if (value.startsWith("[") && value.endsWith("]")) {
        result[currentKey] = value.slice(1, -1).split(",").map(s => s.trim());
        currentKey = "";
      } else if (value) {
        result[currentKey] = value;
        currentKey = "";
      } else {
        currentArray = [];
      }
    }
  }

  if (currentKey && currentArray.length > 0) {
    result[currentKey] = currentArray;
  }

  return result;
}
