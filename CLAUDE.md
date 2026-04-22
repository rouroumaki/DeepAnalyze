# DeepAnalyze 项目规范

## 语言要求

- 所有设计文档、计划文档、需求文档必须使用**中文**编写
- 代码注释可以使用英文或中文，保持一致性即可
- Git 提交信息可以使用英文或中文

## 需求文档维护

- 需求清单位于 `docs/superpowers/specs/2026-04-20-comprehensive-design/requirements-checklist.md`
- **每次完成涉及功能、架构、行为变更的开发任务后**，检查需求文档是否需要同步更新
- 更新原则：简洁准确，不膨胀。只修改受影响的条目，不添加冗余描述
- 以下情况**需要**刷新需求文档：
  - 需求理解变化（如设计调整、方案替代）
  - 新增功能需求（之前未覆盖的）
  - 重要行为变更（如降级策略、语言跟随等系统级行为）
- 以下情况**不需要**刷新：
  - 纯 Bug 修复（不改变预期行为）
  - 代码重构（不改变外部行为）
  - 提示词细节调整（不影响需求定义）
  - 小的 UI 样式调整

## 文档位置

- 设计规范: `docs/superpowers/specs/`
- 实施计划: `docs/superpowers/plans/`
- 主要需求清单: `docs/superpowers/specs/2026-04-20-comprehensive-design/requirements-checklist.md`

## 基础设施

### 启动方式
```
python3 start.py            # 一键启动（Docker 容器 + 本地后端）
python3 start.py --dev      # 开发模式（前端热重载）
```

### 数据库：仅通过 Docker 提供
- **没有本地 PostgreSQL**，WSL2 系统中不应安装任何 PostgreSQL 包
- 数据库由 `docker-compose.dev.yml` 中的 `postgres` 容器提供
- 镜像基于 `pgvector/pgvector:pg17`，附带 `zhparser` 中文分词扩展
- 端口：`5432`（由 Docker 映射）
- 连接信息：`.env` 文件中的 `PG_HOST`/`PG_PORT`/`PG_USER`/`PG_PASSWORD`

### Docker Compose 文件
- `docker-compose.dev.yml` — **开发用**（仅启动 PG + Ollama，后端本机跑 `npx tsx src/main.ts`）
- `docker-compose.yml` — **生产用**（前后端都跑容器）

### 运行时
- Bun 运行 TypeScript，不需要编译到 `dist/`（`dist/` 目录不存在是正常的）
- 前端构建产物在 `frontend/dist/`

### 如果端口 5432 被占用
```bash
# 检查是谁占用
ss -tlnp | grep 5432
# 如果是本地 PostgreSQL（不应该存在）：
sudo apt-get purge -y 'postgresql*'
# 如果是 Docker 容器，先确保旧容器停掉再启动：
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml up -d
```
