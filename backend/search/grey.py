"""Grey literature search: Google CSE, Bing, DuckDuckGo."""
from __future__ import annotations

import asyncio
import logging
import re
import time

import httpx
from bs4 import BeautifulSoup

from backend.api.models import SourceIn, StructuredBrief
from backend.config import settings
from backend.search.classifier import classify_url

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(20.0)
_UA = "Mozilla/5.0 (compatible; ALDA/0.1; +https://github.com/lipanook123/alda)"


def _build_query(brief: StructuredBrief, extra_terms: list[str] | None = None) -> str:
    terms = list(brief.keywords[:6])
    if extra_terms:
        terms.extend(extra_terms[:2])
    return " ".join(terms)


async def search(
    brief: StructuredBrief,
    enabled_sources: list[str],
    extra_terms: list[str] | None = None,
) -> list[SourceIn]:
    query = _build_query(brief, extra_terms)
    tasks: dict[str, asyncio.Task] = {}

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        if "google_cse" in enabled_sources and settings.google_cse_id and settings.google_api_key:
            tasks["google_cse"] = asyncio.create_task(_search_google_cse(client, query))
        if "bing" in enabled_sources and settings.bing_api_key:
            tasks["bing"] = asyncio.create_task(_search_bing(client, query))
        if "duckduckgo" in enabled_sources:
            tasks["duckduckgo"] = asyncio.create_task(
                asyncio.to_thread(_search_duckduckgo_sync, query)
            )

        results = await asyncio.gather(*tasks.values(), return_exceptions=True)

    sources: list[SourceIn] = []
    for name, result in zip(tasks.keys(), results):
        if isinstance(result, Exception):
            log.warning("Grey search error (%s): %s", name, result)
        elif isinstance(result, list):
            sources.extend(result)

    return sources


# ---------------------------------------------------------------------------
# Google Custom Search Engine
# ---------------------------------------------------------------------------

async def _search_google_cse(client: httpx.AsyncClient, query: str) -> list[SourceIn]:
    sources: list[SourceIn] = []
    for start in range(1, 91, 10):  # pages 1-10, 10 results each
        params = {
            "q": query,
            "cx": settings.google_cse_id,
            "key": settings.google_api_key,
            "num": 10,
            "start": start,
        }
        try:
            resp = await client.get("https://www.googleapis.com/customsearch/v1", params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            log.warning("Google CSE error: %s", e)
            break

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            url = item.get("link", "")
            sources.append(SourceIn(
                title=item.get("title", "Untitled"),
                url=url,
                abstract=item.get("snippet"),
                source_type=classify_url(url),
                metadata={"api": "google_cse"},
            ))

        if len(items) < 10:
            break

    return sources


# ---------------------------------------------------------------------------
# Bing Web Search
# ---------------------------------------------------------------------------

async def _search_bing(client: httpx.AsyncClient, query: str) -> list[SourceIn]:
    sources: list[SourceIn] = []
    for offset in range(0, 100, 50):
        try:
            resp = await client.get(
                "https://api.bing.microsoft.com/v7.0/search",
                params={"q": query, "count": 50, "offset": offset},
                headers={"Ocp-Apim-Subscription-Key": settings.bing_api_key},
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            log.warning("Bing error: %s", e)
            break

        items = data.get("webPages", {}).get("value", [])
        if not items:
            break

        for item in items:
            url = item.get("url", "")
            sources.append(SourceIn(
                title=item.get("name", "Untitled"),
                url=url,
                abstract=item.get("snippet"),
                source_type=classify_url(url),
                metadata={"api": "bing"},
            ))

        if len(items) < 50:
            break

    return sources


# ---------------------------------------------------------------------------
# DuckDuckGo (HTML scraping — fragile by nature, returns empty on block)
# ---------------------------------------------------------------------------

_DDG_RESULT_SEL = "div.result"
_DDG_TITLE_SEL = "a.result__a"
_DDG_URL_SEL = "a.result__url"
_DDG_SNIPPET_SEL = "a.result__snippet"

_last_ddg_request: float = 0.0


def _search_duckduckgo_sync(query: str) -> list[SourceIn]:
    global _last_ddg_request
    sources: list[SourceIn] = []

    for page in range(1, 4):  # up to 3 pages
        elapsed = time.time() - _last_ddg_request
        if elapsed < 2.0:
            time.sleep(2.0 - elapsed)

        try:
            resp = httpx.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query, "s": (page - 1) * 30},
                headers={
                    "User-Agent": _UA,
                    "Accept": "text/html",
                },
                timeout=15.0,
                follow_redirects=True,
            )
            _last_ddg_request = time.time()

            if resp.status_code != 200:
                log.warning("DuckDuckGo returned %s", resp.status_code)
                break

            soup = BeautifulSoup(resp.text, "lxml")
            results = soup.select(_DDG_RESULT_SEL)
            if not results:
                break

            for r in results:
                title_el = r.select_one(_DDG_TITLE_SEL)
                url_el = r.select_one(_DDG_URL_SEL)
                snippet_el = r.select_one(_DDG_SNIPPET_SEL)
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                url = url_el.get_text(strip=True) if url_el else ""
                if url and not url.startswith("http"):
                    url = "https://" + url
                snippet = snippet_el.get_text(strip=True) if snippet_el else None
                sources.append(SourceIn(
                    title=title,
                    url=url,
                    abstract=snippet,
                    source_type=classify_url(url),
                    metadata={"api": "duckduckgo"},
                ))

            if len(results) < 10:
                break

        except Exception as e:
            log.warning("DuckDuckGo error on page %d: %s", page, e)
            break

    return sources[:50]
