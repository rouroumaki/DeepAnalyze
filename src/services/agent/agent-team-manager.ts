// =============================================================================
// DeepAnalyze - Agent Team Manager
// =============================================================================
// High-level manager for agent teams. Wraps the CRUD operations from
// agent-teams store and provides preset templates for common team patterns.
// =============================================================================

import {
  createTeam,
  getTeam,
  getTeamByName,
  listTeams,
  updateTeam,
  deleteTeam,
} from "../../store/agent-teams.js";
import type {
  AgentTeam,
  AgentTeamWithMembers,
  CreateTeamData,
  UpdateTeamData,
  TeamMode,
} from "../../store/agent-teams.js";

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

/** A preset template for creating a team quickly. */
export interface TeamTemplate {
  /** Unique template name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Scheduling mode for the workflow. */
  mode: TeamMode;
  /** Whether cross-review is enabled (council mode). */
  crossReview?: boolean;
  /** Pre-defined member definitions. */
  members: CreateTeamData["members"];
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const TEMPLATES: TeamTemplate[] = [
  {
    name: "研究管道",
    description: "通用文档研究流程：依次检索、分析、总结",
    mode: "pipeline",
    members: [
      {
        role: "检索员",
        task: "根据目标，检索和收集所有相关信息源",
        tools: ["kb_search", "web_search"],
        dependsOn: [],
        sortOrder: 0,
      },
      {
        role: "分析师",
        task: "对检索到的信息进行深度分析，识别关键模式和洞察",
        tools: ["*"],
        dependsOn: [],
        sortOrder: 1,
      },
      {
        role: "总结员",
        task: "将分析结果整合为结构化的总结报告",
        tools: ["think", "finish"],
        dependsOn: [],
        sortOrder: 2,
      },
    ],
  },
  {
    name: "多视角分析",
    description: "从不同视角平衡分析，然后交叉审查得出综合结论",
    mode: "council",
    crossReview: true,
    members: [
      {
        role: "安全分析师",
        task: "从安全合规角度分析问题",
        perspective: "安全与合规",
        tools: ["*"],
        dependsOn: [],
        sortOrder: 0,
      },
      {
        role: "性能分析师",
        task: "从性能和效率角度分析问题",
        perspective: "性能与效率",
        tools: ["*"],
        dependsOn: [],
        sortOrder: 1,
      },
      {
        role: "用户体验分析师",
        task: "从用户体验角度分析问题",
        perspective: "用户体验",
        tools: ["*"],
        dependsOn: [],
        sortOrder: 2,
      },
    ],
  },
  {
    name: "并行研究",
    description: "快速并行文档扫描，多个研究员同时工作",
    mode: "parallel",
    members: [
      {
        role: "研究员-文档",
        task: "搜索和整理文档中的关键信息",
        tools: ["kb_search"],
        dependsOn: [],
        sortOrder: 0,
      },
      {
        role: "研究员-网络",
        task: "搜索和整理网络上的相关补充信息",
        tools: ["web_search"],
        dependsOn: [],
        sortOrder: 1,
      },
      {
        role: "研究员-数据",
        task: "从数据角度分析和整理相关信息",
        tools: ["kb_search", "think"],
        dependsOn: [],
        sortOrder: 2,
      },
    ],
  },
  {
    name: "全面分析",
    description: "DAG驱动的复杂案件分析，依赖关系可控",
    mode: "graph",
    members: [
      {
        role: "初步调查员",
        task: "进行初步调查，收集基本事实和信息",
        tools: ["kb_search", "web_search"],
        dependsOn: [],
        sortOrder: 0,
      },
      {
        role: "深度分析师",
        task: "基于初步调查结果进行深度分析",
        tools: ["*"],
        dependsOn: ["agent-0"],
        sortOrder: 1,
      },
      {
        role: "验证员",
        task: "独立验证初步调查结果的真实性",
        tools: ["kb_search", "web_search"],
        dependsOn: ["agent-0"],
        sortOrder: 2,
      },
      {
        role: "报告员",
        task: "整合深度分析和验证结果，生成最终报告",
        tools: ["think", "finish"],
        dependsOn: ["agent-1", "agent-2"],
        sortOrder: 3,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// AgentTeamManager
// ---------------------------------------------------------------------------

/**
 * High-level manager for agent teams. Wraps the CRUD store functions and
 * provides preset templates for quickly spinning up common team patterns.
 *
 * Usage:
 *   const manager = new AgentTeamManager();
 *   const team = manager.createFromTemplate("研究管道", "我的研究项目");
 */
export class AgentTeamManager {
  // -----------------------------------------------------------------------
  // Delegated CRUD operations
  // -----------------------------------------------------------------------

  /** Get a team by its unique ID. */
  getTeam = getTeam;

  /** Look up a team by its unique name. */
  getTeamByName = getTeamByName;

  /** List all teams (without members), ordered by most recently updated. */
  listTeams = listTeams;

  /** Create a new team with members. */
  createTeam = createTeam;

  /** Partially update a team (and optionally replace its members). */
  updateTeam = updateTeam;

  /** Delete a team by ID. Returns true if the team existed and was deleted. */
  deleteTeam = deleteTeam;

  // -----------------------------------------------------------------------
  // Template API
  // -----------------------------------------------------------------------

  /**
   * Return all available preset templates. Each template describes a team
   * configuration (mode, members, etc.) that can be materialized via
   * {@link createFromTemplate}.
   */
  getTemplates(): TeamTemplate[] {
    return TEMPLATES;
  }

  /**
   * Find a template by its name.
   *
   * @param templateName - The `name` field of the template (e.g. "研究管道").
   * @returns The matching template, or `undefined` if not found.
   */
  getTemplate(templateName: string): TeamTemplate | undefined {
    return TEMPLATES.find((t) => t.name === templateName);
  }

  /**
   * Materialise a template into a persisted team.
   *
   * @param templateName - Name of the preset template to use.
   * @param customName   - Optional custom team name. If omitted the template
   *                       name is used as the team name.
   * @param extra        - Optional partial overrides applied on top of the
   *                       template data (e.g. custom description or model config).
   * @returns The newly created team with its members.
   * @throws Error if the template name does not match any preset.
   */
  createFromTemplate(
    templateName: string,
    customName?: string,
    extra?: Partial<Pick<CreateTeamData, "description" | "modelConfig" | "enableSkills" | "crossReview">>,
  ): AgentTeamWithMembers {
    const template = this.getTemplate(templateName);
    if (!template) {
      throw new Error(`Unknown team template: "${templateName}". Available: ${TEMPLATES.map((t) => t.name).join(", ")}`);
    }

    const data: CreateTeamData = {
      name: customName ?? template.name,
      description: extra?.description ?? template.description,
      mode: template.mode,
      crossReview: extra?.crossReview ?? template.crossReview ?? false,
      enableSkills: extra?.enableSkills ?? false,
      modelConfig: extra?.modelConfig,
      members: template.members,
    };

    return this.createTeam(data);
  }
}
