# DeepAnalyze bigtest 知识库分析问题诊断报告

> 诊断时间: 2026-04-30
> 任务: bigtest 知识库全面深度分析 (222 文档)
> 后端日志时间: 07:19 ~ 07:40

---

## 一、问题总结

| # | 问题 | 严重性 | 类型 |
|---|------|--------|------|
| 1 | report_generate 生成的报告未保存到数据库/前端不可见 | 高 | 架构缺陷 |
| 2 | push_content 只推送了分类概览，详细分析内容未推送 | 高 | 架构缺陷 |
| 3 | 子 Agent (workflow_run) 的详细分析结果丢失 | 严重 | 架构缺陷 |
| 4 | JSON 解码错误 Invalid control character | 中 | Bug |
| 5 | glm-5.1 模型 Provider 频繁断连 | 中 | 稳定性问题 |
| 6 | 多处 Stuck intervention 触发 | 中 | Agent 行为问题 |

---

## 二、逐问题详细分析

### 问题 1: report_generate 报告未保存到数据库

**现象**: Agent 调用了 `report_generate` 工具（turn=21），前端显示"下载报告"和"查看报告页"按钮，但点击后没有内容。用户在后端报告库中也没有看到 4 月 30 日的新增报告。

**根因分析**:

report_generate 工具的实现位于 `src/tools/ReportTool/index.ts`（第 42-188 行）。它做了两件事：
1. 将报告内容写入 wiki 页面文件 `data/wiki/{kbId}/reports/{pageId}.md`（第 152-153 行）
2. 通过 `repos.wikiPage.create()` 创建 `page_type: "report"` 记录（第 159-168 行）

**问题出在两个地方**:

**(a) 事件总线未发射报告事件**

`event-bus.ts`（第 16 行）定义了 `report_generated` 事件类型，但 **ReportTool 中从未调用** `eventBus.emit({ type: "report_generated" })`。这意味着任何监听报告事件的组件都不会收到通知。

**(b) 错误静默吞没**

如果 `repos.wikiPage.create()` 失败（例如数据库连接问题），错误被 catch 后返回 `{ error: "Report generation failed: ..." }` 给 LLM。在 SSE 路由层（`agents.ts` 第 350-362 行），如果 `result` 中有 `error` 字段，`reportData` 就保持 null，前端永远不会收到报告数据。

**后端日志佐证**:
```
[AgentRunner] Tool call: turn=21, tool=report_generate, task=d353e9df
```
日志中只记录了工具调用，但没有记录报告保存成功或失败的状态。

**修复建议**:
1. 在 ReportTool 成功保存后发射 `eventBus.emit({ type: "report_generated", data: { reportId, title, kbId } })`
2. 在 SSE 路由中捕获 report_generate 的结果错误并通知前端
3. 添加日志记录报告保存的成功/失败状态

---

### 问题 2: push_content 只推送了分类概览

**现象**: 前端只看到了"bigtest知识库完整分类体系"（分类表格），但没有看到论文分析、剧本杀推理等详细内容。

**根因分析**:

push_content 工具位于 `tool-setup.ts`（第 604-681 行）。它的工作方式是：
1. Agent 调用 `push_content(type, title, data)`
2. 工具返回 `{ pushed: true, type, title, data, timestamp }`
3. SSE 路由层（`agents.ts` 第 364-378 行）捕获这个结果并发送 SSE 事件给前端

**核心问题**: 主 Agent 只调用了一次 `push_content`（推送分类概览），但没有继续推送详细分析内容。

**为什么没有继续推送？**

从后端日志可以看到执行流程：
```
turn=13: workflow_run（启动并行子 Agent）
turn=14-19: glob, bash, read_file（读取子 Agent 生成的文件）
turn=20: push_content（只推送了分类体系）
turn=21: report_generate（生成报告）
turn=22-23: agent_todo, finish
```

主 Agent 在读取子 Agent 文件后，选择直接跳到 `report_generate`，而不是逐步推送每个子 Agent 的分析结果。这是 LLM 的决策问题——模型认为 `report_generate` 已经包含了所有内容。

但实际上 `report_generate` 可能因为问题 1 而失败，导致前端两头都拿不到内容。

**修复建议**:
1. 在 workflow_run 完成后，自动提取每个子 Agent 的 output 和写入的文件路径，作为 workflow 结果的一部分返回给主 Agent
2. 在 workflow_run 工具描述中更强烈地要求主 Agent 推送每个子 Agent 的结果
3. 考虑在 WorkflowEngine 层面自动将子 Agent 的 `push_content` 调用转发到主 SSE 流

---

### 问题 3: 子 Agent 结果丢失（最严重）

**现象**: 4 个剧本杀子 Agent（agent_5241, agent_681, agent_688, agent_848）和论文分析子 Agent（paper_analyst）都生成了详细分析文件（如 `tmp/自杀派对分析.md`、`tmp/追凶手记分析.md`），但这些内容从未出现在前端。

**根因分析（架构级缺陷）**:

这是最深层的架构问题，涉及 SSE 和 WebSocket 两套通信机制的不统一。

**事件路由链路**:

```
子 Agent → WorkflowEngine → globalThis.__workflowEvents → WebSocket Handler → 前端
                                                          ↑
                                                          只走 WebSocket！
主 Agent → AgentRunner → SSE /run-stream → 前端
                          ↑
                          只走 SSE！
```

具体来说：
1. `workflow_run` 工具注册时（`agent-system.ts` 第 316-325 行）传入 `onEvent: deps.emitWs`
2. `emitWs` 回调将事件发射到 `globalThis.__workflowEvents`（全局 EventEmitter）
3. 这个 EventEmitter 只被 **WebSocket** 处理器（`ws.ts` 第 103 行）消费
4. SSE 路由（`agents.ts`）**不订阅** `globalThis.__workflowEvents`

