#!/bin/bash
# =============================================================================
# build-offline-package.sh — 构建离线部署包
# =============================================================================
# 在有互联网的机器上运行此脚本，生成完整的离线部署包。
#
# 用法:
#   ./scripts/build-offline-package.sh [输出目录]
#
# 默认输出到 /tmp/deepanalyze-offline/
# =============================================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${1:-/tmp/deepanalyze-offline}"

echo "======================================"
echo "  DeepAnalyze 离线部署包构建"
echo "======================================"
echo "  项目根目录: $PROJECT_ROOT"
echo "  输出目录:   $OUTPUT_DIR"
echo ""

# ---------------------------------------------------------------------------
# Step 1: 准备输出目录
# ---------------------------------------------------------------------------
echo "[1/8] 准备输出目录..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"/{images,models,config,source,tools}

# ---------------------------------------------------------------------------
# Step 2: 构建前端
# ---------------------------------------------------------------------------
echo "[2/8] 构建前端..."
cd "$PROJECT_ROOT/frontend"
npm install --prefer-offline 2>/dev/null || npm install
npm run build
echo "  前端构建完成"

# ---------------------------------------------------------------------------
# Step 3: 构建 Docker 镜像
# ---------------------------------------------------------------------------
echo "[3/8] 构建 Docker 镜像..."

cd "$PROJECT_ROOT"

# Backend
echo "  构建 backend..."
docker build -t deepanalyze-backend:offline -f Dockerfile .

# Frontend
echo "  构建 frontend..."
docker build -t deepanalyze-frontend:offline -f frontend/Dockerfile frontend/

# PostgreSQL + pgvector + zhparser
echo "  构建 postgres..."
docker build -t deepanalyze-pg:offline -f config/pg-zhparser.Dockerfile config/

echo "  所有镜像构建完成"

# ---------------------------------------------------------------------------
# Step 4: 拉取 Ollama 镜像
# ---------------------------------------------------------------------------
echo "[4/8] 拉取 Ollama 镜像..."
docker pull ollama/ollama:latest
echo "  Ollama 镜像就绪"

# ---------------------------------------------------------------------------
# Step 5: 保存 Docker 镜像为 tar 文件
# ---------------------------------------------------------------------------
echo "[5/8] 保存 Docker 镜像..."

echo "  保存 backend (~3.5GB)..."
docker save deepanalyze-backend:offline -o "$OUTPUT_DIR/images/backend.tar"

echo "  保存 frontend (~100MB)..."
docker save deepanalyze-frontend:offline -o "$OUTPUT_DIR/images/frontend.tar"

echo "  保存 postgres (~1.9GB)..."
docker save deepanalyze-pg:offline -o "$OUTPUT_DIR/images/postgres.tar"

echo "  保存 ollama (~3.7GB)..."
docker save ollama/ollama:latest -o "$OUTPUT_DIR/images/ollama.tar"

echo "  镜像保存完成"

# ---------------------------------------------------------------------------
# Step 6: 复制模型权重
# ---------------------------------------------------------------------------
echo "[6/8] 复制模型权重..."

MODELS_SRC="$PROJECT_ROOT/data/models"
if [ -d "$MODELS_SRC/bge-m3" ]; then
    echo "  复制 bge-m3 嵌入模型 (~2.2GB)..."
    cp -r "$MODELS_SRC/bge-m3" "$OUTPUT_DIR/models/"
fi

if [ -d "$MODELS_SRC/docling" ]; then
    echo "  复制 docling 文档处理模型 (~4.3GB)..."
    cp -r "$MODELS_SRC/docling" "$OUTPUT_DIR/models/"
fi

echo "  模型文件复制完成"

# ---------------------------------------------------------------------------
# Step 7: 复制部署文件和源代码
# ---------------------------------------------------------------------------
echo "[7/8] 复制部署文件和源代码..."

# 部署脚本和配置
cp "$PROJECT_ROOT/deploy/docker-compose.yml" "$OUTPUT_DIR/docker-compose.yml"
cp "$PROJECT_ROOT/deploy/load-images.sh" "$OUTPUT_DIR/load-images.sh"
cp "$PROJECT_ROOT/deploy/start.sh" "$OUTPUT_DIR/start.sh"
cp "$PROJECT_ROOT/deploy/stop.sh" "$OUTPUT_DIR/stop.sh"
cp "$PROJECT_ROOT/deploy/.env.example" "$OUTPUT_DIR/.env.example"
cp "$PROJECT_ROOT/deploy/config/default.yaml" "$OUTPUT_DIR/config/default.yaml"

# 设置脚本可执行
chmod +x "$OUTPUT_DIR/load-images.sh" "$OUTPUT_DIR/start.sh" "$OUTPUT_DIR/stop.sh"

# 完整源代码（用于内网修改和参考）
echo "  复制源代码..."
rsync -a --exclude='node_modules' \
    --exclude='.git' \
    --exclude='data/models' \
    --exclude='pip-wheels' \
    --exclude='frontend/dist' \
    --exclude='frontend/node_modules' \
    --exclude='test-results' \
    --exclude='deploy' \
    "$PROJECT_ROOT/" "$OUTPUT_DIR/source/"

