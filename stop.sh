#!/usr/bin/env bash
# =============================================================================
# DeepAnalyze - Stop Script
# =============================================================================
# Stops both backend and frontend servers.
#
# Usage:
#   ./stop.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PID_FILE="$SCRIPT_DIR/.backend.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/.frontend.pid"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }

stopped_something=false

# Stop backend
if [ -f "$BACKEND_PID_FILE" ]; then
  pid=$(cat "$BACKEND_PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    log_info "Stopping backend (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    stopped_something=true
  fi
  rm -f "$BACKEND_PID_FILE"
fi

# Stop frontend
if [ -f "$FRONTEND_PID_FILE" ]; then
  pid=$(cat "$FRONTEND_PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    log_info "Stopping frontend (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    stopped_something=true
  fi
  rm -f "$FRONTEND_PID_FILE"
fi

# Also try to kill any processes on our ports as a fallback
for port in 21000 3000; do
  pid=$(lsof -t -i :$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    log_info "Killing process on port $port (PID $pid)..."
    kill $pid 2>/dev/null || true
    stopped_something=true
  fi
done

if [ "$stopped_something" = true ]; then
  log_info "DeepAnalyze stopped."
else
  echo -e "${YELLOW}[WARN]${NC} No running DeepAnalyze processes found."
fi