**结果**:
- 如果前端通过 **SSE** 连接（/run-stream），子 Agent 的所有事件（包括 push_content、tool calls、输出）都**看不到**
- 如果前端通过 **WebSocket** 连接，可以看到子 Agent 事件，但 WebSocket 连接管理不如 SSE 稳定

**WorkflowResult 的信息截断**:

当子 Agent 完成后，WorkflowEngine 返回 `WorkflowResult` 给主 Agent。每个子 Agent 的输出被截断到 200 字符（`workflow-engine.ts` 第 1217-1218 行）：

```typescript
const short = r.output.length > 200
  ? r.output.substring(0, 200) + "..."
  : r.output;
```

这意味着即使主 Agent 收到了 workflow 结果，每个子 Agent 的详细分析也被严重截断。

**修复建议**:
1. **统一事件路由**: 让 SSE 路由也订阅 `globalThis.__workflowEvents`，将子 Agent 事件转发到 SSE 流
2. **移除截断**: 在 WorkflowResult 中返回完整的子 Agent 输出，而不是截断到 200 字符
3. **自动推送子 Agent 结果**: 在 WorkflowEngine 完成后，自动将子 Agent 的 `write_file` 和 `push_content` 结果转发到主 SSE 流
4. **增加 fileResults 字段**: 在 WorkflowResult 中增加 `files: { path, size }[]` 字段，列出子 Agent 写入的所有文件

---

### 问题 4: JSON 解码错误

**现象**: 后端日志出现两次：
```
json.decoder.JSONDecodeError: Invalid control character at: line 1 column 72001 (char 72000)
```

**根因分析**:

这个错误来自 Python 子进程（Docling 文档解析服务或 Whisper 语音识别服务）。

Python 的 `json.dumps()` 默认不转义所有控制字符（0x00-0x1F）。当解析的文档内容包含原始控制字符（PDF 中很常见）时，生成的 JSON 无效，导致接收方解析失败。

错误位置 "column 72001" 表明这是一个约 72KB 的 JSON payload，说明是文档解析的返回结果。

**修复建议**:
1. 在 Python 服务的 `json.dumps()` 调用中添加 `ensure_ascii=True`
2. 或者在发送前对数据做控制字符清理：`data = ''.join(c for c in data if ord(c) >= 32 or c in '\n\r\t')`
3. 影响位置：`docling-service/main.py` 第 57 行和 `whisper-service/main.py` 的类似位置

---

### 问题 5: glm-5.1 模型 Provider 断连

**现象**: 后端日志多次出现：
```
[AgentRunner] Stream primary (main: glm-5.1) failed (Network error from provider "glm-5.1": This operation was aborted), switching to fallback (summarizer: minimax-highspeed)
[AgentRunner] Transient error (attempt 1/5), retrying in 1000ms: Network error from provider "glm-5.1": fetch failed
```

**根因分析**:

glm-5.1 provider 的连接在长时间运行（特别是并发多个子 Agent）时频繁断开。这导致：
1. 主 Agent 在 turn 17 首次 fallback 到 minimax-highspeed
2. 子 Agent 也在不同位置触发 fallback
3. minimax-highspeed 作为 fallback 的能力不如 glm-5.1（特别是工具调用参数生成）

**影响**: 最终 Run complete 记录显示 `model=minimax-highspeed, fallback=true`，说明任务后半段完全运行在 fallback 模型上。

**修复建议**:
1. 增加网络重试次数和间隔（当前 5 次可能不够）
2. 检查 glm-5.1 的 API 速率限制和超时配置
3. 在并发子 Agent 时使用不同 provider 实例避免连接竞争

---

### 问题 6: Stuck intervention 频繁触发

**现象**: 后端日志出现大量 "Stuck intervention injected" 消息：
- paper_analyst 在 turn 7, 12, 14, 15
- agent_681 在 turn 6, 7
- agent_848 在 turn 8
- agent_5241 在 turn 8, 9
- 多个子子 Agent 也被注入

**根因分析**:

Stuck intervention 是当 Agent 连续多次调用同一工具时触发的干预机制。在这个场景中，子 Agent 频繁调用 `expand` 工具展开文档内容（每次调用 3-12 个并发 expand），被系统误判为"卡住"。

实际上这是正常行为——分析 222 个文档需要大量 expand 操作。当前的 stuck detection 阈值（同一工具连续调用 5 次）对于批量文档分析场景过于激进。

**修复建议**:
1. 对 `expand` 工具排除在 stuck detection 之外
2. 将 stuck detection 阈值从 5 次提高到 10-15 次
3. 区分"同一参数重复调用"（真正卡住）和"不同参数批量调用"（正常批量操作）

---

## 三、修复优先级

| 优先级 | 修复项 | 影响 | 复杂度 |
|--------|--------|------|--------|
| **P0** | SSE 路由订阅 workflow 事件（问题 3） | 子 Agent 结果对前端可见 | 中 |
| **P0** | WorkflowResult 移除 200 字符截断（问题 3） | 主 Agent 能获取完整分析 | 低 |
| **P1** | ReportTool 发射 report_generated 事件（问题 1） | 报告持久化通知 | 低 |
| **P1** | push_content 自动转发子 Agent 结果（问题 2+3） | 详细分析自动呈现 | 中 |
| **P2** | Python JSON 控制字符清理（问题 4） | 消除解码错误 | 低 |
| **P2** | Stuck detection 排除 expand（问题 6） | 消除误判干预 | 低 |
| **P3** | glm-5.1 连接稳定性（问题 5） | 减少 fallback | 配置调整 |
