#!/bin/bash
# =============================================================================
# stop.sh — 停止 DeepAnalyze 所有服务
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "停止 DeepAnalyze 服务..."
docker compose --profile embedding down

echo ""
echo "服务已停止。数据保留在 Docker volumes 中。"
echo "重新启动: ./start.sh"
echo "完全清除数据: docker compose --profile embedding down -v"
