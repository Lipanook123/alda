"""Academic literature search across free APIs."""
from __future__ import annotations

import asyncio
import logging
import re
import urllib.parse
from typing import Any

import httpx

from backend.api.models import SourceIn, StructuredBrief
from backend.config import settings

log = logging.getLogger(__name__)

_UA = "ALDA/0.1 (https://github.com/lipanook123/alda; mailto:lipanook@gmail.com)"
_TIMEOUT = httpx.Timeout(30.0)


def _build_query(brief: StructuredBrief, extra_terms: list[str] | None = None) -> str:
    terms = list(brief.keywords)
    if extra_terms:
        terms.extend(extra_terms)
    return " ".join(terms[:8])


async def search(
    brief: StructuredBrief,
    enabled_sources: list[str],
    extra_terms: list[str] | None = None,
) -> list[SourceIn]:
    query = _build_query(brief, extra_terms)
    tasks: dict[str, asyncio.Task] = {}

    async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _UA}) as client:
        if "semantic_scholar" in enabled_sources:
            tasks["semantic_scholar"] = asyncio.create_task(
                _search_semantic_scholar(client, query, brief)
            )
        if "crossref" in enabled_sources:
            tasks["crossref"] = asyncio.create_task(
                _search_crossref(client, query, brief)
            )
        if "openalex" in enabled_sources:
            tasks["openalex"] = asyncio.create_task(
                _search_openalex(client, query, brief)
            )
        if "arxiv" in enabled_sources:
            tasks["arxiv"] = asyncio.create_task(
                asyncio.to_thread(_search_arxiv_sync, query, brief)
            )
        if "pubmed" in enabled_sources:
            tasks["pubmed"] = asyncio.create_task(
                asyncio.to_thread(_search_pubmed_sync, query, brief)
            )

        results = await asyncio.gather(*tasks.values(), return_exceptions=True)

    sources: list[SourceIn] = []
    for source_name, result in zip(tasks.keys(), results):
        if isinstance(result, Exception):
            log.warning("Error searching %s: %s", source_name, result)
        elif isinstance(result, list):
            sources.extend(result)

    return sources


# ---------------------------------------------------------------------------
# Semantic Scholar
# ---------------------------------------------------------------------------

