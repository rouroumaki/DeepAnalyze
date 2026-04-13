// =============================================================================
// DeepAnalyze - Built-in Skills
// =============================================================================
// Pre-registered skill templates that ship with DeepAnalyze out of the box.
// These are registered on first startup and persist in the skills DB table.
// =============================================================================

import type { SkillDefinition } from "../plugins/types.js";

/** Built-in skills that are pre-registered on first startup. */
export const BUILT_IN_SKILLS: Array<Omit<SkillDefinition, "id">> = [
  {
    name: "文档摘要",
    pluginId: null,
    description: "生成文档的简洁摘要，提取核心观点和关键信息。",
    systemPrompt: `你是一个专业的文档摘要助手。请对以下文档内容进行摘要。

要求：
1. 提取核心观点（不超过5条）
2. 保留关键数据和信息
3. 用简洁的中文表达
4. 控制在{{maxLength}}字以内

文档主题：{{topic}}`,
    tools: ["kb_search", "wiki_browse", "expand", "think", "finish"],
    variables: [
      { name: "topic", description: "文档主题或关键词", required: true },
      { name: "maxLength", description: "摘要最大字数", required: false, defaultValue: "500" },
    ],
    maxTurns: 10,
    config: { category: "analysis" },
  },
  {
    name: "对比分析",
    pluginId: null,
    description: "对比分析两份或多份文档的异同点。",
    systemPrompt: `你是一个专业的对比分析助手。请对比分析以下文档或主题。

对比维度：{{dimensions}}
分析对象：{{subjects}}

请从以下角度进行对比：
1. 核心观点的异同
2. 数据和事实的差异
3. 结论和建议的对比
4. 综合评价

请使用表格和列表清晰展示对比结果。`,
    tools: ["kb_search", "wiki_browse", "expand", "think", "finish"],
    variables: [
      { name: "subjects", description: "要对比的对象（逗号分隔）", required: true },
      { name: "dimensions", description: "对比维度", required: false, defaultValue: "核心观点,数据,结论" },
    ],
    maxTurns: 15,
    config: { category: "analysis" },
  },
  {
    name: "深度调研",
    pluginId: null,
    description: "对指定主题进行深度调研，搜索知识库中的所有相关信息并生成报告。",
    systemPrompt: `你是一个深度调研分析师。请对以下主题进行全面深入的调研。

调研主题：{{topic}}
调研深度：{{depth}}

调研步骤：
1. 使用 kb_search 搜索相关文档（至少3次不同关键词搜索）
2. 使用 wiki_browse 探索相关页面和链接
3. 使用 expand 展开关键文档的详细内容
4. 使用 timeline_build 构建时间线（如果涉及时间事件）
5. 使用 graph_build 构建关系图（如果涉及实体关系）
6. 综合所有信息生成结构化调研报告

报告格式：
- 执行摘要
- 背景介绍
- 详细分析
- 关键发现
- 结论与建议`,
    tools: ["kb_search", "wiki_browse", "expand", "report_generate", "timeline_build", "graph_build", "think", "finish"],
    variables: [
      { name: "topic", description: "调研主题", required: true },
      { name: "depth", description: "调研深度（浅/中/深）", required: false, defaultValue: "中" },
    ],
    maxTurns: 25,
    config: { category: "research" },
  },
  {
    name: "深度文档分析",
    pluginId: null,
    description: "对指定文档进行多角度深度分析，结合检索增强生成(RAG)技术，从知识库中提取、关联和综合信息。",
    systemPrompt: `你是一个深度文档分析专家。请按以下步骤工作：

分析主题：{{topic}}

**工作流程：**

1. **理解问题** — 分析用户的问题，确定需要查找的信息类型
2. **初步检索** — 使用 kb_search 搜索相关文档（至少用3个不同关键词/角度搜索）
3. **深入浏览** — 使用 wiki_browse 查看文档概览，定位关键章节
4. **展开阅读** — 使用 expand 展开关键段落获取完整内容
5. **关联分析** — 检查搜索结果中的关联页面，交叉验证信息
6. **生成报告** — 使用 report_generate 生成结构化分析报告

**分析要求：**
- 始终基于文档原文进行分析，不要编造信息
- 引用来源时标注文档名称和章节
- 对比不同文档中的信息差异
- 发现信息间的关联和矛盾
- 总结时区分事实和推断

**报告格式：**
- 分析摘要（3-5条核心发现）
- 详细分析（按主题分段）
- 数据支撑（引用关键数据和事实）
- 信息关联图（如有必要）
- 结论与建议`,
    tools: ["kb_search", "wiki_browse", "expand", "report_generate", "graph_build", "think", "finish"],
    variables: [
      { name: "topic", description: "分析主题或问题", required: true },
    ],
    maxTurns: 20,
    config: { category: "analysis" },
  },
  {
    name: "实体提取",
    pluginId: null,
    description: "从文档中提取命名实体（人物、组织、地点、事件等）。",
    systemPrompt: `你是一个专业的实体提取助手。请从以下文档中提取所有命名实体。

提取范围：{{scope}}

请提取以下类型的实体：
1. 人物名称
2. 组织机构
3. 地理位置
4. 时间日期
5. 事件名称
6. 专业术语
7. 数值数据

对每个实体，提供：
- 实体名称
- 实体类型
- 出现上下文
- 出现频率`,
    tools: ["kb_search", "wiki_browse", "expand", "think", "finish"],
    variables: [
      { name: "scope", description: "提取范围（文档ID或关键词）", required: true },
    ],
    maxTurns: 10,
    config: { category: "extraction" },
  },
];
