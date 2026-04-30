# DeepAnalyze 软件需求清单
# 0.软件核心要求与诉求：一切不确定的技术选择或方案选择，都可以回到本软件核心设计目标出发来规划与设计：
# 0.1本软件核心是构建通用Agent，支持各种通用Agent场景的使用，通过各种plugin和skills和模型能力的加持，能够完成各种复杂和挑战性任务，通用Agent核心目标就是要能够支持无限长度的上下文文本，无限多的文档数量，无限复杂的工具调用，无限多步的操作目标，在这样的情况下都能够通过优秀的Agent loop循环，上下文自动化管理，优秀的记忆系统，优秀的工程设计等来有效的利用模型有限的上下文能力，有限的输入输出长度，有限的各种约束条件下最终达成希望达成的通用Agent的核心目标
# 0.2本软件还有另外一套核心设计是知识库系统，这套系统核心是希望把多种多样复杂的结构化和非结构化数据都能够作为输入源入库，入库时利用Docling系统和模型能力持续优化入库的质量，增加不同类型数据的支持，保持信息的完整结构，方便后续模型Agent能够利用
# 0.3Agent能够基于指定知识库和指定文档进行深入分析，利用知识库准确的信息提取和Agent无限迭代交错式推理完成复杂任务的能力，能够完成非常复杂的跨海量文档和数据的综合分析和处理工作。
# 0.4Agent应该充分利用多Agent能力，充分利用Docling的并行处理能力，充分利用软硬件的能力，实现质量优先情况下的性能效率和性能的极致优化
# 0.5在任何未确定方案和设计，需要方案和设计选择的时候，始终从以上章节0的原则和目标出发来考虑设计并保持和以下软件需求的架构一致性和融合合理性。
> 整理日期：2026-04-20 | 基于 2026-04-08 ~ 2026-04-19 全部设计文档，仅保留最新版本

---

## 一、核心需求

### 1. 系统定位与能力

| ID | 需求 |
|----|------|
| C-01 | 通用型 Agent ，支持各种通用Agent使用场景，同时支持驱动深度文档分析平台，通过 Plugin/Skill等适配不同垂直场景 |
| C-02 | Agent 多轮深度分析：TAOR 循环（Think-Act-Observe-Reflect），父子 Agent 调度，自动上下文自动管理和压缩，支持无限长度session和无限长度任务执行 |
| C-03 | 知识预编译：文档摄入时完成分层编译 |
| C-04 | 无损可溯源：所有基于知识库的分析结论可逐层追溯到原始文档精确位置（锚点级 docId:type:index） |
| C-05 | 通用可扩展：Plugin/Skill/MCP 机制，核心系统与领域逻辑解耦。Skill 系统支持用户通过 Markdown 定义自定义 Agent 行为；MCP 协议支持动态加载外部工具服务器 |
| C-06 | 单机一体化部署：单进程启动（Bun），支持离线运行，Docker-compose 部署 |

### 2. 三层数据模型

| ID | 需求 |
|----|------|
| C-07 | 预编译知识以Raw(L2)/Structure(L1)/Abstract(L0) 三层架构存储 |
| C-08 | Raw 层：完整保留 Docling 解析的结构化 JSON，对于Docling不支持的格式通过对应模型处理完的原始文档也属于Raw层，按需读取，Raw层构建原始数据的确定性锚点 |
| C-09 | Structure 层：从 Raw层利用Docling自带能力自动导出的 DocTags/Markdown，按章节分块，不需要 LLM ，注意需要同时导出留存DocTags/Markdown两种格式|
| C-10 | Abstract 层：LLM 从 Structure 生成文档描述摘要（不超过300字）+ 标签 + 文档类型 |
| C-11 | 信息零损失：标题层级、表格坐标、图片位置、页码、阅读顺序等结构化信息全部保留 |
| C-12 | 多模态统一：PDF/Word/Excel/图片/音频/视频全部输出相同三层结构，处理方式参考下章节，前端界面提供3层数据的点击按钮，点击后可分别预览，支持各种格式预览。**表格特殊策略**：所有表格文件统一生成元数据描述（sheet 信息/列定义/样本行/源文件路径），Agent 始终可通过 `bash+pandas` 处理源文件；小表格（<=1000行）额外存储全量内容转换作为知识库补充 |

### 3. 多模态处理

