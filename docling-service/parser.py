"""
Document parser module using Docling.

Provides the parse_document function which converts a document file into
structured data (markdown content, tables, images, metadata).
"""

from __future__ import annotations

import logging
from typing import Any

logging.basicConfig(level=logging.INFO)
_log = logging.getLogger(__name__)


async def parse_document(file_path: str, options: dict | None = None) -> dict[str, Any]:
    """Parse a document using Docling and return a structured result.

    Args:
        file_path: Absolute or relative path to the document file.
        options: Optional dictionary with parsing hints.
            - ocr (bool): Whether to enable OCR. Defaults to False.
            - extract_tables (bool): Whether to extract table data. Defaults to True.

    Returns:
        A dictionary with keys: content, tables, images, metadata.
    """
    if options is None:
        options = {}

    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(file_path)

    # Export to markdown
    markdown_content = result.document.export_to_markdown()

    # Extract tables
    tables: list[dict[str, Any]] = []
    try:
        for table in result.document.tables:
            tables.append(
                {
                    "data": table.export_to_dataframe().to_csv(),
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
