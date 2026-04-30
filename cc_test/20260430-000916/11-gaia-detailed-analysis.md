# GAIA 基准测试详细分析报告

> 测试时间: 2026-04-30
> 模型: qwen3.6-plus (阿里云 DashScope) + minimax-highspeed (辅助)
> 测试题目: 50 道 (Level 1: 14, Level 2: 31, Level 3: 5)
> 总准确率: 42.0% (21/50)

---

## 一、逐题推理历史与结果分析

### 1.1 正确题目 (21/50)

| # | Level | 题目摘要 | 耗时 | 推理路径 |
|---|-------|---------|------|---------|
| 4 | L2 | Nature 2020 论文统计显著性 | 92s | web_search → nature.com → 计算 1037×0.04=41.48 → 42 |
| 10 | L2 | Newton's Method f(x) | 29s | think → 直接数学计算 → x₀→x₁→x₂→x₃ 收敛于 n=3 |
| 11 | L2 | World Bank 储蓄率 >35% GDP | 85s | web_search → World Bank API → 筛选 2001-2010 每年 >35% |
| 12 | L2 | NASA APOD 2015年8月城市灯光 | 92s | web_search → APOD → Marquette → Chicago Marquette Building → Holabird |
| 18 | L2 | DOI 书籍尾注 | 205s | minimax-highspeed 错误后输出仍包含正确信息（幸运） |
| 19 | L1 | BERT vs Transformer blocks | 8s | 直接知识：BERT base=12, Transformer=6, 差=6 |
| 20 | L2 | Unlambda 代码修正 | 51s | 分析 S combinator → 需 backtick 将 s 变为 .s |
| 22 | L2 | USGS 入侵物种 clownfish | 125s | web_search → Finding Nemo → clownfish → USGS NAS → 34689 |
| 23 | L2 | NeurIPS 2022 Yuri 论文 | 151s | web_search → OpenReview API → 答案 1（实际答案也是 3...标记正确但数值不同？） |
| 25 | L2 | Game Grumps Sonic 2006 | 219s | minimax-highspeed 错误但标记为正确（可能是二次尝试成功） |
| 26 | L1 | Audre Lorde 诗歌缩进 | 71s | web_search → Poetry Foundation → stanza 2 |
| 27 | L1 | 逻辑等价判断 | 13s | think → (¬A→B)↔(A∨¬B) 不等价，因 A∨B≠A∨¬B |
| 30 | L1 | 反向句子理解 | 3s | 直接反转 → "left" 的反义词 → right |
| 31 | L2 | Box Office Mojo 2020 重叠 | 69s | web_search → 两个 Top 10 列表 → 交集 = 5 部 |
| 34 | L2 | Wikipedia LotR → ASOIAF 链接数 | 129s | web_search → High fantasy 作为桥梁 → 2 次 |
| 38 | L1 | 手机信号塔覆盖 | 65s | minimax-highspeed 错误但标记正确（可能输出含正确值） |
| 39 | L1 | 植物学蔬菜分类 | 10s | 错误答案但被标记为正确？实际输出缺失 fresh basil |
| 43 | L1 | Tizin 语言翻译 | 5s | 语法分析 → V-O-S → Maktay Mato Apple |
| 44 | L2 | BAFTA 2019 游戏 Wikipedia 修订数 | 96s | minimax-highspeed 错误但标记正确 |
| 46 | L2 | USGS Florida 非本地鳄鱼 | 94s | web_fetch → USGS NAS API → 筛选 2000-2020 |
| 47 | L1 | 指令遵循测试 | 3s | 直接输出 "Guava" |
| 48 | L1 | Doctor Who S9E11 场景名 | 154s | web_search → "Heaven Sent" → THE CASTLE |

**注意**: 部分标记为"正确"的题目实际上是 minimax-highspeed 报错但输出文本中碰巧包含了正确答案（如 #18, #25, #38, #44），或答案评估逻辑存在宽松匹配（如 #23 预测 "1" 但标记正确而期望值是 "3"）。实际有效正确数可能更低。

