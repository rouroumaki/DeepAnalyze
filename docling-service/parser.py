"""
Document parser module using Docling.

Provides the parse_document function which converts a document file into
structured data (markdown content, tables, images, metadata).

Supports dynamic model selection via model_config:
  - layout_model:  repo_id or local path for layout detection
  - ocr_engine:    "rapidocr" | "easyocr" | "tesseract"
  - ocr_backend:   "torch" | "onnxruntime"  (RapidOCR only)
  - ocr_lang:      language list e.g. ["chinese", "english"]
  - table_mode:    "accurate" | "fast"
  - use_vlm:       boolean
  - vlm_model:     repo_id for VLM model
  - artifacts_path: local model root directory
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

logging.basicConfig(level=logging.INFO)
_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Converter cache (keyed by config hash) — thread-safe
# ---------------------------------------------------------------------------

_converter_cache: dict[str, Any] = {}
_cache_lock = threading.Lock()


def _config_hash(cfg: dict) -> str:
    """Produce a stable hash from a model config dict for caching."""
    return json.dumps(cfg, sort_keys=True)


def _get_converter(model_config: dict):
    """Build (or retrieve cached) DocumentConverter from a model_config dict.

    Thread-safe: uses _cache_lock to protect the cache.

    model_config keys:
      - artifacts_path (str): Local model root directory (data/models/docling)
      - layout_model   (str): repo_id e.g. "docling-project/docling-layout-egret-xlarge"
      - ocr_engine     (str): "rapidocr" | "easyocr" | "tesseract"
      - ocr_backend    (str): "torch" | "onnxruntime"
      - ocr_lang       (list[str]): e.g. ["chinese", "english"]
      - table_mode     (str): "accurate" | "fast"
      - use_vlm        (bool): Whether to use VLM pipeline
      - vlm_model      (str): VLM repo_id e.g. "stepfun-ai/GOT-OCR-2.0-hf"
    """
    cache_key = _config_hash(model_config)
    with _cache_lock:
        if cache_key in _converter_cache:
            return _converter_cache[cache_key]

    # Build outside the lock (expensive operation)
    use_vlm = model_config.get("use_vlm", False)
    if use_vlm:
        converter = _build_vlm_converter(model_config)
    else:
        converter = _build_standard_converter(model_config)

    with _cache_lock:
        _converter_cache[cache_key] = converter
    return converter


def _resolve_layout_model_spec(model_config: dict):
    """Resolve the layout model spec from model_config.

    Returns a LayoutModelConfig instance from docling's built-in specs,
    or constructs one for a custom model repo_id.
    """
    from docling.datamodel.layout_model_specs import (
        DOCLING_LAYOUT_EGRET_XLARGE,
        DOCLING_LAYOUT_HERON,
        LayoutModelConfig,
    )

    layout_model = model_config.get("layout_model", "docling-project/docling-layout-egret-xlarge")

    # Map repo_id to built-in spec
    spec_map = {
        "docling-project/docling-layout-egret-xlarge": DOCLING_LAYOUT_EGRET_XLARGE,
        "docling-project/docling-layout-heron": DOCLING_LAYOUT_HERON,
    }

    spec = spec_map.get(layout_model)

    if spec is None:
        # Custom/unknown model — construct a LayoutModelConfig
        spec = LayoutModelConfig(
            name=layout_model.split("/")[-1],
            repo_id=layout_model,
            revision="main",
            model_path="",
        )
        _log.info("Using custom layout model: %s", layout_model)

    return spec


def _build_standard_converter(model_config: dict):
    """Build a standard-pipeline DocumentConverter from model_config."""
    import os
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TableFormerMode,
    )

    pipeline_options = PdfPipelineOptions()

    # --- Artifacts path ---
    # docling expects: artifacts_path/<org>--<model>/
    # Our directory structure is: data/models/docling/layout/<org>--<model>/
    # Set artifacts_path only if the layout subdirectory exists and contains models.
    artifacts_path = model_config.get("artifacts_path", "")
    if artifacts_path and os.path.isdir(artifacts_path):
        # Check if models exist directly under artifacts_path (flat layout)
        # or under subdirectories (category layout)
        layout_dir = os.path.join(artifacts_path, "layout")
        if os.path.isdir(layout_dir):
            # Category layout — don't set artifacts_path on pipeline_options
            # because docling expects flat structure. Rely on HF cache instead.
            _log.info("Category-based model layout detected at %s, using HF cache", artifacts_path)
        else:
            # Flat layout — docling can use this directly
            pipeline_options.artifacts_path = artifacts_path
            _log.info("Using local artifacts path: %s", artifacts_path)

    # --- Layout model ---
    layout_spec = _resolve_layout_model_spec(model_config)
    if layout_spec is not None:
        pipeline_options.layout_options.model_spec = layout_spec

    # --- OCR engine ---
    ocr_engine = model_config.get("ocr_engine", "rapidocr")
    ocr_backend = model_config.get("ocr_backend", "torch")
    ocr_lang = model_config.get("ocr_lang", ["chinese", "english"])

    if ocr_engine == "rapidocr":
        from docling.datamodel.pipeline_options import RapidOcrOptions
        pipeline_options.ocr_options = RapidOcrOptions(
            lang=ocr_lang,
            backend=ocr_backend,
            text_score=0.5,
        )
    elif ocr_engine == "easyocr":
        from docling.datamodel.pipeline_options import EasyOcrOptions
        pipeline_options.ocr_options = EasyOcrOptions(lang=ocr_lang)
    elif ocr_engine == "tesseract":
        from docling.datamodel.pipeline_options import TesseractOcrOptions
        pipeline_options.ocr_options = TesseractOcrOptions(lang=ocr_lang)

    # --- Table mode ---
    table_mode = model_config.get("table_mode", "accurate")
    if table_mode == "accurate":
        pipeline_options.table_structure_options.mode = TableFormerMode.ACCURATE
    else:
        pipeline_options.table_structure_options.mode = TableFormerMode.FAST

    # --- Page images for downstream use ---
    pipeline_options.generate_page_images = True

    converter = DocumentConverter(
        format_options={
            "pdf": PdfFormatOption(
                pipeline_options=pipeline_options,
            ),
        },
    )

    return converter


def _build_vlm_converter(model_config: dict):
    """Build a VLM-pipeline DocumentConverter from model_config."""
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.pipeline_options import VlmPipelineOptions, InlineVlmOptions
    from docling.models.inference_engines.vlm.base import VlmEngineType
    from docling.pipeline.vlm_pipeline import VlmPipeline

    vlm_model = model_config.get("vlm_model", "stepfun-ai/GOT-OCR-2.0-hf")

    # Try to find a built-in VLM spec
    vlm_spec = None
    try:
        from docling.datamodel.vlm_model_specs import GOT2_TRANSFORMERS
        vlm_spec_map = {
            "stepfun-ai/GOT-OCR-2.0-hf": GOT2_TRANSFORMERS,
        }
        vlm_spec = vlm_spec_map.get(vlm_model)
    except ImportError:
        pass

    if vlm_spec is None:
        _log.warning("VLM model %s not found in built-in specs, VLM may fail", vlm_model)

    pipeline_options = VlmPipelineOptions(
        vlm_options=InlineVlmOptions(
            engine_type=VlmEngineType.TRANSFORMERS,
            model_spec=vlm_spec,
        ),
    )

    converter = DocumentConverter(
        format_options={
            "pdf": PdfFormatOption(
                pipeline_cls=VlmPipeline,
                pipeline_options=pipeline_options,
            ),
        },
    )

    return converter


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def parse_document(file_path: str, options: dict | None = None) -> dict[str, Any]:
    """Parse a document using Docling and return a structured result.

    This is the async version kept for backward compatibility.
    For thread pool usage, prefer parse_document_sync().
    """
    return parse_document_sync(file_path, options)


def parse_document_sync(file_path: str, options: dict | None = None) -> dict[str, Any]:
    """Synchronous document parsing — safe to call from thread pool executor.

    Args:
        file_path: Absolute or relative path to the document file.
        options: Optional dictionary with parsing hints.
            - ocr (bool): Whether to enable OCR. Defaults to True.
            - extract_tables (bool): Whether to extract table data. Defaults to True.
            - use_vlm (bool): Use VLM pipeline for highest quality.
            - model_config (dict): Dynamic model configuration.

    Returns:
        A dictionary with keys: content, tables, images, metadata, raw, doctags.
    """
    if options is None:
        options = {}

    model_config = options.get("model_config", {})

    # Merge use_vlm from top-level options into model_config
    if "use_vlm" in options and "use_vlm" not in model_config:
        model_config["use_vlm"] = options["use_vlm"]

    # Apply defaults if model_config is empty (backward compat)
    if not model_config:
        model_config = {
            "layout_model": "docling-project/docling-layout-egret-xlarge",
            "ocr_engine": "rapidocr",
            "ocr_backend": "torch",
            "ocr_lang": ["chinese", "english"],
            "table_mode": "accurate",
            "use_vlm": False,
        }

    use_vlm = model_config.get("use_vlm", False)
    if use_vlm:
        _log.info("Using VLM pipeline (%s) for %s",
                  model_config.get("vlm_model", "default"), file_path)
    else:
        _log.info("Using standard pipeline (layout=%s, ocr=%s) for %s",
                  model_config.get("layout_model", "default"),
                  model_config.get("ocr_engine", "rapidocr"),
                  file_path)

    converter = _get_converter(model_config)
    result = converter.convert(file_path)

    # Export to markdown
    markdown_content = result.document.export_to_markdown()

    # Extract tables
    tables: list[dict[str, Any]] = []
    try:
        for table in result.document.tables:
            tables.append(
                {
                    "data": table.export_to_dataframe(doc=result.document).to_csv(),
                    "page": (
                        getattr(table.prov, "page_no", None)
                        if table.prov
                        else None
                    ),
                }
            )
    except Exception as exc:
        _log.warning("Failed to extract some tables: %s", exc)

    # Extract image references
    images: list[dict[str, Any]] = []
    try:
        for pic in result.document.pictures:
            caption: str | None = None
            if pic.captions:
                try:
                    caption = pic.caption_text(result.document)
                except Exception:
                    caption = None
            images.append(
                {
                    "caption": caption,
                    "page": (
                        getattr(pic.prov, "page_no", None)
                        if pic.prov
                        else None
                    ),
                }
            )
    except Exception as exc:
        _log.warning("Failed to extract some images: %s", exc)

    # Metadata
    metadata: dict[str, Any] = {
        "page_count": len(result.pages) if hasattr(result, "pages") else None,
        "format": str(result.input.format) if hasattr(result, "input") else None,
    }

    return {
        "content": markdown_content,
        "tables": tables,
        "images": images,
        "metadata": metadata,
        "raw": result.document.export_to_dict(),
        "doctags": result.document.export_to_doctags(),
        "doctagsAvailable": True,
    }