# 开发工具
if [ -f "$PROJECT_ROOT/start.py" ]; then
    cp "$PROJECT_ROOT/start.py" "$OUTPUT_DIR/tools/"
fi
if [ -f "$PROJECT_ROOT/test-suite.md" ]; then
    cp "$PROJECT_ROOT/test-suite.md" "$OUTPUT_DIR/tools/"
fi
if [ -d "$PROJECT_ROOT/pip-wheels" ]; then
    echo "  复制 pip wheels (~3.1GB)..."
    cp -r "$PROJECT_ROOT/pip-wheels" "$OUTPUT_DIR/tools/"
fi

echo "  文件复制完成"

# ---------------------------------------------------------------------------
# Step 8: 生成说明文件
# ---------------------------------------------------------------------------
echo "[8/8] 生成说明文件..."

cat > "$OUTPUT_DIR/README.md" << 'READMEEOF'
# DeepAnalyze 离线部署包

## 目录结构

```
deepanalyze-offline/
├── images/              # Docker 镜像 tar 文件
│   ├── backend.tar      # 后端服务（Bun + Python）
│   ├── frontend.tar     # 前端（Nginx + SPA）
│   ├── postgres.tar     # PostgreSQL + pgvector + zhparser
│   └── ollama.tar       # Ollama（可选，用于本地嵌入）
├── models/              # 模型权重
│   ├── bge-m3/          # 嵌入模型（2.2GB）
│   └── docling/         # 文档解析模型（4.3GB）
├── config/
│   └── default.yaml     # 模型配置（修改推理服务地址）
├── source/              # 完整源代码（可修改）
├── tools/               # 开发工具和 pip wheels
├── docker-compose.yml   # Docker Compose 配置
├── load-images.sh       # 加载 Docker 镜像
├── start.sh             # 启动所有服务
├── stop.sh              # 停止所有服务
└── .env.example         # 环境变量模板
```

## 部署步骤

### 1. 前置条件

目标机器需要安装：
- Docker Engine >= 20.10
- Docker Compose >= 2.0
- 可用磁盘空间 >= 30GB
- 至少 8GB 内存（推荐 16GB）

### 2. 配置推理模型

编辑 `config/default.yaml`，修改以下字段：

```yaml
models:
  main:
    endpoint: http://你的推理服务地址:端口/v1
    model: glm-5-plus    # 或其他模型名
    apiKey: "你的API密钥"  # 如不需要可留空
```

或启动后在前端 "设置" 页面在线修改。

### 3. 加载镜像

```bash
chmod +x load-images.sh start.sh stop.sh
./load-images.sh
```

### 4. 启动服务

```bash
cp .env.example .env   # 首次需要
./start.sh
```

### 5. 访问

- 前端: http://localhost:3000
- 后端 API: http://localhost:21000/api
- 健康检查: http://localhost:21000/api/health

### 6. 停止服务

```bash
./stop.sh
```

## 配置说明

### 推理模型（必须配置）

DeepAnalyze 通过 OpenAI 兼容 API 调用推理模型。支持任何 OpenAI 兼容的服务：
- vLLM
- Ollama
- TGI (Text Generation Inference)
- 自研推理服务

只需在 `config/default.yaml` 或前端设置中配置 `endpoint`、`model`、`apiKey`。

### 嵌入模型

两个选项：

**选项 A: 使用内网嵌入服务**
```yaml
embedding:
  endpoint: http://内网嵌入服务:端口/v1
  model: bge-m3
```

**选项 B: 使用本地 Ollama**
```bash
docker compose --profile embedding up ollama -d
# 等待 Ollama 启动后拉取模型:
docker exec -it <ollama容器名> ollama pull bge-m3
```

### 修改源代码

源代码在 `source/` 目录中。如需修改并重新部署：

1. 修改 `source/` 中的代码
2. 在有互联网的机器上重新构建 Docker 镜像
3. 保存并替换 `images/` 中的 tar 文件
4. 在目标机器上重新 `./load-images.sh`

### pip wheels

`tools/pip-wheels/` 包含 131 个预下载的 Python 包（3.1GB）。
如果修改了 Python 服务（docling, paddleocr 等），可用这些 wheels 离线安装：

```bash
pip install --no-index --find-links=tools/pip-wheels/ <package>
```

## 故障排除

- **Backend 无法启动**: 检查 `config/default.yaml` 中的推理服务地址是否可达
- **PostgreSQL 连接失败**: 等待 postgres 容器完全启动（约 10 秒）
- **文档解析失败**: 确保 `models/docling/` 目录已正确挂载
- **嵌入服务报错**: 如果不用 Ollama，确保 `default.yaml` 中 embedding 配置指向了正确的服务

READMEEOF

echo ""
echo "======================================"
echo "  离线部署包构建完成!"
echo "======================================"
echo ""
echo "  输出目录: $OUTPUT_DIR"
echo ""
du -sh "$OUTPUT_DIR"/* 2>/dev/null
echo ""
echo "  总大小:"
du -sh "$OUTPUT_DIR"
echo ""
echo "打包命令 (可选):"
echo "  cd $(dirname "$OUTPUT_DIR") && tar czf deepanalyze-offline.tar.gz $(basename "$OUTPUT_DIR")"