| ID | 需求 |
|----|------|
| C-13 | 文档，图片，音频：包括各种pdf/doc/docx/execl/Markdown/txt/html，图片，音频等所有Docling支持的格式，优先使用Docling解析，以Docling统一的通用Docling JSON原始格式导出到Raw层 |
| C-14 | 图片增强：图片默认使用 ImageProcessor（含 VLM 视觉描述 + Docling OCR + EXIF 拍摄信息 + 缩略图），优先于纯 Docling 处理。Docling 作为 OCR 子步骤被 ImageProcessor 内部调用。VLM 支持多提供商多协议：MiniMax 走 Token Plan VLM 专用端点（`/v1/coding_plan/vlm`），Qwen/OpenAI/Gemini 等走 OpenAI 兼容 Vision 格式（`/chat/completions`` + `image_url`），运行时按 provider endpoint 自动检测协议。VLM 调用需有独立重试机制（超时/API 错误重试 2 次）。图片仅提供 Auto 通道（ImageProcessor 已包含完整管道） |
| C-15 | 音频增强：音频使用 Docling 优先解析，Docling 失败时自动降级到配置的 ASR 模型解析（支持发言人分离标记）。ASR 调用失败时应触发重新处理。所有音频信息提取成 Docling JSON 格式兼容的原始格式导出到 Raw 层。**本地 Whisper ASR**：作为默认 ASR 后端（通过 SubprocessManager 管理 Python whisper 子进程，随系统启动），远程 ASR 作为可选备选。ASR 降级链：远程 API → 本地 Whisper → 提示不可用 |
| C-16 | 视频：Docling不支持视频解析，用户可以配置视频理解模型对视频进行解析，视频理解模型对视频内容转写成内容描述的文本，关键画面/对话时间对齐内容信息描述，提取成Docling JSON格式兼容的原始格式导出到Raw层 |
| C-17 | 所有文件类型原文件可在软件知识库的对应文档中选择 Raw 层按钮进行预览/流式播放：图片直接渲染、音频带播放器+转写同步、视频带播放器+字幕。媒体文件 `/original` 路由提供正确的 Content-Type（image/jpeg, audio/mpeg, video/mp4 等），支持 HTTP Range 请求（音频/视频拖拽） |

### 4. 知识检索

| ID | 需求 |
|----|------|
| C-18 | 提供多样化的融合检索能力：向量 + BM25 + RRF 融合排序，这部分检索能力由软件针对知识库按不同层级Raw，Structure，Abstract提供，界面可选在哪些层进行检索召回测试，Agent自己使用的时候根据自己需求调整参数进行自动化的检索查找，一般Agent集中在Structure层自己检索和整合数据，但同时保留对其他层的访问和调用能力 |
| C-19 | Agent支持类Claude code的grep检索方式，可参考refcode中claude code的grep检索方案在structure层按需自己多步迭代和检索已经提取处理的DocTags/Markdown信息，层次递进的多步分阶段精准搜索 |
| C-20 | Raw 层按需访问：通过前期的检索确定锚点定位后按需读取原始 JSON 片段，确保最终信息准确 |
| C-21 | 检索结果携带锚点 ID，支持最终输出内容中对关键信息链接到RAW，实现精准溯源 |

### 5. Agent 体系

| ID | 需求 |
|----|------|
| C-22 | TAOR 循环 Agent 引擎，保留 Claude Code harness 的核心能力，参考代码在refcode的claude code中。支持异步子Agent、团队信箱通信、递归派生防护、工具延迟加载 |
| C-23 | 主/辅模型分离：主 Agent 用主模型，子 Agent 用辅助模型，故障自动切换（仅限 chat 能力的 provider，通过角色分配 + 关键词启发式过滤 embedding/tts/image 等非 chat provider） |
| C-24 | 由Agent teams人工触发可支持五种调度模式：顺序 / 并行 / 委员会（多视角投票）/ 图谱（DAG 依赖）/ 单Agent委托（single，跳过编排开销直接执行） |
| C-25 | WorkflowEngine 支持取消、结果持久化、Council Round2 并行执行 |
| C-26 | 工具体系：双层架构 — 高级工具(kb_search/wiki_browse/expand/doc_grep/report_generate/timeline_build) + 底层工具(bash/read_file/write_file/edit_file/run_sql/grep/glob) + 生成工具(tts/image/video/music_generate) + 交互工具(ask_user/push_content/agent_todo) + 协作工具(workflow_run/task_output/send_message) + 扩展工具(skill_invoke/tool_discover/MCP动态工具)，browser 基于 Playwright |
| C-27 | 上下文管理：复刻Claude code实现无限上下文和全自动管理包括不限于自动压缩、微压缩、会话记忆持久化等 |
| C-27a | 语言跟随：Agent 自动使用与用户提问相同的语言进行思考和回复（包括 think 工具推理），所有系统提示词和工具描述默认使用中文 |
| C-27b | Agent 自主阅读原则：系统只提供客观的能力信号（tokenCount、截断提示、层级信息），不通过提示词限制或约定工具使用方式；LLM 自主决定阅读深度、次数和策略；系统侧移除技术约束（如 expand 结果的 token 限制适当放大），而非通过提示词约束 LLM 行为 |

### 6. Provider 与模型

| ID | 需求 |
|----|------|
| C-28 | 支持 22+ LLM Provider（OpenAI/Anthropic/DeepSeek/通义/智谱/MiniMax 等），含 Qwen 3.6-plus 多模态模型（支持图像/视频输入） |
| C-29 | 模型角色分为：主模型 / 辅助模型 / 嵌入模型 / 图像理解(VLM) / ASR / 视频理解 / 生成模型（图像/视频/音乐/语音） |
| C-30 | 图像理解(VLM)：独立配置入口，支持配置任意 OpenAI 兼容或 MiniMax 的 VLM provider，按 endpoint 自动选择协议。生成模型：包含图像生成、视频生成、音乐生成、语音生成(TTS)，归类在"生成模型" Tab 下。ASR 和视频理解各有独立配置入口 |
| C-31 | Thinking/Reasoning 参数按厂商规范传递 |
| C-32 | 嵌入模型可切换，维度不同时后台异步重索引 |

### 7. 数据库

| ID | 需求 |
|----|------|
| C-33 | PostgreSQL + pgvector + zhparser |
| C-34 | 百万级向量 HNSW 索引检索 <100ms |
| C-35 | 中文全文检索（jieba 级分词） |
| C-36 | Repository 抽象层（18 个接口），业务代码不直接操作 SQL |

### 8. 前端（核心）

| ID | 需求 |
|----|------|
| C-37 | 知识库统一页面：文档/Wiki/搜索合并，按文件类型自动渲染不同卡片 |
| C-38 | L0/L1/L2 按钮交互：灰色未就绪 / 绿色可预览，点击展开/折叠，编译完成逐层变绿。大内容（>5000行）自动启用虚拟滚动，仅渲染可视区域 |
| C-39 | 多媒体播放器：图片查看器、音频播放器（同步转写+发言人标签）、视频播放器（场景同步+关键帧时间线） |
| C-40 | 统一搜索栏：语义/向量/混合模式 + 召回数 + 层级选择 |
| C-41 | Agent 逐 token 流式响应（SSE content_delta）+ 子任务可视化 + 工具调用展示 + 实时 token 用量（turn_usage）。前端 appendStreamContent 逐字累积显示，onContent 回调设长度守卫防止覆盖更新的 delta 内容。工具调用信息可选持久化到消息 metadata，前端开关控制是否在历史消息中显示 |
| C-42 | 报告嵌入聊天，引用标记可悬停预览来源 |

### 9. 系统健壮性

| ID | 需求 |
|----|------|
| C-43 | 能力感知调度：自动感知可用能力，Provider 变更后能力自动更新；非 chat 能力（VLM/TTS/图片生成等）通过 CapabilityDispatcher 统一分发，按 provider 类型自动选择 API 协议 |
| C-44 | 熔断机制：连续 3 次失败切换到辅助模型，超时后半开恢复；回退时通过角色分配+关键词启发式排除非 chat provider（embedding/tts/image/video/music/audio） |
| C-45 | 降级链：增强模型 → 询问用户 → Skill → 明确告知不可用 |
| C-46 | 事件驱动架构：文档处理、Agent 任务、知识复合、报告生成通过事件总线联动 |
| C-47 | Agent 具备 `push_content` 工具，可推送结构化数据卡片到前端界面。**仅限特殊场景**：大型表格数据（type=table）、多段内容快速合并（type=markdown）、代码片段等。普通分析文本应直接流式输出（用户实时看到逐字显示），不得用 push_content 替代流式输出。支持类型：table/markdown/text/code/file/image |
| C-48 | 前端聊天窗口支持渲染 Agent 推送的结构化内容（可折叠表格、代码块、文件预览），推送数据持久化到消息 metadata，刷新后仍可见 |
| C-49 | DocTags 乱码自动检测：当 Docling 输出含异常 Unicode 字符（自定义字体编码导致），系统自动检测（非标准字符占比>15%阈值）并清空 doctags，降级到 Markdown 输出，确保 Structure 层内容可读 |
| C-50 | Agent 多轮上下文聚焦：评估当前问题与历史上下文的相关性，聚焦于当前问题的核心意图；相关追问时深入细化，主题切换时重新聚焦，不重复之前的全面分析流程 |
| C-51 | Agent 长内容生成策略：流式输出已支持逐 token 显示，优先直接流式输出分析正文。当内容超长时，通过分章节流式输出、bash 追加写入临时文件后合并、push_content 推送大型表格数据等方式，突破单次输出长度限制，实现多轮迭代完成完整内容 |
| C-52 | 报告生成按需触发：Agent 默认直接在对话中输出分析结果，仅在用户明确要求生成报告、按特定格式输出或保存分析结果时才调用 report_generate。报告生成前先将完整内容输出到对话中 |
| C-53 | 聊天消息显示顺序：助手消息按"工具调用(顶部) → 推理过程/推送内容(中部) → 最终结果/报告(底部)"排列，流式输出时工具调用和推理模块同步增长 |
| C-54 | Agent 深度分析原则：禁止基于搜索摘要做分析，必须通过 expand 工具逐层深入阅读完整文档内容后再分析；禁止幻觉，所有结论必须基于文档原文；不能遗漏细节，必须逐一展开阅读每个相关文档 |
| C-55 | Agent 三阶段工作流：全面发现（wiki_browse+多角度kb_search建立完整文档清单）→ 逐一深入阅读（expand 阅读清单中每个文档的完整内容，未全部读完不输出分析）→ 系统化分析与输出（分章节详细输出）。严格反幻觉：未 expand 阅读的文档不得编写详细分析 |

---

## 二、一般需求

### 1. 文档处理

| ID | 需求 |
|----|------|
| G-01 | Docling 单例进程 + Python 线程池并发，队列 slot 并发控制。并行度默认 5，前端"文档处理" Tab 可在线调整（1-10 范围），实时生效 |
| G-02 | 非阻塞上传：后台运行，按文件类型可配置超时（PDF/DOCX/XLSX/音频 10min, PPTX/MP4 15min），3 次自动重试，指数退避（5s/10s/20s）。增强模型调用（VLM/ASR/TTS 等）失败也需独立重试 |
| G-03 | WebSocket 断线回退轮询（每 3s） |
| G-04 | 文件夹上传（webkitdirectory） |
| G-05 | 文档删除完整级联清理（嵌入→锚点→链接→页面→文件→记录）；知识库删除同时清理 generated/ 目录，前端删除后自动导航离开并乐观更新状态 |
| G-06 | 精细化进度追踪：上传(0-5%) → 排队 → 解析 → 编译 → 索引 → 链接 → 就绪 |
| G-07 | Docling 模型可插拔管理，前端"文档处理"配置面板 |

### 2. 前端（一般）

| ID | 需求 |
|----|------|
| G-08 | 浅色/深色主题切换（浅色默认，深色可选） |
| G-09 | Header 功能按钮组：会话/技能/插件/定时/设置/Teams |
| G-10 | 右侧滑出面板系统（560px），内容感知切换 |
| G-11 | 设置面板多 Tab：主模型 / 辅助模型 / 嵌入模型 / 图像理解 / ASR / 视频理解 / 生成模型 / 文档处理 / 通用。图标紧凑排列，一排可见所有 Tab |
| G-12 | Teams 管理面板从知识库迁移到 Header 右侧面板 |
| G-13 | TeamEditor 完整字段：tools/dependsOn/perspective/systemPrompt |
| G-14 | 聊天页文件上传，无关联 KB 时自动创建临时知识库 |
| G-15 | 跨知识库搜索，结果标注来源 KB |
| G-16 | 报告支持 PDF/Markdown 导出 |
| G-17 | localStorage 持久化：主题/当前会话/当前 KB/侧边栏状态 |
| G-18 | DOMPurify XSS 防护 |

### 3. 工具与通信

| ID | 需求 |
|----|------|
| G-19 | web_search 支持三种后端：SearXNG（自部署）、Serper API（云端）、MiniMax（Token Plan）。通过环境变量 `SEARCH_BACKEND` 切换 |
| G-20 | 通信渠道管理：飞书/钉钉/微信/QQ/Telegram/Discord 互联 |
| G-21 | 定时任务系统（Cron 表达式），前端管理面板 |
| G-22 | 前后端通信：REST（CRUD）+ SSE（Agent 流式）+ WebSocket（进度推送） |

### 4. 配置与部署

| ID | 需求 |
|----|------|
| G-23 | 配置保存后实时生效，无需重启 |
| G-24 | YAML 配置文件作为 DB 配置的 fallback |
| G-25 | Docker Compose 一键部署（PG + 主服务 + Docling） |
| G-26 | 数据目录可配置，支持外部存储 |
| G-27 | 双名称体系：内部 UUID + 用户可见原始文件名 |
| G-28 | 文档处理通道选择与重新处理：每个文档卡片提供通道选择下拉框和重新生成按钮。通道选项按文件类型智能适配：PDF/DOCX/PPTX→{Auto, Docling, Native}；音频→{Auto, Docling, ASR}；Excel→{Auto, Native, Docling}；图片→{Auto}（ImageProcessor 已含完整管道）。选择不同于当前已完成方案的通道后点击重新生成，自动以选定通道重新解析并重建 L2→L1→L0 全链路。解析失败（如 ASR 404、VLM 超时、乱码等）也应可手动触发重新生成 |
| G-29 | Playwright E2E 测试框架：基于 @playwright/test，覆盖核心 API（健康检查、知识库 CRUD、搜索、设置、会话、定时任务），支持截图和 trace 记录，CI 可集成 |

---

## 三、冻结 / 不做

| ID | 说明 | 原因 |
|----|------|------|
| F-01 | 跨文档链接构建 / 知识图谱可视化 | 锚点已覆盖核心追溯，链接构建成本高，当前暂停开发，代码不删除但不调用 |
| F-02 | 用户认证与权限系统 | users 表已存在但未启用，后续按需 |
| F-03 | 移动端响应式 | 后续按需 |
| F-04 | 多语言 i18n | 后续按需 |
| F-05 | 消息分页 / 搜索缓存 | 后续按需 |
| F-06 | 插件市场 | 后续按需 |
| F-07 | 3D 生成能力 | 保留配置入口，暂不实现 |
| F-08 | 实时流式 ASR | 后续按需 |

---

## 四、前期需求变更处理记录

| 冲突 | 早期版本 | 最终版本 |
|------|---------|---------|
| 数据分层 | L0摘要/L1概览/L2全文 (04-08) | **Raw L2/Structure L1/Abstract L0** (04-15) |
| 数据库 | SQLite (04-08) | **PostgreSQL + pgvector** (04-15/17) |
| 知识库 UI | 文档/Wiki/搜索三个 Tab (04-08) | **统一单页面** (04-18) |
| 视频处理 | 帧采样+逐帧VLM (04-13) | **视频理解模型+音频轨转写** (04-18) |
| 知识链接/图谱 | 完整链接体系 (04-08) | **冻结**，锚点系统替代 (04-15) |
| Structure 层生成 | LLM 生成概览 (04-08) | **Docling 直接导出，不需要 LLM** (04-15) |
| Teams 位置 | 知识库页面内的 Tab (04-12) | **Header 右侧面板** (04-18) |
| Chat 降级 | 仅角色分配过滤 | **角色分配 + 关键词启发式双重过滤** (04-21) |
| 语言跟随 | 无显式要求 | **Agent 自动跟随用户语言，系统提示词/工具描述中文化** (04-21) |
| KB 删除 | 仅数据库级联 | **增加 generated/ 清理 + 前端导航优化** (04-21) |
| Agent 阅读策略 | 无显式要求 | **C-27b: Agent 自主阅读原则，系统只提供信号不约束行为** (04-21) |
| 图片处理 | Docling OCR | **ImageProcessor(VLM+OCR+EXIF) 优先，Docling 作为 OCR 子步骤** (04-22) |
| 音频降级 | 无降级 | **Docling 失败自动降级 ASR** (04-22) |
| 队列超时 | 120s 硬编码 | **按文件类型可配置（10-15min）** (04-22) |
| 错误重试 | 无 | **3 次自动重试 + 指数退避** (04-22) |
| Docling 运行 | 每次创建进程 | **单例进程 + Python 线程池并发** (04-22) |
| 处理通道 | 无选择 | **按文件可选择不同处理通道重新处理** (04-22) |
| VLM 路由 | 单一 chat 调用 | **CapabilityDispatcher 多协议自动分发：MiniMax Token Plan VLM + OpenAI 兼容 Vision** (04-22) |
| Qwen 多模态 | 仅 Qwen VL 专用模型 | **Qwen 3.6-plus 支持多模态输入（图像/视频），可直接作为 VLM 角色** (04-22) |
| 处理器降级 | 仅处理失败降级 | **空内容也触发降级（parseWithFallback 检测 success=true 但 text 为空的情况）** (04-22) |
| 并行度 | 固定 Semaphore(2) | **默认 5，前端"文档处理"Tab 可在线调整 1-10** (04-22) |
| 模型分类 | 主/辅/嵌入/增强 | **主/辅/嵌入/图像理解/ASR/视频理解/生成模型（图像/视频/音乐/TTS）** (04-22) |
| 设置 Tab | 增强模型含所有能力 | **拆分为独立 Tab：图像理解(VLM) / ASR / 视频理解 / 生成模型，增强→生成模型改名** (04-22) |
| 重新处理 | 选择通道后无操作 | **下拉选通道+重新生成按钮，选定后自动重建 L2→L1→L0，通道按文件类型智能适配** (04-22) |
| 增强模型重试 | 无 | **VLM/ASR 等增强模型调用失败需独立重试（2 次重试 + 指数退避）** (04-22) |
| 表格处理策略 | 全量内容转换入库 | **全量元数据描述 + 条件全量转换（<=1000行额外全量），Agent 始终可用 pandas 处理源文件** (04-23) |
| 大内容预览 | 无虚拟化 | **C-38 补充：大内容自动启用虚拟滚动** (04-23) |
| 工具调用持久化 | 刷新丢失 | **C-41 补充：工具调用可选持久化显示（前端开关）** (04-23) |
| 数据推送能力 | 仅模型文本输出 | **C-47/C-48: push_content 工具直接推送结构化数据到前端** (04-23) |
| Agent 轮次上限 | 前端默认 50 轮 | **默认无限制(-1)，选项含 9999** (04-23) |
| 音频 ASR | 远程 ASR | **本地 Whisper ASR 作为默认后端（SubprocessManager 管理），远程 ASR 可选备选** (04-23) |
| 媒体 Content-Type | text/plain | **正确 MIME 类型 + Range 请求支持** (04-23) |
| 浏览器工具 | 无 | **C-26 补充：browser 工具（Playwright），支持导航/截图/提取/交互** (04-23) |
| web_search 后端 | SearXNG + Serper | **+MiniMax 三后端，环境变量切换** (04-23) |
| DocTags 乱码 | 无检测 | **C-49: DocTags 乱码自动检测+降级到 Markdown** (04-23) |
| E2E 测试 | 无 | **G-29: Playwright E2E 测试框架** (04-23) |
| Agent 上下文 | 无聚焦策略 | **C-50: 多轮上下文聚焦，评估相关性后决定搜索范围** (04-24) |
| 长内容输出 | 单次输出压缩 | **C-51: 分章节迭代+push_content+bash追加，突破输出长度限制** (04-24) |
| 报告生成 | 深度分析主动生成 | **C-52: 默认直接输出，仅用户明确要求时才调用 report_generate** (04-24) |
| 消息显示顺序 | 结果在上/工具在下 | **C-53: 工具调用(上)→推理过程(中)→结果报告(下)** (04-24) |
| 表格溢出 | 无 overflow 控制 | **前端 markdown.css 表格 display:block+overflow-x:auto+word-break** (04-24) |
| Agent 分析深度 | 搜索摘要即做结论 | **C-54: 深度分析原则，必须 expand 阅读完整文档后再分析，禁止基于摘要做结论** (04-24) |
| Agent 工作流 | 无阶段约束，阅读/输出混合 | **C-55: 三阶段工作流（发现→阅读→分析），严格反幻觉规则** (04-24) |
| Agent 提示词 | 过长、硬编码工作流步骤 | **C-56: 提示词精简通用（≤30行核心指令），不硬编码工作流步骤，Agent 自主判断工作方式** (04-24) |
| 并行分析 | 单 Agent 链路 | **C-57: Agent 自主调用 workflow_run 启动多 Agent 并行工作流（并行深度检索/全面深度分析/通用并行检索）** (04-24) |
| 任务跟踪 | 无 | **C-58: agent_todo 工具，Agent 自主创建/更新任务清单，进度通过 SSE 实时推送** (04-24) |
| Todo 可视化 | 无 | **C-59: 聊天界面 TodoPanel 实时显示任务进度（pending/in_progress/completed）** (04-24) |
| 并行监控 | SubAgentPanel 仅团队页 | **C-60: 聊天界面嵌入 SubAgentPanel，多 Agent 并行工作时实时显示各子 Agent 状态** (04-24) |
| SSE 事件 | push_content/tool_call | **C-61: SSE 新增 todo_update + workflow_complete 事件，子 Agent 结果实时推送前端** (04-24) |
| 团队模板 | 7 个内置模板 | **C-62: 新增"通用并行检索"模板（3 Agent parallel：语义+精确+文档浏览）** (04-24) |
| 报告污染 | 旧报告影响分析 | **C-63: kb_search 默认排除 report 页面类型，Agent 分析基于原始文档一手内容** (04-24) |
| Markdown 推送 | push_content 折叠不可读 | **C-64: PushContentCard 对 type=markdown 直接渲染富文本（marked+DOMPurify），默认展开不折叠** (04-24) |
| 文档发现 | Agent 只能搜索命名文档 | **C-65: wiki_browse 新增 listDocuments 模式，一次性列出 KB 中所有文档+L0摘要+按目录/文件类型自动分类统计** (04-24) |
| 批量展开 | 逐个 expand 效率低 | **C-66: expand 工具新增 docIds 数组参数，支持一次调用批量展开多个文档 L1 结构** (04-24) |
| 精确搜索 | 只有语义搜索无正则 | **C-67: 新增 doc_grep 工具，正则搜索 wiki 页面内容，支持精确匹配人名/日期/编号/金额** (04-25) |
| 交互确认 | Agent 遇不确定只能猜 | **C-68: 新增 ask_user 工具，Agent 分析过程中可向用户提问确认，SSE 推送问题+POST 回复** (04-25) |
| 文档覆盖 | 大量文档被遗漏 | **C-69: Agent 全面分析时需先用 listDocuments 了解全貌，按类别批量 expand，确保系统性覆盖** (04-25) |
| Agent 工具架构 | 仅语义搜索+Wiki抽象层 | **C-70: 双层工具架构 — 高级工具(kb_search/expand/wiki_browse/doc_grep)+底层工具(bash/read_file/run_sql/grep/glob)，高层不够用立即切底层** (04-24) |
| Agent 通用能力 | 只能读不能写 | **C-71: write_file/edit_file 工具 — Agent 可在数据目录内创建/编辑文件，完成读写执行闭环** (04-24) |
| Agent 可扩展性 | 行为硬编码在 agent-definitions.ts | **C-72: Skill 技能系统 — 用户通过 Markdown 定义自定义 Agent 行为，Agent 通过 skill_invoke 调用，支持提示词覆盖+工具限制+systemPrompt 自定义** (04-24) |
| 子Agent调度 | 仅同步等待 | **C-73: 异步子Agent — workflow_run 支持 run_in_background 模式，Agent 可继续工作后用 task_output 获取结果，SSE 实时推送进度** (04-24) |
| 递归防护 | 无 | **C-74: 子Agent 递归防护 — 子Agent 禁止调用 workflow_run/agent_todo 等管理类工具，防止无限派生** (04-24) |
| Token 效率 | 23个工具全部随API发送 | **C-75: 工具延迟加载 — 低频工具标记为 deferred，仅发送核心工具定义，Agent 通过 tool_discover 按需发现激活，节省 input token** (04-24) |
| 工具扩展 | 仅内置工具 | **C-76: MCP 协议支持 — 动态加载外部 MCP 工具服务器，工具以 mcp__serverName__toolName 命名，支持配置管理+认证** (04-24) |
| 团队协作 | 子Agent完全隔离 | **C-77: 团队信箱通信 — workflow_run 子Agent 间可通过 send_message/post_message 互相通信，支持定向发送和广播** (04-24) |
| push_content 持久化 | 仅 SSE 流，刷新丢失 | **C-48 补充：markdown 类型 push_content 保存为消息主体内容，pushedContents 数组存入 metadata，历史消息可完整重建** (04-24) |
| Agent 流式输出 | 整轮输出完成才显示 | **C-78: Agent 逐 token 流式输出 — agent-runner 从 chat() 切换到 chatStream()，SSE 新增 content_delta 事件逐 token 推送前端，前端 appendStreamContent 实时累积显示** (04-25) |
| 项目配置注入 | 无持久化项目级配置 | **C-79: .deepanalyze.md 配置文件 — 从 dataDir 加载 .deepanalyze.md 文件内容注入到 Agent 系统提示词，支持项目级自定义指令** (04-25) |
| 单 Agent 委托 | workflow_run 仅多 Agent 模式 | **C-80: workflow_run single 模式 — WorkflowMode 新增 "single"，直接委托单个子 Agent 执行任务，跳过多 Agent 编排开销** (04-25) |
| Prompt 缓存 | 无缓存标记 | **C-81: Prompt 缓存共享 — openai-compatible 对系统消息和工具定义添加 cache_control: { type: "ephemeral" }，ChatResponse.usage 新增 cachedTokens 追踪** (04-25) |
| 实时状态 | 无 token 使用量反馈 | **C-82: 实时状态显示 — SSE 新增 turn_usage 事件，每轮结束时推送 inputTokens/outputTokens/cachedTokens，前端 onTurnUsage 回调** (04-25) |
| Hook 系统 | 无工具执行前后钩子 | **C-83: Hook 系统 — HookManager 支持 PreToolUse/PostToolUse 事件，command 和 http 两种类型，glob 匹配器过滤工具名，settings API 管理 hooks 配置** (04-25) |
| MCP 传输 | 仅 HTTP POST | **C-84: MCP 传输增强 — MCPServerConfig.type 新增 "websocket"，实现真实 SSE 传输和 WebSocket 传输，支持 JSON-RPC over WebSocket** (04-25) |
| 流式输出 vs push_content | Agent 过度使用 push_content 推送分析文本 | **C-41/C-47 补充：流式输出优先策略 — push_content 工具描述限定仅用于大型表格和多段合并，Agent 系统提示词新增"输出方式"章节明确流式文本优先、push_content 仅限特殊场景** (04-25) |
| think 工具流式 | think 内容以批量 content 事件发送 | **C-78 补充：think 工具内容改为 content_delta 事件流式发送（此前为批量 content 事件），保持流式 UX 一致性** (04-25) |
| VLM OCR 集成 | 无 VLM 管线支持 | **G-07 补充：Docling VLM 管线双模式集成 — inline 模式（VLM 模型加载到 Docling 进程）+ API 模式（独立容器服务）。默认模型 GLM-OCR (0.9B, zai-org/GLM-OCR)，备选 PaddleOCR-VL-1.5。前端 DoclingConfig 支持模式切换和容器生命周期管理。VLM 模式速度约为标准模式 7-10x 慢，但 OCR 质量更高** (04-25) |
| OCR 结构恢复 | VLM 输出无标题标记 | **G-07 补充：`_restore_document_structure()` 后处理 — GLM-OCR 作为纯文字识别模型不输出 markdown 标题标记，通过启发式正则恢复章节结构（`1. Introduction` → `## 1. Introduction`）。同时 `_clean_vlm_output()` 清理 `<|user` 等模型特殊 token 残留** (04-25) |
| VLM GPU 批处理优化 | 默认 batch_size=4 | **G-07 补充：Docling `page_batch_size` 从默认 4 优化为 8，在 RTX 5090 上提速约 12%。GPU 批处理瓶颈在于自回归解码，更大 batch_size (15+) 反而更慢** (04-25) |
| transformers 版本 | 4.57.6 | **升级到 5.4.0 — GLM-OCR 要求 transformers ≥5.4.0（模型类型 `glm_ocr` 不被 4.x 识别）。Docling VLM 依赖允许 5.4+，vllm 要求 <5（可接受，vllm 容器为独立部署）** (04-25) |
| PaddleOCR-VL 局限性 | 计划作为主要 VLM | **决策：不作为默认 VLM — PaddleOCR-VL-1.5 输出 `<|LOC_xx|>` 定位标记设计给 PP-DocLayoutV3 配合使用，独立使用时输出包含 1000+ 定位 token，需后处理清理。输出质量（重复、结构混乱）不如 GLM-OCR。保留 API 模式支持作为备选** (04-25) |
| VLM vs 标准管线性能 | 无对比数据 | **基准测试（4 篇学术论文）：标准管线平均 9.3s (4-6 页/秒)，GLM-OCR 平均 58.3s (0.19 页/秒)。内容完整度：GLM-OCR 输出字符数为标准管线的 70-90%，主要缺失为图片标记（VLM 不检测图片区域）和部分格式标记。标准管线有内容重复问题（PDF 双层文本），GLM-OCR 无此问题** (04-25) |
| VLM OCR 准确率评估 | 无第三方评估 | **qwen3.6-plus VLM 评估（3 篇学术论文）：GLM-OCR 平均 43.3/50 vs 标准 23.0/50，GLM-OCR 全面胜出。最大优势维度：格式完整 (+5.3) 和可读性 (+5.0)。文字准确率 GLM-OCR 9.0/10 vs 标准 4.7/10。antigravity-rag 文档标准管线出现灾难性字符编码错误 (10/50)** (04-25) |
| 反幻觉规则位置 | 写入 agent-definitions.ts 基础 Agent 提示词 | **移至"深度知识库分析"内置 Skill**，基础 Agent 保持通用简洁。REPORT_AGENT 仅保留报告结构和生成流程，反幻觉/引用溯源规则由 Skill 承载。C-56 执行：GENERAL_AGENT 提示词精简至 23 行核心指令 (04-29) |
| Skill 自动推荐 | 无 | **新增"深度知识库分析"内置 Skill（config.autoSuggest=true）**：包含反幻觉 5 条规则、引用溯源格式、数据精度原则、三层验证流程、输出完整性要求。适用于学术分析、卷宗分析、法律文书等高精度场景 (04-29) |
| 输出完整性 | 子 Agent 结果可能丢失，report_generate 后内容不显示 | **Skills 强制双输出**：report_generate 保存后必须 push_content 推送到前端；全面分块分析/全面知识库分析 Skills 的子 Agent task 模板增加反幻觉要求（来源标注、数据验证、禁止编造）(04-29) |
| 运行时注入 | synthesizeResults() 中注入 [系统提示：...] | **移除运行时注入**，反幻觉引导已通过 Skill 和 workflow_run 工具描述承载，不再在工具返回结果中注入系统指令 (04-29) |
| 子 Agent 轮次限制 | workflow-engine 硬编码 maxTurns=50，agent-runner skill_invoke 硬编码 maxTurns=20 | **硬性要求：子 Agent maxTurns 必须为 200**（workflow-engine.ts、agent-runner.ts 中的 skill_invoke 均为 200）。主 Agent 不设上限（-1）。内置 Skill 的 maxTurns 按复杂度合理设置（简单任务 20，中等 30-50，复杂分析 50-60）。此为硬性约束，不允许降低 (04-29) |
| Agent 运行参数可配置 | subAgentMaxTurns/consecutiveErrorThreshold/stuckDetectionThreshold 硬编码 | **AgentSettings 新增 subAgentMaxTurns（默认200），前端"通用→Agent运行参数"可修改子Agent最大轮次、连续错误阈值、卡住检测阈值，保存后持久化到数据库即时生效** (04-29) |
| 工具并发执行 | 所有工具串行执行 | **C-85: 工具并发编排 — AgentTool 新增 isConcurrencySafe()/isReadOnly() 动态分类，partitionToolCalls 分组安全/非安全批，安全批 Promise.all 并行（最大并发 10），非安全批串行。Bash 工具按命令前缀白名单动态判定只读** (04-30) |
| Prompt 缓存优化 | 无缓存意识，每次完整发送 | **C-86: SystemPromptBuilder 静态/动态分离 — 系统提示词分为静态区（Agent 定义，跨请求可缓存）和动态区（scope/session memory/项目配置），边界标记便于 API 缓存命中。工具定义按字母序排序保证缓存稳定性** (04-30) |
| 自然终止机制 | 必须调用 finish 工具才能终止 | **C-87: 自然终止 — 模型返回文本（无 tool_use）时自动终止循环，减少不必要的 API 调用和 token 消耗** (04-30) |
| Cache Editing | 压缩时修改本地消息数组，破坏缓存前缀 | **C-88: API Cache Editing — 截断旧 tool_result 时不修改本地消息数组，只对发送给 API 的副本做截断，保持缓存前缀不变** (04-30) |
| 长输出续写 | 模型输出被 max_tokens 截断后丢失 | **C-89: 长输出续写 — 检测 finish_reason=length 时注入续写消息继续生成，最多续写 5 轮，拼接完整结果** (04-30) |
| Token 估算 | 简单启发式（字符数/3） | **C-90: 双层 Token 估算 — 优先使用 API 报告 usage（精确），回退到 4/3 保守估算。TokenEstimator 类管理报告值和估算值** (04-30) |
| 工具输入校验 | 仅 JSON.parse 无 schema 校验 | **C-91: 两阶段工具校验 — Stage 1: JSON 解析，Stage 2: Schema 校验（必填字段+类型兼容性），校验失败返回结构化错误消息** (04-30) |
| 大结果持久化 | 固定 token 限制截断 | **C-92: 工具结果磁盘持久化 — 超过 50K 字符的工具结果写入磁盘文件，模型只拿 2K 预览+文件路径，避免上下文被大结果撑爆** (04-30) |
| Edit 唯一性 | old_string 可能多处匹配导致错误替换 | **C-93: Edit 唯一性检查 — edit_file 工具检查 old_string 在文件中的出现次数，多次匹配要求 replace_all 或提供更多上下文** (04-30) |
| 工具优先级引导 | 无工具使用指导 | **C-94: 工具使用优先级引导 — system prompt 注入工具使用指南（搜索优先用专用工具、并行调用独立操作），目前仅 GENERAL_AGENT 包含** (04-30) |
| 分层压缩 | 单次全量压缩 | **C-95: 多级上下文压缩 — D2(最旧,粗粒度,≤2000 token) → D1(中等,≤4000 token) → Leaf(最新,完整保留)，不同层使用不同压缩 prompt 控制信息密度** (04-30) |
| Session Memory 异步 | 同步提取阻塞主循环 | **C-96: Session Memory 异步提取 — AsyncSessionMemoryExtractor 后台非阻塞提取，不占用用户等待时间，下次请求直接使用已提取结果** (04-30) |
| Hook 系统 | 仅 PreToolUse/PostToolUse | **C-97: 8 类 Hook 系统 — AgentStart/AgentComplete/PreToolUse/PostToolUse/PreCompact/PostCompact/SessionStart/SessionEnd，区分阻塞 vs fire-and-forget 语义** (04-30) |
| Feature Flags | 硬编码特性开关 | **C-98: Feature Flags — 9 个功能标志（concurrentToolExecution/promptCaching/cacheEditing/streamingToolExecution/hierarchicalCompression/longOutputContinuation/maxToolConcurrency/pluginSystem/markdownSkills），优先级 env var > DB config > defaults** (04-30) |
| Plugin 系统 | 仅基础工具注册 | **C-99: Plugin 系统 — plugin.json 清单 + SKILL.md 技能定义 + agent.md Agent 定义，启动时自动加载 plugins/ 目录。judicial-analysis 插件提供 5 个领域 skill（证据链/时间线/实体网络/交叉验证/事实提取）+ 2 个领域 agent（验证器/提取器）** (04-30) |
| Skill Markdown | 仅 TypeScript 对象定义 | **C-100: SKILL.md 格式 — YAML frontmatter + Markdown body 定义技能，降低非开发者创建技能门槛，保留 TypeScript 作为内部表示** (04-30) |
| 通用工具 | 缺少基础通用工具 | **C-101: 通用工具补全 — 新增 list_files/notebook_read 工具，所有工具标注并发属性（isReadOnly/isConcurrencySafe）** (04-30) |