async def _search_semantic_scholar(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    headers = {}
    if settings.semantic_scholar_api_key:
        headers["x-api-key"] = settings.semantic_scholar_api_key

    fields = "title,authors,year,externalIds,abstract,venue,citationCount"
    params = {
        "query": query,
        "fields": fields,
        "limit": min(settings.max_results_per_source, 100),
    }
    if brief.date_range:
        params["year"] = f"{brief.date_range[0]}-{brief.date_range[1]}"

    resp = await client.get(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params=params,
        headers=headers,
    )
    resp.raise_for_status()
    data = resp.json()

    sources: list[SourceIn] = []
    for paper in data.get("data", []):
        doi = (paper.get("externalIds") or {}).get("DOI")
        authors = [a.get("name", "") for a in (paper.get("authors") or [])]
        sources.append(SourceIn(
            title=paper.get("title") or "Untitled",
            authors=authors,
            year=paper.get("year"),
            doi=doi,
            url=f"https://www.semanticscholar.org/paper/{paper.get('paperId', '')}",
            abstract=paper.get("abstract"),
            venue=paper.get("venue"),
            citation_count=paper.get("citationCount"),
            source_type="academic",
            metadata={"api": "semantic_scholar", "paperId": paper.get("paperId")},
        ))
    return sources


# ---------------------------------------------------------------------------
# CrossRef
# ---------------------------------------------------------------------------

async def _search_crossref(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    params: dict[str, Any] = {
        "query": query,
        "rows": min(settings.max_results_per_source, 100),
        "select": "DOI,title,author,published,abstract,container-title,is-referenced-by-count",
    }
    if brief.date_range:
        params["filter"] = f"from-pub-date:{brief.date_range[0]},until-pub-date:{brief.date_range[1]}"

    resp = await client.get(
        "https://api.crossref.org/works",
        params=params,
        headers={"User-Agent": _UA},
    )
    resp.raise_for_status()
    data = resp.json()

    sources: list[SourceIn] = []
    for item in data.get("message", {}).get("items", []):
        doi = item.get("DOI")
        title_list = item.get("title") or []
        title = title_list[0] if title_list else "Untitled"
        authors = [
            f"{a.get('given', '')} {a.get('family', '')}".strip()
            for a in (item.get("author") or [])
        ]
        pub = item.get("published", {})
        parts = (pub.get("date-parts") or [[]])[0]
        year = parts[0] if parts else None
        container = (item.get("container-title") or [None])[0]
        doi_url = f"https://doi.org/{doi}" if doi else ""
        sources.append(SourceIn(
            title=title,
            authors=authors,
            year=year,
            doi=doi,
            url=doi_url,
            abstract=item.get("abstract"),
            venue=container,
            citation_count=item.get("is-referenced-by-count"),
            source_type="academic",
            metadata={"api": "crossref"},
        ))
    return sources


# ---------------------------------------------------------------------------
# OpenAlex
# ---------------------------------------------------------------------------

async def _search_openalex(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    params: dict[str, Any] = {
        "search": query,
        "per-page": min(settings.max_results_per_source, 100),
        "select": "id,title,authorships,publication_year,doi,abstract_inverted_index,primary_location,cited_by_count",
    }
    if brief.date_range:
        params["filter"] = f"publication_year:{brief.date_range[0]}-{brief.date_range[1]}"

    resp = await client.get("https://api.openalex.org/works", params=params)
    resp.raise_for_status()
    data = resp.json()

    sources: list[SourceIn] = []
    for work in data.get("results", []):
        doi = work.get("doi")
        if doi:
            doi = doi.replace("https://doi.org/", "")
        title = work.get("title") or "Untitled"
        authors = [
            a.get("author", {}).get("display_name", "")
            for a in (work.get("authorships") or [])
        ]
        year = work.get("publication_year")

        # Reconstruct abstract from inverted index
        abstract = _reconstruct_abstract(work.get("abstract_inverted_index"))

        loc = work.get("primary_location") or {}
        venue = (loc.get("source") or {}).get("display_name")
        url = work.get("id") or ""

        sources.append(SourceIn(
            title=title,
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=abstract,
            venue=venue,
            citation_count=work.get("cited_by_count"),
            source_type="academic",
            metadata={"api": "openalex"},
        ))
    return sources


def _reconstruct_abstract(inverted: dict | None) -> str | None:
    if not inverted:
        return None
    try:
        positions: list[tuple[int, str]] = []
        for word, pos_list in inverted.items():
            for pos in pos_list:
                positions.append((pos, word))
        positions.sort()
        return " ".join(w for _, w in positions)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# arXiv (synchronous SDK, called via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _search_arxiv_sync(query: str, brief: StructuredBrief) -> list[SourceIn]:
    try:
        import arxiv  # noqa: PLC0415
    except ImportError:
        return []

    client = arxiv.Client()
    search = arxiv.Search(
        query=query,
        max_results=min(settings.max_results_per_source, 100),
        sort_by=arxiv.SortCriterion.Relevance,
    )

    sources: list[SourceIn] = []
    for result in client.results(search):
        year = result.published.year if result.published else None
        if brief.date_range:
            lo, hi = brief.date_range
            if year and not (lo <= year <= hi):
                continue
        doi = result.doi
        sources.append(SourceIn(
            title=result.title,
            authors=[str(a) for a in result.authors],
            year=year,
            doi=doi,
            url=result.entry_id,
            abstract=result.summary,
            venue="arXiv",
            source_type="academic",
            metadata={"api": "arxiv", "pdf_url": result.pdf_url},
        ))
    return sources


# ---------------------------------------------------------------------------
# PubMed (Biopython Entrez, synchronous)
# ---------------------------------------------------------------------------

def _search_pubmed_sync(query: str, brief: StructuredBrief) -> list[SourceIn]:
    try:
        from Bio import Entrez  # noqa: PLC0415
    except ImportError:
        return []

    Entrez.email = "lipanook@gmail.com"
    limit = min(settings.max_results_per_source, 100)

    try:
        # Search
        handle = Entrez.esearch(db="pubmed", term=query, retmax=limit)
        record = Entrez.read(handle)
        handle.close()
        pmids = record.get("IdList", [])
        if not pmids:
            return []

        # Fetch
        handle = Entrez.efetch(db="pubmed", id=",".join(pmids), rettype="medline", retmode="text")
        raw = handle.read()
        handle.close()
    except Exception as e:
        log.warning("PubMed error: %s", e)
        return []

    return _parse_medline(raw, brief)


_MEDLINE_FIELD_RE = re.compile(r"^([A-Z]{2,4})\s+-\s+(.+)$")


def _parse_medline(raw: str, brief: StructuredBrief) -> list[SourceIn]:
    sources: list[SourceIn] = []
    records: list[dict[str, list[str]]] = []
    current: dict[str, list[str]] = {}

    for line in raw.splitlines():
        if line.strip() == "":
            if current:
                records.append(current)
                current = {}
            continue
        match = _MEDLINE_FIELD_RE.match(line)
        if match:
            field, value = match.group(1), match.group(2)
            current.setdefault(field, []).append(value)
        elif current:
            # continuation line
            last_key = list(current.keys())[-1]
            current[last_key][-1] += " " + line.strip()

    if current:
        records.append(current)

    for rec in records:
        pmid = rec.get("PMID", [""])[0]
        title = " ".join(rec.get("TI", ["Untitled"]))
        authors = [a.split(",")[0] for a in rec.get("AU", [])]
        date_str = rec.get("DP", [""])[0]
        year = None
        year_match = re.search(r"\b(19|20)\d{2}\b", date_str)
        if year_match:
            year = int(year_match.group())
        if brief.date_range and year:
            lo, hi = brief.date_range
            if not (lo <= year <= hi):
                continue
        abstract = " ".join(rec.get("AB", []))
        journal = " ".join(rec.get("JT", []))
        doi = next((v.split(" ")[0] for v in rec.get("LID", []) if "doi" in v.lower()), None)
        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else ""
        sources.append(SourceIn(
            title=title,
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=abstract or None,
            venue=journal or None,
            source_type="academic",
            metadata={"api": "pubmed", "pmid": pmid},
        ))
    return sources
