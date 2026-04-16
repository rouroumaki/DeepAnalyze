#!/usr/bin/env python3
"""DeepAnalyze 一键启动脚本 — 检查环境、启动容器、构建前端、启动后端

用法:
    python start.py                    # 一键启动（自动启动 PostgreSQL + Ollama + 后端）
    python start.py --port 8080        # 自定义端口
    python start.py --dev              # 开发模式（前端热重载 + 后端热重载）
    python start.py --skip-frontend    # 跳过前端构建
    python start.py --no-docker        # 不启动 Docker，仅使用 SQLite
"""

from __future__ import annotations

import argparse
import os
import re
import signal
import socket
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

# 项目根目录
PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"
PID_FILE = DATA_DIR / ".deepanalyze.pid"

# 默认配置
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 21000
TOTAL_STEPS = 9

# 需要创建的目录
REQUIRED_DIRS = [
    DATA_DIR,
    DATA_DIR / "logs",
    DATA_DIR / "models",
    PROJECT_ROOT / "config",
    PROJECT_ROOT / "uploads",
]


# ============================================================================
# 工具函数
# ============================================================================


def _step(step: int, msg: str) -> None:
    print(f"  [{step}/{TOTAL_STEPS}] {msg}...", flush=True)


def _ok(msg: str = "OK") -> None:
    print(f"       [{msg}]", flush=True)


def _warn(msg: str) -> None:
    print(f"       [WARN] {msg}", flush=True)


def _fail(msg: str) -> None:
    print(f"       [FAIL] {msg}", flush=True)


def _info(msg: str) -> None:
    print(f"       {msg}", flush=True)


# ============================================================================
# Phase 1: 检查 Node.js 环境
# ============================================================================


def check_environment() -> None:
    _step(1, "检查运行环境")

    node_path = shutil.which("node")
    if not node_path:
        _fail("未安装 Node.js，请安装 Node.js >= 18")
        _info("  下载地址: https://nodejs.org/")
        sys.exit(1)

    result = subprocess.run(
        ["node", "-v"], capture_output=True, text=True
    )
    version = result.stdout.strip()
    major = int(version.lstrip("v").split(".")[0])

    if major < 18:
        _fail(f"Node.js 版本过低: {version}，需要 >= 18")
        sys.exit(1)

    _ok(f"Node.js {version}")


# ============================================================================
# Phase 2: 检查 Docker 环境
# ============================================================================


