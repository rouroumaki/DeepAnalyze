#!/usr/bin/env bash
# =============================================================================
# DeepAnalyze - Start Script
# =============================================================================
# Starts both backend and frontend with a single command.
# On first run, auto-initializes everything: directories, database, dependencies.
#
# Usage:
#   ./start.sh          # Start in foreground (Ctrl+C to stop)
#   ./start.sh bg       # Start in background
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PID_FILE="$SCRIPT_DIR/.backend.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/.frontend.pid"
LOG_DIR="$SCRIPT_DIR/logs"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

print_banner() {
  echo ""
  echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║         DeepAnalyze - 深度分析系统               ║${NC}"
  echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
  echo ""
}

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------------------------------------------------------------------------
# Step 1: Check prerequisites
# ---------------------------------------------------------------------------
check_prerequisites() {
  log_info "Checking prerequisites..."

  # Check Node.js
  if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js >= 18."
    exit 1
  fi

  local node_version=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$node_version" -lt 18 ]; then
    log_error "Node.js >= 18 required (found $(node -v))."
    exit 1
  fi

  log_info "Node.js $(node -v) found"
}

# ---------------------------------------------------------------------------
# Step 2: Install dependencies (if needed)
# ---------------------------------------------------------------------------
install_deps() {
  if [ ! -d "node_modules" ]; then
    log_info "Installing backend dependencies..."
    npm install
  fi

  if [ ! -d "frontend/node_modules" ]; then
    log_info "Installing frontend dependencies..."
    cd frontend && npm install && cd ..
  fi
}

# ---------------------------------------------------------------------------
# Step 3: Auto-initialize directories and database
# ---------------------------------------------------------------------------
auto_init() {
  log_info "Auto-initializing..."

  # Create required directories
  mkdir -p data
  mkdir -p config
  mkdir -p uploads
  mkdir -p logs

  # Create default YAML config if not exists
  if [ ! -f "config/default.yaml" ]; then
    cat > config/default.yaml << 'YAML_EOF'
# DeepAnalyze default configuration
# ================================
#
# This file is the FALLBACK configuration. Provider settings are managed
# through the web UI and stored in the database. This file is only used
# if no database settings are found.
#
# Configure your model providers at http://localhost:3000 (Settings tab)
# after starting the application.

models:
  main:
    provider: openai-compatible
    endpoint: http://localhost:11434/v1
    model: qwen2.5-14b
    maxTokens: 32768
    supportsToolUse: true

defaults:
  main: main
YAML_EOF
    log_info "Created default config/default.yaml"
  fi

  log_info "Auto-initialization complete"
}

# ---------------------------------------------------------------------------
# Step 4: Kill any existing instances
# ---------------------------------------------------------------------------
kill_existing() {
  if [ -f "$BACKEND_PID_FILE" ]; then
    local pid=$(cat "$BACKEND_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      log_warn "Stopping existing backend (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$BACKEND_PID_FILE"
  fi

  if [ -f "$FRONTEND_PID_FILE" ]; then
    local pid=$(cat "$FRONTEND_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      log_warn "Stopping existing frontend (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$FRONTEND_PID_FILE"
  fi
}

# ---------------------------------------------------------------------------
# Step 5: Start backend
# ---------------------------------------------------------------------------
start_backend() {
  log_info "Starting backend server..."
  npx tsx src/main.ts > "$LOG_DIR/backend.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$BACKEND_PID_FILE"

  # Wait for backend to be ready
  local retries=0
  local max_retries=30
  while [ $retries -lt $max_retries ]; do
    if curl -s http://localhost:21000/api/health > /dev/null 2>&1; then
      log_info "Backend ready (PID $pid) on http://localhost:21000"
      return 0
    fi
    retries=$((retries + 1))
    sleep 1
  done

  log_error "Backend failed to start. Check logs/backend.log"
  tail -20 "$LOG_DIR/backend.log"
  exit 1
}

# ---------------------------------------------------------------------------
# Step 6: Start frontend
# ---------------------------------------------------------------------------
start_frontend() {
  log_info "Starting frontend dev server..."
  cd frontend && npx vite --host > "$LOG_DIR/frontend.log" 2>&1 &
  local pid=$!
  cd ..
  echo "$pid" > "$FRONTEND_PID_FILE"

  # Wait for frontend to be ready
  local retries=0
  local max_retries=30
  while [ $retries -lt $max_retries ]; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
      log_info "Frontend ready (PID $pid) on http://localhost:3000"
      return 0
    fi
    retries=$((retries + 1))
    sleep 1
  done

  log_error "Frontend failed to start. Check logs/frontend.log"
  tail -20 "$LOG_DIR/frontend.log"
  exit 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  print_banner
  check_prerequisites
  install_deps
  auto_init
  kill_existing

  start_backend
  start_frontend

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  DeepAnalyze is running!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BLUE}Frontend:${NC}  http://localhost:3000"
  echo -e "  ${BLUE}Backend:${NC}   http://localhost:21000"
  echo -e "  ${BLUE}API Docs:${NC}  http://localhost:21000/api/health"
  echo ""
  echo -e "  ${YELLOW}Logs:${NC}      $LOG_DIR/backend.log"
  echo -e "             $LOG_DIR/frontend.log"
  echo ""

  if [ "$1" = "bg" ]; then
    echo -e "  Running in background. Use ${YELLOW}./stop.sh${NC} to stop."
    echo ""
    # Keep script alive to handle Ctrl+C gracefully
    trap 'echo ""; log_info "Stopping..."; ./stop.sh; exit 0' SIGINT SIGTERM
    wait
  else
    echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop."
    echo ""
    # Forward signals to child processes
    trap 'echo ""; log_info "Stopping..."; ./stop.sh; exit 0' SIGINT SIGTERM
    wait
  fi
}

main "$@"
