#!/bin/bash
# =============================================================================
# deploy.sh — One-command offline deployment for DeepAnalyze
# =============================================================================
# Usage:
#   ./deploy.sh              # Full deploy: load images + start services
#   ./deploy.sh start        # Start services only (images already loaded)
#   ./deploy.sh stop         # Stop all services
#   ./deploy.sh status       # Show service status
#   ./deploy.sh restart      # Restart all services
#   ./deploy.sh logs [svc]   # Show logs (optional: service name)
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Detect docker-compose command (v1 uses 'docker-compose', v2 uses 'docker compose')
detect_compose_cmd() {
    if command -v docker-compose &>/dev/null; then
        echo "docker-compose"
    elif docker compose version &>/dev/null 2>&1; then
        echo "docker compose"
    else
        echo "ERROR: docker-compose not found. Please install Docker Compose." >&2
        exit 1
    fi
}

COMPOSE_CMD=$(detect_compose_cmd)
IMAGE_DIR="$SCRIPT_DIR/images"

# Color output helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------------------------------------------------------------------------
# Load Docker images from tar files
# ---------------------------------------------------------------------------
load_images() {
    if [ ! -d "$IMAGE_DIR" ]; then
        log_error "Image directory not found: $IMAGE_DIR"
        log_error "Please ensure the offline package is complete."
        exit 1
    fi

    local tar_count=$(ls -1 "$IMAGE_DIR"/*.tar 2>/dev/null | wc -l)
    if [ "$tar_count" -eq 0 ]; then
        log_warn "No image tar files found in $IMAGE_DIR"
        return
    fi

    log_info "Loading Docker images..."
    for tar_file in "$IMAGE_DIR"/*.tar; do
        if [ -f "$tar_file" ]; then
            local name=$(basename "$tar_file")
            echo -n "  Loading $name ... "
            docker load -i "$tar_file" >/dev/null 2>&1 && echo "done" || echo "FAILED"
        fi
    done
    log_ok "All images loaded"
}

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------
check_prereqs() {
    log_info "Checking prerequisites..."

    if ! command -v docker &>/dev/null; then
        log_error "Docker not installed"
        exit 1
    fi
    log_ok "Docker: $(docker --version)"

    log_ok "Compose: $COMPOSE_CMD"

    # Check images are loaded
    local missing=0
    for img in deepanalyze-backend:offline deepanalyze-frontend:offline deepanalyze-pg:offline deepanalyze-embedding:offline; do
        if ! docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^${img}$"; then
            log_warn "Missing image: $img"
            missing=1
        fi
    done

    if [ "$missing" -eq 1 ]; then
        log_info "Some images are missing. Loading from tar files..."
        load_images
    fi

    log_ok "All required images present"
}

# ---------------------------------------------------------------------------
# Initialize environment
# ---------------------------------------------------------------------------
init_env() {
    if [ ! -f .env ]; then
        cp .env.example .env
        log_ok "Created .env from .env.example"
    fi

    # Create models/docling directory if model files need to be mounted
    mkdir -p models/docling
}

# ---------------------------------------------------------------------------
# Start all services
# ---------------------------------------------------------------------------
start_services() {
    echo ""
    echo "============================================"
    echo "  DeepAnalyze Offline Deployment"
    echo "============================================"
    echo ""

    check_prereqs
    init_env

    log_info "Starting services..."
    $COMPOSE_CMD up -d

    echo ""
    log_info "Waiting for services to be ready..."

    # Wait for PostgreSQL
    echo -n "  PostgreSQL: "
    local pg_ready=false
    for i in $(seq 1 30); do
        if $COMPOSE_CMD exec -T postgres pg_isready -U deepanalyze >/dev/null 2>&1; then
            echo "OK"
            pg_ready=true
            break
        fi
        sleep 1
    done
    if [ "$pg_ready" = false ]; then
        echo "TIMEOUT"
        log_error "PostgreSQL failed to start. Check logs: $COMPOSE_CMD logs postgres"
        exit 1
    fi

    # Wait for Embedding
    echo -n "  Embedding: "
    local emb_ready=false
    for i in $(seq 1 60); do
        if curl -sf http://localhost:11435/health >/dev/null 2>&1; then
            echo "OK"
            emb_ready=true
            break
        fi
        sleep 2
    done
    if [ "$emb_ready" = false ]; then
        echo "TIMEOUT (may still be loading model, will retry automatically)"
    fi

    # Wait for Backend
    echo -n "  Backend: "
    local be_ready=false
    for i in $(seq 1 60); do
        if curl -sf http://localhost:${BACKEND_PORT:-3000}/api/health >/dev/null 2>&1; then
            echo "OK"
            be_ready=true
            break
        fi
        sleep 2
    done
    if [ "$be_ready" = false ]; then
        echo "TIMEOUT"
        log_error "Backend failed to start. Check logs: $COMPOSE_CMD logs backend"
        exit 1
    fi

    # Wait for Frontend
    echo -n "  Frontend: "
    local fe_ready=false
    for i in $(seq 1 30); do
        if curl -sf http://localhost:${FRONTEND_PORT:-21000}/ >/dev/null 2>&1; then
            echo "OK"
            fe_ready=true
            break
        fi
        sleep 1
    done
    if [ "$fe_ready" = false ]; then
        echo "TIMEOUT"
        log_warn "Frontend not responding yet. Check logs: $COMPOSE_CMD logs frontend"
    fi

    echo ""
    echo "============================================"
    echo -e "  ${GREEN}DeepAnalyze is running!${NC}"
    echo "============================================"
    echo ""
    echo "  Web UI:    http://localhost:${FRONTEND_PORT:-21000}"
    echo "  API:       http://localhost:${BACKEND_PORT:-3000}/api"
    echo "  Health:    http://localhost:${BACKEND_PORT:-3000}/api/health"
    echo ""
    echo "  Next steps:"
    echo "    1. Open the Web UI in your browser"
    echo "    2. Go to Settings to configure your LLM provider"
    echo "       (or edit config/default.yaml and restart backend)"
    echo ""
    echo "  Commands:"
    echo "    ./deploy.sh status    # Check service status"
    echo "    ./deploy.sh logs      # View logs"
    echo "    ./deploy.sh stop      # Stop services"
    echo ""
}

# ---------------------------------------------------------------------------
# Stop all services
# ---------------------------------------------------------------------------
stop_services() {
    log_info "Stopping services..."
    $COMPOSE_CMD down
    log_ok "All services stopped. Data is preserved in Docker volumes."
    echo "  To start again: ./deploy.sh"
    echo "  To remove all data: $COMPOSE_CMD down -v"
}

# ---------------------------------------------------------------------------
# Show status
# ---------------------------------------------------------------------------
show_status() {
    echo ""
    echo "DeepAnalyze Service Status:"
    echo ""
    $COMPOSE_CMD ps
    echo ""

    # Quick health check
    local fe_port=${FRONTEND_PORT:-21000}
    local be_port=${BACKEND_PORT:-3000}

    echo -n "  Frontend (${fe_port}): "
    curl -sf http://localhost:${fe_port}/ >/dev/null 2>&1 && echo "OK" || echo "NOT RESPONDING"

    echo -n "  Backend (${be_port}): "
    curl -sf http://localhost:${be_port}/api/health >/dev/null 2>&1 && echo "OK" || echo "NOT RESPONDING"

    echo -n "  Embedding: "
    docker exec $($COMPOSE_CMD ps -q embedding 2>/dev/null) curl -sf http://localhost:11435/health >/dev/null 2>&1 && echo "OK" || echo "NOT RESPONDING"
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "${1:-}" in
    start)
        init_env
        log_info "Starting services..."
        $COMPOSE_CMD up -d
        ;;
    stop)
        stop_services
        ;;
    restart)
        $COMPOSE_CMD restart
        log_ok "Services restarted"
        ;;
    status)
        show_status
        ;;
    logs)
        shift
        $COMPOSE_CMD logs --tail=100 ${1:-}
        ;;
    load)
        load_images
        ;;
    *)
        start_services
        ;;
esac
