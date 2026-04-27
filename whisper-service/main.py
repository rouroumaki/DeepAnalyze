#!/usr/bin/env python3
"""
Whisper ASR Python subprocess service.

Communicates over stdin/stdout using JSON-line protocol.
Each line read from stdin is a JSON request; each line written to stdout is a
JSON response.

Supports concurrent transcription via thread pool executor.

Request format:
    {"id": "<string>", "file_path": "<string>", "language": "zh"|null, "model_size": "base"}

Response format:
    {"id": "<string>", "status": "ok"|"error", "data": {"text": "...", "language": "..."}, "error": "<string>"}
"""

from __future__ import annotations

import asyncio
import json
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Lazy-loaded Whisper model cache
# ---------------------------------------------------------------------------

_whisper_module: Any = None
_model_cache: Dict[str, Any] = {}


def _get_whisper():
    """Lazily import the whisper module."""
    global _whisper_module
    if _whisper_module is None:
        import whisper
        _whisper_module = whisper
    return _whisper_module


def _get_model(model_size: str):
    """Load (or retrieve from cache) a Whisper model of the given size."""
    if model_size not in _model_cache:
        whisper = _get_whisper()
        _model_cache[model_size] = whisper.load_model(model_size, device="cpu")
    return _model_cache[model_size]


def transcribe_sync(
    file_path: str,
    language: Optional[str] = None,
    model_size: str = "base",
) -> Dict[str, Any]:
    """Run Whisper transcription synchronously (called from thread pool)."""
    model = _get_model(model_size)

    transcribe_kwargs: Dict[str, Any] = {}
    if language:
        transcribe_kwargs["language"] = language

    result = model.transcribe(file_path, **transcribe_kwargs)

    return {
        "text": result.get("text", ""),
        "language": result.get("language", None),
    }


# ---------------------------------------------------------------------------
# Concurrency control
# ---------------------------------------------------------------------------

MAX_CONCURRENT_TRANSCRIPTIONS = 2

_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_TRANSCRIPTIONS)
_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TRANSCRIPTIONS)


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------

async def handle_request(raw: str) -> str:
    """Parse a single JSON-line request, dispatch to Whisper, return JSON-line response."""
    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        return json.dumps({"id": None, "status": "error", "error": f"Invalid JSON: {exc}"})

    request_id = request.get("id")
    file_path = request.get("file_path")
    language = request.get("language") or None
    model_size = request.get("model_size", "base")

    if not file_path:
        return json.dumps({"id": request_id, "status": "error", "error": "Missing file_path"})

    # Validate model_size
    valid_sizes = {"tiny", "base", "small", "medium", "large"}
    if model_size not in valid_sizes:
        return json.dumps({
            "id": request_id,
            "status": "error",
            "error": f"Invalid model_size '{model_size}'. Must be one of: {', '.join(sorted(valid_sizes))}",
        })

    try:
        async with _semaphore:
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(
                _executor, transcribe_sync, file_path, language, model_size
            )
        return json.dumps({"id": request_id, "status": "ok", "data": data})
    except Exception as exc:
        tb = traceback.format_exc()
        return json.dumps({"id": request_id, "status": "error", "error": f"{exc}\n{tb}"})


# ---------------------------------------------------------------------------
# Main event loop
# ---------------------------------------------------------------------------

async def read_stdin_loop() -> None:
    """Main event loop: read lines from stdin, process, write to stdout."""
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()

    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    writer_transport, writer_protocol = await loop.connect_write_pipe(
        asyncio.streams.FlowControlMixin, sys.stdout
    )
    writer = asyncio.StreamWriter(writer_transport, writer_protocol, reader, loop)

    while True:
        line: bytes = await reader.readline()
        if not line:
            # EOF - parent process closed stdin
            break

        decoded = line.decode("utf-8").strip()
        if not decoded:
            continue

        response = await handle_request(decoded)
        writer.write((response + "\n").encode("utf-8"))
        await writer.drain()

    writer.close()


def main() -> None:
    asyncio.run(read_stdin_loop())


if __name__ == "__main__":
    main()
