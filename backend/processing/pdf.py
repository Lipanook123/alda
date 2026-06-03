"""Open-access PDF fetching and text extraction (only when scraping is enabled)."""
from __future__ import annotations

import logging

import httpx

from backend import config as _config

log = logging.getLogger(__name__)


async def extract_text_from_pdf_url(url: str) -> str | None:
    """Download a PDF from `url` and return extracted text (first 5000 chars)."""
    if not _config.get_scraping_enabled():
        return None

    try:
        import pypdf  # noqa: PLC0415
        import io

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "ALDA/0.1"})
            resp.raise_for_status()
            if "pdf" not in resp.headers.get("content-type", "").lower():
                return None
            reader = pypdf.PdfReader(io.BytesIO(resp.content))
            text_parts: list[str] = []
            for page in reader.pages[:10]:
                text_parts.append(page.extract_text() or "")
            return " ".join(text_parts)[:5000] or None
    except Exception as e:
        log.warning("PDF extraction failed for %s: %s", url, e)
        return None