def check_docker() -> bool:
    """Check if Docker is available and running. Returns True if usable."""
    _step(2, "检查 Docker 环境")

    if sys.platform == "win32":
        docker_cmd = "docker.exe"
    else:
        docker_cmd = "docker"

    docker_path = shutil.which(docker_cmd)
    if not docker_path:
        _warn("Docker 未安装，将使用 SQLite（功能有限）")
        _info("  安装 Docker 可启用向量检索和全文搜索")
        return False

    result = subprocess.run(
        [docker_cmd, "info"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        _warn("Docker 未运行，将使用 SQLite（功能有限）")
        _info("  启动 Docker Desktop 可启用向量检索和全文搜索")
        return False

    _ok("Docker 就绪")
    return True


# ============================================================================
# Phase 3: 启动 Docker 容器（PostgreSQL + Ollama）
# ============================================================================


def start_containers() -> bool:
    """Start PostgreSQL + Ollama containers. Returns True if PG is available."""
    _step(3, "启动数据库和模型服务")

    compose_file = PROJECT_ROOT / "docker-compose.dev.yml"
    if not compose_file.exists():
        _warn("docker-compose.dev.yml 不存在，跳过")
        return False

    docker_cmd = "docker.exe" if sys.platform == "win32" else "docker"
    compose_cmd = [docker_cmd, "compose", "-f", str(compose_file)]

    # Start containers
    _info("  启动 PostgreSQL + Ollama 容器...")
    result = subprocess.run(
        compose_cmd + ["up", "-d", "--build"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        _warn("容器启动失败，将使用 SQLite")
        _info(f"  {result.stderr.strip()[:200]}")
        return False

    # Wait for PostgreSQL to be healthy
    _info("  等待 PostgreSQL 就绪...")
    retries = 0
    max_retries = 40
    while retries < max_retries:
        result = subprocess.run(
            compose_cmd + ["exec", "-T", "postgres",
                           "pg_isready", "-U", "deepanalyze", "-d", "deepanalyze"],
            capture_output=True, text=True, check=False,
        )
        if result.returncode == 0:
            break
        time.sleep(1)
        retries += 1

    if retries >= max_retries:
        _warn("PostgreSQL 启动超时，将使用 SQLite")
        return False

    # Check Ollama
    try:
        import urllib.request
        urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=3)
        _ok("PostgreSQL + Ollama 就绪")
    except Exception:
        _ok("PostgreSQL 就绪 (Ollama 首次启动需下载模型，请稍候)")

    return True


# ============================================================================
# Phase 2: 检查前端构建
# ============================================================================


def check_frontend(skip: bool = False, dev: bool = False) -> None:
    _step(4, "检查前端构建")

    if skip:
        _ok("SKIP")
        return

    frontend_dir = PROJECT_ROOT / "frontend"
    dist_dir = frontend_dir / "dist"
    src_dir = frontend_dir / "src"

    if not (frontend_dir / "package.json").exists():
        _warn("前端目录不完整，跳过")
        return

    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    npm_path = shutil.which(npm_cmd)
    if not npm_path:
        if not (dist_dir / "index.html").exists():
            _fail("未安装 npm，无法构建前端")
            sys.exit(1)
        _warn("未安装 npm，使用已有前端构建（可能过时）")
        return

    if dev:
        if not (frontend_dir / "node_modules").exists():
            _info("  安装前端依赖...")
            subprocess.run(
                [npm_cmd, "install"],
                cwd=str(frontend_dir),
                check=True,
            )
        _ok("开发模式，跳过构建")
        return

    needs_build = False
    dist_index = dist_dir / "index.html"

    if not dist_index.exists():
        needs_build = True
        _info("  前端未构建")
    else:
        dist_mtime = dist_index.stat().st_mtime
        src_mtime = _get_newest_mtime(src_dir)
        if src_mtime > dist_mtime:
            needs_build = True
            _info("  源文件已变更，需要重建")

    if not needs_build:
        _ok("前端已是最新")
        return

    if not (frontend_dir / "node_modules").exists():
        _info("  安装前端依赖...")
        result = subprocess.run(
            [npm_cmd, "install"],
            cwd=str(frontend_dir),
        )
        if result.returncode != 0:
            _fail("npm install 失败")
            sys.exit(1)

    _info("  构建前端...")
    result = subprocess.run(
        [npm_cmd, "run", "build"],
        cwd=str(frontend_dir),
    )
    if result.returncode != 0:
        _fail("前端构建失败")
        sys.exit(1)

    _ok("前端构建完成")


def _get_newest_mtime(directory: Path) -> float:
    newest = 0.0
    try:
        for entry in directory.rglob("*"):
            if entry.is_file():
                mtime = entry.stat().st_mtime
                if mtime > newest:
                    newest = mtime
    except OSError:
        pass
    return newest


# ============================================================================
# Phase 3: 创建目录
# ============================================================================


def setup_directories() -> None:
    _step(5, "创建目录结构")

    created = 0
    for d in REQUIRED_DIRS:
        if not d.exists():
            d.mkdir(parents=True, exist_ok=True)
            created += 1

    # 确保默认配置文件存在
    config_file = PROJECT_ROOT / "config" / "default.yaml"
    if not config_file.exists():
        config_file.write_text("""# DeepAnalyze fallback config
# Provider settings are managed via the web UI (Settings tab).
# This file is only used if no database settings exist.
models:
  main:
    provider: openai-compatible
    endpoint: http://localhost:11434/v1
    model: qwen2.5-14b
    maxTokens: 32768
    supportsToolUse: true
defaults:
  main: main
""")
        created += 1

    if created > 0:
        _ok(f"创建了 {created} 个项目")
    else:
        _ok("所有目录就绪")


# ============================================================================
# Phase 4: 清理残留进程
# ============================================================================


def cleanup_orphan() -> None:
    _step(6, "清理残留进程")

    if not PID_FILE.exists():
        _ok("无残留进程")
        return

    try:
        pid = int(PID_FILE.read_text().strip())
    except (ValueError, OSError):
        PID_FILE.unlink(missing_ok=True)
        _ok("PID 文件无效，已清理")
        return

    if not _is_process_alive(pid):
        PID_FILE.unlink(missing_ok=True)
        _ok("无残留进程")
        return

    _info(f"  发现残留进程 (PID: {pid})，正在终止...")
    _kill_process(pid)
    time.sleep(1)

    if _is_process_alive(pid):
        _warn(f"进程 {pid} 未能终止")
    else:
        _ok(f"已终止进程 {pid}")

    PID_FILE.unlink(missing_ok=True)


def _is_process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _kill_process(pid: int) -> None:
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/F", "/PID", str(pid)],
            capture_output=True, check=False
        )
    else:
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(0.5)
            if _is_process_alive(pid):
                os.kill(pid, signal.SIGKILL)
        except OSError:
            pass


def _kill_port_user(port: int) -> bool:
    """Find and kill processes occupying the given port. Returns True if any were killed."""
    pids = _get_port_pids(port)
    if not pids:
        return False

    for pid in pids:
        _info(f"  终止占用端口的进程 (PID: {pid})")
        _kill_process(pid)

    # Also kill any child processes
    time.sleep(0.5)
    for pid in pids:
        _kill_child_processes(pid)

    return True


def _get_port_pids(port: int) -> list[int]:
    """Get list of PIDs that are listening on the given port."""
    pids: list[int] = []
    if sys.platform == "win32":
        result = subprocess.run(
            ["netstat", "-aon"],
            capture_output=True, text=True, check=False,
        )
        for line in result.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.split()
                if parts:
                    try:
                        pids.append(int(parts[-1]))
                    except ValueError:
                        pass
    else:
        # Try lsof first (works on macOS and some Linux)
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True, check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            for line in result.stdout.strip().splitlines():
                try:
                    pids.append(int(line.strip()))
                except ValueError:
                    pass

        # Try fuser if lsof didn't find anything
        if not pids:
            result = subprocess.run(
                ["fuser", f"{port}/tcp"],
                capture_output=True, text=True, check=False,
            )
            if result.stdout.strip():
                for token in result.stdout.strip().split():
                    try:
                        pids.append(int(token.strip()))
                    except ValueError:
                        pass

        # Try ss as last resort (common on Linux)
        if not pids:
            result = subprocess.run(
                ["ss", "-tlnp", f"sport = :{port}"],
                capture_output=True, text=True, check=False,
            )
            for line in result.stdout.splitlines():
                # Extract pid from output like: users:(("node",pid=12345,fd=18))
                import re as _re
                match = _re.search(r'pid=(\d+)', line)
                if match:
                    try:
                        pids.append(int(match.group(1)))
                    except ValueError:
                        pass

    return list(dict.fromkeys(pids))  # deduplicate while preserving order


def _kill_child_processes(parent_pid: int) -> None:
    """Kill child processes of a given parent PID (Linux/macOS only)."""
    if sys.platform == "win32":
        return
    try:
        result = subprocess.run(
            ["pgrep", "-P", str(parent_pid)],
            capture_output=True, text=True, check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            for line in result.stdout.strip().splitlines():
                try:
                    child_pid = int(line.strip())
                    _kill_process(child_pid)
                except ValueError:
                    pass
    except Exception:
        pass


# ============================================================================
# Phase 5: 检查端口
# ============================================================================


def check_port(host: str, port: int) -> None:
    _step(7, f"检查端口 {port}")

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((host, port))
        _ok("端口空闲")
    except OSError:
        # Port is occupied — try to find and kill the process using it
        _info(f"  端口 {port} 已被占用，尝试释放...")
        killed = _kill_port_user(port)
        if killed:
            # Wait a moment for the port to be released
            time.sleep(1.5)
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    s.bind((host, port))
                _ok(f"已释放端口 {port}")
            except OSError:
                _fail(f"端口 {port} 释放后仍被占用")
                _info("  解决方法:")
                _info(f"    使用 --port 指定其他端口")
                _info(f"    或手动执行: fuser -k {port}/tcp")
                sys.exit(1)
        else:
            _fail(f"端口 {port} 已被占用，无法自动释放")
            _info("  解决方法:")
            _info(f"    使用 --port 指定其他端口")
            _info(f"    或手动执行: fuser -k {port}/tcp")
            sys.exit(1)


# ============================================================================
# Phase 6: 验证数据库
# ============================================================================


def validate_database() -> None:
    _step(8, "验证数据库")

    db_path = DATA_DIR / "deepanalyze.db"

    if not db_path.exists():
        _ok("首次启动，数据库将自动创建")
        return

    try:
        conn = sqlite3.connect(str(db_path))
        result = conn.execute("PRAGMA integrity_check").fetchone()
        conn.close()

        if result and result[0] == "ok":
            size_kb = db_path.stat().st_size / 1024
            _ok(f"SQLite 正常 ({size_kb:.0f} KB)")
        else:
            _warn(f"数据库可能损坏: {result}")
            _info("  建议备份后删除 data/deepanalyze.db 重启")
    except Exception as e:
        _warn(f"数据库检查失败: {e}")


# ============================================================================
# Phase 7: 启动服务
# ============================================================================


def start_server(host: str, port: int, dev: bool = False, pg_available: bool = False) -> None:
    _step(9, "启动服务")

    vite_proc = None
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_dir = PROJECT_ROOT / "frontend"

    # 启动后端
    _info("  启动后端服务...")
    backend_env = {**os.environ, "PORT": str(port)}
    if pg_available:
        backend_env["PG_HOST"] = "localhost"
        backend_env["PG_PORT"] = os.environ.get("PG_PORT", "5432")
        backend_env["PG_DATABASE"] = os.environ.get("PG_DATABASE", "deepanalyze")
        backend_env["PG_USER"] = os.environ.get("PG_USER", "deepanalyze")
        backend_env["PG_PASSWORD"] = os.environ.get("PG_PASSWORD", "deepanalyze_dev")

    backend_proc = subprocess.Popen(
        [npx_cmd, "tsx", "src/main.ts"],
        cwd=str(PROJECT_ROOT),
        env=backend_env,
    )

    # 写入 PID 文件
    PID_FILE.write_text(str(backend_proc.pid))

    # 开发模式：启动 Vite 开发服务器
    if dev and (frontend_dir / "package.json").exists():
        _info("  启动前端开发服务器...")
        vite_proc = subprocess.Popen(
            [npm_cmd, "run", "dev"],
            cwd=str(frontend_dir),
        )

    # 等待后端就绪
    _info("  等待后端就绪...")
    retries = 0
    while retries < 30:
        try:
            import urllib.request
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2)
            break
        except Exception:
            time.sleep(1)
            retries += 1

    print()
    print("=" * 55)
    print(f"  DeepAnalyze - 深度分析系统{' (开发模式)' if dev else ''}")
    print(f"  后端地址: http://{host}:{port}")
    print(f"  API 文档: http://{host}:{port}/api/health")
    if pg_available:
        print(f"  数据库:   PostgreSQL (向量检索 + 全文搜索)")
    else:
        print(f"  数据库:   SQLite")
    if dev:
        print(f"  前端开发: http://127.0.0.1:3000")
    else:
        print(f"  前端页面: http://{host}:{port}")
    print("=" * 55)
    print()
    print("  提示: 按 Ctrl+C 停止所有服务")
    print()

    def _cleanup(signum=None, frame=None):
        print()
        _info("正在停止服务...")
        if vite_proc is not None:
            vite_proc.terminate()
            try:
                vite_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                vite_proc.kill()
        backend_proc.terminate()
        try:
            backend_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend_proc.kill()
        # Stop Docker containers
        if pg_available:
            _info("停止数据库和模型容器...")
            docker_cmd = "docker.exe" if sys.platform == "win32" else "docker"
            compose_file = PROJECT_ROOT / "docker-compose.dev.yml"
            subprocess.run(
                [docker_cmd, "compose", "-f", str(compose_file), "down"],
                capture_output=True, check=False,
            )
        PID_FILE.unlink(missing_ok=True)
        _ok("所有服务已停止")
        sys.exit(0)

    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)

    try:
        backend_proc.wait()
    except KeyboardInterrupt:
        _cleanup()


# ============================================================================
# Banner + main
# ============================================================================


def print_banner() -> None:
    print()
    print("  ╔═══════════════════════════════════════╗")
    print("  ║  DeepAnalyze - 深度分析系统 v0.1.0    ║")
    print("  ╚═══════════════════════════════════════╝")
    print()
    print("  正在启动...\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="DeepAnalyze 一键启动脚本",
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"监听地址 (默认: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"监听端口 (默认: {DEFAULT_PORT})")
    parser.add_argument("--dev", action="store_true", help="开发模式（前端热重载）")
    parser.add_argument("--skip-frontend", action="store_true", help="跳过前端构建")
    parser.add_argument("--no-docker", action="store_true", help="不启动 Docker 容器（仅 SQLite）")
    args = parser.parse_args()

    print_banner()

    check_environment()

    pg_available = False
    if not args.no_docker:
        docker_ok = check_docker()
        if docker_ok:
            pg_available = start_containers()

    check_frontend(skip=args.skip_frontend, dev=args.dev)
    setup_directories()
    cleanup_orphan()
    check_port(args.host, args.port)
    validate_database()
    start_server(args.host, args.port, dev=args.dev, pg_available=pg_available)


if __name__ == "__main__":
    main()