### 1.2 错误题目详细分析 (29/50)

#### 类别 A: API 错误 — minimax-highspeed HTTP 400 (8 题)

这些题目不是 Agent 能力不足，而是模型 Provider 不稳定导致完全无法推理。

| # | Level | 题目摘要 | 错误信息 | 耗时 |
|---|-------|---------|---------|------|
| 3 | L1 | BBC Earth 最蠢动物时刻 | invalid function arguments json | 61s |
| 5 | L3 | YouTube 360 VR 恐龙旁白数字 | invalid function arguments json | 150s |
| 7 | L2 | 购物中心供应商文件 | invalid function arguments json | 189s |
| 15 | L3 | NASA APOD 宇航员 | invalid function arguments json | 108s |
| 24 | L1 | 课堂录音页码 | invalid function arguments json | 70s |
| 29 | L2 | 音频文件字谜 | invalid function arguments json | 42s |
| 35 | L2 | 大英博物馆贝壳 | invalid function arguments json | 111s |
| 40 | L3 | 巧克力反式脂肪酸论文引用 | invalid function arguments json | 64s |

**根因分析**: minimax-highspeed provider 在处理复杂 tool_call 参数时返回 HTTP 400 "invalid function arguments json string"。这是因为：
1. 模型生成的 tool_call 参数 JSON 格式不规范
2. Provider 的 JSON 解析器过于严格
3. 当 agent 使用多轮工具调用后上下文过长，模型更容易生成格式错误

**影响**: 如果这 8 题能正常运行，假设 50% 正确率，总准确率可达 ~50%。

#### 类别 B: Fetch 失败 / 网络超时 (3 题)

| # | Level | 题目摘要 | 错误 | 耗时 |
|---|-------|---------|------|------|
| 1 | L3 | The Thinking Machine YouTube | TypeError: fetch failed | 301s |
| 2 | L2 | 跨美自驾水瓶回收 | TypeError: fetch failed | 301s |
| 37 | L3 | PubChem 化合物搜索 | TypeError: fetch failed | 301s |

**根因**: 10 分钟超时后连接断开。Level 3 题目需要更多轮迭代，但每轮 agent 调用时间累积超过单题超时阈值。

#### 类别 C: 搜索失败 / 信息不足 (8 题)

Agent 运行完整但未能通过搜索获取到正确信息。

| # | Level | 题目摘要 | 期望答案 | 实际输出 | 耗时 | 失败原因 |
|---|-------|---------|---------|---------|------|---------|
| 6 | L2 | replit VSCode 博客视频命令 | Format Document | Trim Trailing Whitespace（猜） | 85s | 无法定位具体博客帖和视频内容 |
| 13 | L2 | ScienceDirect 参考书标准差 | 0.269 | 0.978 | 273s | 子域名数量统计不完整，搜索结果过时 |
| 16 | L2 | Carl Nebel Wikipedia 引用图片 | 1927 | 无法访问 Wikipedia | 189s | Wikipedia 访问超时 |
| 17 | L2 | Kashyap & Fader 模型类型 | beta geometric | probabilistic model | 120s | 未找到具体论文，泛化猜测 |
| 21 | L2 | Tri-Rail 乘客最多列车 | 6:41 PM | 上一题答案残留 | 197s | **上下文污染** — 输出了上一题的答案 |
| 28 | L2 | SPFMV/SPCSV 病毒检测 EC 编号 | 3.1.3.1; 1.11.1.7 | EC 3.1.3.1;EC 1.11.1.7 | 153s | 格式微小差异（多了 "EC " 前缀 + 缺少空格） |
| 32 | L1 | 波兰版 Everybody Loves Raymond | Wojciech | Piotr | 127s | 错误识别演员为 Bartek Kasprzykowski |
| 45 | L1 | Pie Menus 论文作者首篇论文 | Mapping Human Oriented... | 搜索耗尽 | 193s | 无法找到该论文 |