### GAIA 基准测试验证结果 (04-30)

| 问题域 | 发现 | 优化方向 |
|--------|------|---------|
| Session 隔离 | 同一 session 连续处理多题导致上下文污染，至少 3/50 题输出了前一轮答案 | **C-102: 每请求独立 session 隔离** — 测试脚本已修复为每题独立 session |
| Provider 稳定性 | minimax-highspeed HTTP 400 "invalid function arguments" 占 8/50 题 (16%) | **C-103: Provider 自动 fallback** — 主 provider 失败时自动切换到备用 provider |
| 文件附件 | GAIA 4/50 题 (8%) 带附件文件无法处理 | C-12 (已有) 需增强：API 层支持文件上传传递给 Agent |
| 搜索能力 | 8/50 题 (16%) 因搜索不足失败（Wikipedia 超时、YouTube 无法获取 transcript） | C-18 (已有) 需增强：接入更多搜索 API |
| 答案提取 | 部分答案内容正确但格式不匹配 | **C-104: 答案后处理** — 从 agent 长输出中提取精确答案，标准化格式 |
| 动态超时 | Level 3 题目 10 分钟不够 | **C-105: 动态超时分配** — 根据任务复杂度分配不同超时时间 |
| 子 Agent 事件路由 | workflow 子 Agent 事件仅走 WebSocket，SSE 连接前端看不到子 Agent 进度 | **C-106: SSE 订阅 workflow 事件** — SSE 路由订阅 `globalThis.__workflowEvents`，转发子 Agent 的 push_content/report_generate/工具事件到 SSE 流，流结束时自动清理订阅 (04-30) |
| 报告事件通知 | ReportTool 成功保存后无事件通知 | **C-107: ReportTool 发射 report_generated 事件** — 保存成功后调用 `eventBus.emit({ type: "report_generated" })`，添加保存成功/失败日志 (04-30) |
| Python JSON 控制字符 | Docling/Whisper 解析文档内容含控制字符导致 JSONDecodeError | **C-108: Python JSON ensure_ascii** — docling-service 和 whisper-service 的 `json.dumps()` 添加 `ensure_ascii=True` (04-30) |
| Stuck detection 误判 | expand 工具批量展开文档触发卡住干预 | **C-109: Stuck detection 豁免列表** — expand/kb_search 等批量操作工具排除在卡住检测之外 (04-30) |
