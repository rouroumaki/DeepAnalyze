/**
 * Tool usage priority guidance, injected into Agent system prompts.
 * Guides the model to prefer specialized tools over general-purpose ones.
 *
 * Reference: Claude Code's "Using Your Tools" section.
 */

export function getToolGuidanceSection(): string {
  return `## 工具使用指南

### 优先使用专用工具
- 搜索文件名 → 使用 glob（而非 bash ls）
- 搜索文件内容 → 使用 grep（而非 bash grep）
- 读取文件 → 使用 read_file（而非 bash cat）
- 搜索知识库 → 使用 kb_search（而非 grep）

### 并行调用
- 当需要同时读取多个文件或执行多个独立搜索时，在一次响应中并行调用多个工具
- 独立的只读操作应该并行执行以提高效率

### 工具选择决策树
1. 需要知识库内容？→ kb_search → expand
2. 需要浏览文档结构？→ wiki_browse
3. 需要精确文本搜索？→ doc_grep
4. 需要 Shell 命令？→ bash（只读命令优先）
5. 需要修改文件？→ edit_file（精确替换）或 write_file（新文件）
6. 需要生成报告？→ report_generate
7. 需要多 Agent 协作？→ workflow_run`;
}