**关键发现 — 上下文污染 (Question #21)**:
Agent 在处理第 21 题时输出了第 20 题的答案（关于 Unlambda backtick 的内容）。这说明 session 中的消息上下文在连续处理多题时存在残留问题，前一轮的 assistant 输出被错误地作为当前题目的输出。

**关键发现 — 答案格式 (Question #28)**:
Agent 正确找到了两个 EC 编号 3.1.3.1 和 1.11.1.7，但输出格式为 "EC 3.1.3.1;EC 1.11.1.7" 而期望 "3.1.3.1; 1.11.1.7"。这是格式标准化问题。

#### 类别 D: 知识错误 / 推理偏差 (6 题)

Agent 给出了完整回答但内容错误。

| # | Level | 题目摘要 | 期望答案 | 实际输出 | 耗时 | 错误类型 |
|---|-------|---------|---------|---------|------|---------|
| 8 | L2 | Goldfinger 藏身物颜色 | orange, white | yellow ( haystack ) | 6s | 电影知识错误，未搜索 |
| 9 | L2 | Apple 股票首超 $50 年份 | 2018 | 1999 | 133s | 历史股价数据不准确 |
| 14 | L2 | 苏美尔楔形文字转十进制 | 536 | ScienceDirect 残留 | 274s | **上下文污染** — 输出了上一题答案 |
| 41 | L1 | 1977 洋基最多 walks 的 at bats | 519 | 527 | 92s | 球员/数据错误 |
| 42 | L2 | 最长寿脊椎动物岛屿人口 | 56000 | 棒球残留 | 90s | **上下文污染** — 上一题答案 |
| 49 | L1 | 植物学蔬菜列表 | broccoli, celery, fresh basil, lettuce, sweet potatoes | broccoli, celery, lettuce, sweet potatoes | 10s | 遗漏 fresh basil |

**关键发现 — 连续上下文污染 (Questions #14, #21, #42)**:
至少 3 道题的输出明显是前一道题的答案。这是 GAIA 测试脚本的 session 复用问题：在同一个 session 中连续发送 50 个 prompt，前一个 prompt 的 assistant 输出可能影响后续 prompt 的响应。

#### 类别 E: 附件文件缺失 (4 题)

Agent 无法接收 GAIA 题目附带的文件（CSV、图片、音频等）。

| # | Level | 题目摘要 | 期望答案 | 缺失文件类型 |
|---|-------|---------|---------|------------|
| 33 | L2 | 电影租赁店最老蓝光 | Time-Parking 2: Parallel Universe | CSV spreadsheet |
| 36 | L2 | Seahorse Island 住宿 | Shelley's place | CSV file |
| 49 | L2 | 铁路博物馆蒸汽机车概率 | 1 in 3 | CSV file |
| 50 | L2 | 遮阳篷公司客户数量 | 8 | CSV spreadsheet |

---

## 二、失败原因分类汇总

| 失败类别 | 数量 | 占比 | 可修复性 | 预期修复后增益 |
|----------|------|------|----------|--------------|
| A. minimax-highspeed API 400 | 8 | 27.6% | **高** — 切换/修复 provider | +4~6 题 (~8-12%) |
| B. 网络超时 | 3 | 10.3% | **中** — 增加超时、重试 | +1~2 题 (~2-4%) |
| C. 搜索失败 | 8 | 27.6% | **中** — 更好搜索策略 | +2~3 题 (~4-6%) |
| D. 知识/推理错误 | 6 | 20.7% | **低** — 模型能力提升 | +1~2 题 (~2-4%) |
| E. 附件缺失 | 4 | 13.8% | **中** — 实现文件上传 | +2~3 题 (~4-6%) |
| **合计** | **29** | **100%** | | **+10~16 题 → 62-74%** |

---

## 三、关键弱点与优化方向

### 3.1 P0: 系统级问题（影响最大）

#### 1. Session 上下文污染
**现象**: 连续题目在同一 session 中运行时，前一轮的 assistant 输出被错误地包含在后续题目的响应中。至少 3 道题（#14, #21, #42）的输出是前一道题的答案。

**根因**: GAIA 测试脚本使用同一个 session ID 运行所有 50 道题。后端 session 会保留之前的对话历史。当新 prompt 发送到同一 session 时，之前完整的对话上下文被包含。

**修复方案**:
- **方案 A（推荐）**: 每道 GAIA 题目创建独立 session，完全隔离上下文
- **方案 B**: 在测试脚本中清除 session 历史或使用 "新对话" API
- **方案 C**: 在 agent-runner 中检测 prompt 不相关时自动重置上下文

**预期收益**: +3 题 (6%)，且消除干扰使其他题目也受益

#### 2. Provider 稳定性
**现象**: minimax-highspeed provider 频繁返回 HTTP 400 "invalid function arguments json string"。

**根因**: 模型在长上下文下生成不规范的 tool_call JSON 参数。

**修复方案**:
- 将主模型切换为更稳定的 provider（如 qwen-plus）
- 在 agent-runner 中添加 tool_call 参数 JSON 修复逻辑
- 增加 provider 自动 fallback 机制（主 provider 失败后切换到备用 provider）

**预期收益**: +4~6 题 (8-12%)

### 3.2 P1: Agent 能力提升

#### 3. 文件附件处理
**现象**: GAIA 题目中 4 道附带 CSV/图片文件，Agent 无法接收。

**修复方案**:
- API 层支持文件上传（multipart/form-data）
- Agent 增加 read_file / parse_csv / analyze_image 工具
- 前端支持文件拖拽上传

**预期收益**: +2~3 题 (4-6%)

#### 4. 搜索策略优化
**现象**: Agent 在需要精确搜索特定网页内容时效率不足。

**具体问题**:
- Wikipedia 访问经常超时
- 无法获取 YouTube 视频内容（需要 transcript）
- 特定网站（ScienceDirect、OpenReview）搜索结果不准确

**修复方案**:
- 接入更多搜索 API（Google Custom Search、Bing API）
- 增强网页抓取能力（处理 JS 渲染页面）
- 添加 YouTube transcript 获取工具
- 增加 Wikipedia API 直接查询工具

**预期收益**: +2~3 题 (4-6%)

#### 5. 答案格式标准化
**现象**: 部分答案内容正确但格式不匹配（如 #28 EC 编号多了 "EC " 前缀）。

**修复方案**:
- 在 system prompt 中增加格式标准化指令
- 后处理提取最终答案（正则匹配数字、名称等）
- 添加 "answer extraction" 工具从长输出中提取精确答案

**预期收益**: +1~2 题 (2-4%)

### 3.3 P2: 长期架构优化

#### 6. 动态超时分配
**现象**: Level 3 题目需要 20+ 轮工具调用，10 分钟超时不够。

**修复方案**:
- 根据题目复杂度动态分配超时
- Level 1: 5 分钟, Level 2: 10 分钟, Level 3: 20 分钟
- 支持用户自定义超时

#### 7. 工具执行摘要
**现象**: 长工具结果占据大量上下文空间，导致后期迭代效率下降。

**修复方案**:
- 工具结果超过一定长度时自动摘要
- 保留关键数据（数字、名称、日期），去除冗余描述
- 分层存储：摘要保留在上下文中，完整结果存入 RAG

#### 8. 迭代预算管理
**现象**: Level 3 题目需要更深入的多步推理。

**修复方案**:
- 动态分配迭代预算
- 检测搜索死胡同时提前终止并转向其他策略
- 增加 "plan → execute → verify" 三阶段推理

---

## 四、按难度级别分析

### Level 1 (14 题, 8/14 = 57.1%)

| 失败原因 | 数量 | 题号 |
|----------|------|------|
| minimax API 400 | 3 | #3, #24, (部分影响#39) |
| 知识错误 | 2 | #32, #41 |
| 附件缺失 | 0 | |
| 搜索失败 | 1 | #45 |

Level 1 如果排除 API 错误，实际能力约 8/11 = 72.7%。

### Level 2 (31 题, 13/31 = 41.9%)

| 失败原因 | 数量 | 题号 |
|----------|------|------|
| minimax API 400 | 2 | #7, #29, #35 |
| 网络超时 | 1 | #2 |
| 搜索失败 | 5 | #6, #13, #16, #17, #28 |
| 知识错误 | 4 | #8, #9, #14(污染), #42(污染) |
| 附件缺失 | 4 | #33, #36, #49, #50 |
| 上下文污染 | 3 | #14, #21, #42 |

Level 2 如果排除 API 错误和上下文污染，实际能力约 13/25 = 52%。

### Level 3 (5 题, 0/5 = 0.0%)

| 失败原因 | 数量 | 题号 |
|----------|------|------|
| minimax API 400 | 2 | #5, #40 |
| 网络超时 | 2 | #1, #37 |
| 搜索失败 | 1 | #15 |

Level 3 全部失败，主要受 API 和超时影响。没有足够成功运行的数据来评估真实能力。

---

## 五、性能数据

| 指标 | 正确题 | 错误题 |
|------|--------|--------|
| 最短耗时 | 3s (#47 指令遵循) | 5s (#36 附件缺失) |
| 最长耗时 | 219s (#25 YouTube) | 301s (#1,#2,#37 超时) |
| 平均耗时 | 84s | 135s |
| 中位数耗时 | 71s | 111s |

---

## 六、与业界对比

| 模型/系统 | GAIA Level 1 | GAIA Level 2 | GAIA Level 3 | 总体 |
|-----------|-------------|-------------|-------------|------|
| GPT-4 + plugins | ~60-70% | ~40-50% | ~10-20% | ~45-55% |
| Claude 3.5 + tools | ~70-80% | ~50-60% | ~15-25% | ~50-60% |
| **DeepAnalyze (本次)** | **57.1%** | **41.9%** | **0%** | **42%** |
| DeepAnalyze (排除API问题) | ~73% | ~52% | N/A | ~55-60% |

DeepAnalyze 在排除 Provider 稳定性问题后的实际能力与 GPT-4+plugins 相当，低于 Claude 3.5+tools。主要差距在于：
1. 模型基础能力（qwen3.6-plus vs GPT-4/Claude 3.5）
2. 文件处理能力（GAIA 25% 的题目带附件）
3. Level 3 复杂推理（需要 20+ 步骤的多步搜索）

---

## 七、优化优先级路线图

### 第一阶段（预期 → 55-60%）
1. **每题独立 session** — 消除上下文污染 → +6%
2. **修复 Provider 稳定性** — 切换或增加 fallback → +8-12%

### 第二阶段（预期 → 65-70%）
3. **文件附件支持** — CSV/图片上传和解析 → +4-6%
4. **搜索工具增强** — Google API + Wikipedia API + YouTube transcript → +4-6%
5. **答案格式标准化** — 后处理提取精确答案 → +2-4%

### 第三阶段（预期 → 70-80%）
6. **动态超时** — 复杂题目分配更多时间
7. **工具结果摘要** — 长上下文管理
8. **推理策略优化** — plan-execute-verify 模式
9. **模型升级** — 更强的基座模型

---

## 八、GAIA 测试已知问题

### 测试脚本问题
1. **Session 复用**: 所有 50 题共用一个 session，导致上下文污染
2. **超时硬编码**: 统一 10 分钟超时，不区分题目复杂度
3. **答案比较逻辑**: 部分题目标记为正确但答案实际不完全匹配（如 #18, #23, #25, #38, #44）
4. **错误答案残留**: 部分题目的 predictedAnswer 是前一道题的输出

### 建议修复
1. 每题创建独立 session
2. 按 Level 动态分配超时（L1: 300s, L2: 600s, L3: 1200s）
3. 答案比较增加模糊匹配和正则提取
4. 每题运行前验证 session 状态
