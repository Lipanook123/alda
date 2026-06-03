"""Academic literature search across free APIs."""
from __future__ import annotations

import asyncio
import logging
import re
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from backend.api.models import SourceIn, StructuredBrief
from backend import config as _config
from backend.config import settings
from backend.search.translator import TARGET_LANGUAGES, build_translated_query

log = logging.getLogger(__name__)

_UA = "ALDA/0.1 (https://github.com/lipanook123/alda; mailto:lipanook@gmail.com)"


async def _http_get(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_retries: int = 3,
    **kwargs: Any,
) -> httpx.Response:
    """GET with automatic retry on 429/503 using Retry-After or exponential backoff."""
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            resp = await client.get(url, **kwargs)
        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            last_exc = exc
            wait = 2 ** attempt
            log.debug("Connection error for %s (attempt %d): %s — retrying in %ds", url, attempt + 1, exc, wait)
            await asyncio.sleep(wait)
            continue
        if resp.status_code in (429, 503):
            try:
                wait = int(resp.headers.get("Retry-After", 2 ** attempt))
            except (ValueError, TypeError):
                wait = 2 ** attempt
            wait = min(wait, 60)
            log.debug("Rate limited by %s (attempt %d) — retrying in %ds", url, attempt + 1, wait)
            await asyncio.sleep(wait)
            last_exc = None
            continue
        resp.raise_for_status()
        return resp
    if last_exc:
        raise last_exc
    raise httpx.HTTPStatusError(
        f"Still rate-limited after {max_retries} retries",
        request=httpx.Request("GET", url),
        response=resp,  # type: ignore[reportPossiblyUnbound]
    )
_TIMEOUT = httpx.Timeout(30.0)


_QUERY_META_WORDS = frozenset({
    "systematic", "comprehensive", "thorough", "complete",
    "search", "review", "analysis", "survey", "overview",
    "perform", "conduct", "execute", "find", "identify",
    "investigate", "examine", "assess", "evaluate", "determine",
    "literature", "study", "studies", "paper", "papers",
    "article", "articles", "source", "sources",
})


def _build_query(brief: StructuredBrief, extra_terms: list[str] | None = None) -> str:
    """Return the primary search query string for this brief."""
    # Use LLM-generated Boolean query if available
    if brief.search_queries:
        base = brief.search_queries[0]
        if extra_terms:
            ext = " OR ".join(extra_terms[:4])
            return f"({base}) AND ({ext})"
        return base
    # Heuristic fallback: filter meta-words, AND-join remaining terms for precision
    filtered = [t for t in brief.keywords if t.lower() not in _QUERY_META_WORDS]
    if extra_terms:
        filtered.extend(extra_terms[:3])
    core = filtered[:5]
    if not core:
        return " ".join(brief.keywords[:6])
    return " AND ".join(core) if len(core) > 1 else core[0]


async def search(
    brief: StructuredBrief,
    enabled_sources: list[str],
    extra_terms: list[str] | None = None,
) -> tuple[list[SourceIn], dict[str, int], list[str]]:
    query = _build_query(brief, extra_terms)
    tasks: dict[str, asyncio.Task] = {}

    # Alternative queries (search_queries[1:]) run against the highest-quality
    # sources only — avoids rate-limit storms while improving coverage.
    # Only used on iteration 1 (no extra_terms) to avoid query explosion.
    alt_queries = brief.search_queries[1:3] if (brief.search_queries and not extra_terms) else []

    async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _UA}) as client:
        # ── Original five academic sources ──────────────────────────────────
        if "semantic_scholar" in enabled_sources:
            tasks["semantic_scholar"] = asyncio.create_task(
                _search_semantic_scholar(client, query, brief)
            )
            for i, aq in enumerate(alt_queries, 1):
                tasks[f"semantic_scholar_q{i+1}"] = asyncio.create_task(
                    _search_semantic_scholar(client, aq, brief)
                )
        if "crossref" in enabled_sources:
            tasks["crossref"] = asyncio.create_task(
                _search_crossref(client, query, brief)
            )
        if "openalex" in enabled_sources:
            tasks["openalex"] = asyncio.create_task(
                _search_openalex(client, query, brief)
            )
            for i, aq in enumerate(alt_queries, 1):
                tasks[f"openalex_q{i+1}"] = asyncio.create_task(
                    _search_openalex(client, aq, brief)
                )
        if "arxiv" in enabled_sources:
            tasks["arxiv"] = asyncio.create_task(
                asyncio.to_thread(_search_arxiv_sync, query, brief)
            )
        if "pubmed" in enabled_sources:
            tasks["pubmed"] = asyncio.create_task(
                asyncio.to_thread(_search_pubmed_sync, query, brief)
            )
            for i, aq in enumerate(alt_queries, 1):
                tasks[f"pubmed_q{i+1}"] = asyncio.create_task(
                    asyncio.to_thread(_search_pubmed_sync, aq, brief)
                )

        # ── New global open-access sources ──────────────────────────────────
        if "core" in enabled_sources:
            tasks["core"] = asyncio.create_task(_search_core(client, query, brief))
            for lang in TARGET_LANGUAGES.get("core", []):
                tq = build_translated_query(brief.keywords, lang)
                if tq:
                    tasks[f"core_{lang}"] = asyncio.create_task(_search_core(client, tq, brief))

        if "europe_pmc" in enabled_sources:
            tasks["europe_pmc"] = asyncio.create_task(_search_europe_pmc(client, query, brief))

        if "doaj" in enabled_sources:
            tasks["doaj"] = asyncio.create_task(_search_doaj(client, query, brief))
            for lang in TARGET_LANGUAGES.get("doaj", []):
                tq = build_translated_query(brief.keywords, lang)
                if tq:
                    tasks[f"doaj_{lang}"] = asyncio.create_task(_search_doaj(client, tq, brief))

        if "base" in enabled_sources:
            tasks["base"] = asyncio.create_task(_search_base(client, query, brief))
            for lang in TARGET_LANGUAGES.get("base", []):
                tq = build_translated_query(brief.keywords, lang)
                if tq:
                    tasks[f"base_{lang}"] = asyncio.create_task(_search_base(client, tq, brief))

        if "openaire" in enabled_sources:
            tasks["openaire"] = asyncio.create_task(_search_openaire(client, query, brief))

        # ── Regional / language-specific sources ───────────────────────────
        if "scielo" in enabled_sources:
            tasks["scielo"] = asyncio.create_task(_search_scielo(client, query, brief))
            for lang in TARGET_LANGUAGES.get("scielo", []):
                tq = build_translated_query(brief.keywords, lang)
                if tq:
                    tasks[f"scielo_{lang}"] = asyncio.create_task(
                        _search_scielo(client, tq, brief)
                    )

        if "jstage" in enabled_sources:
            tasks["jstage"] = asyncio.create_task(
                asyncio.to_thread(_search_jstage_sync, query, brief)
            )
            for lang in TARGET_LANGUAGES.get("jstage", []):
                tq = build_translated_query(brief.keywords, lang)
                if tq:
                    tasks[f"jstage_{lang}"] = asyncio.create_task(
                        asyncio.to_thread(_search_jstage_sync, tq, brief)
                    )

        if "cyberleninka" in enabled_sources:
            tq = build_translated_query(brief.keywords, "Russian") or query
            tasks["cyberleninka"] = asyncio.create_task(
                _search_cyberleninka(client, tq, brief)
            )

        if "who_iris" in enabled_sources:
            tasks["who_iris"] = asyncio.create_task(_search_who_iris(client, query, brief))
            for lang in TARGET_LANGUAGES.get("who_iris", []):
                tq = build_translated_query(brief.keywords, lang)
                if tq:
                    tasks[f"who_iris_{lang}"] = asyncio.create_task(
                        _search_who_iris(client, tq, brief)
                    )

        # ── Specialist sources ──────────────────────────────────────────────
        if "eric" in enabled_sources:
            tasks["eric"] = asyncio.create_task(_search_eric(client, query, brief))

        if "clinicaltrials" in enabled_sources:
            tasks["clinicaltrials"] = asyncio.create_task(
                _search_clinicaltrials(client, query, brief)
            )

        results = await asyncio.gather(*tasks.values(), return_exceptions=True)

    # Known multi-word source keys that should not be split on first underscore
    _MULTIWORD_KEYS = {"semantic_scholar", "europe_pmc", "who_iris"}

    sources: list[SourceIn] = []
    raw_counts: dict[str, int] = {}
    errors: list[str] = []

    for source_name, result in zip(tasks.keys(), results):
        # Normalise task names: strip language/query suffixes to get canonical API key
        # e.g. "semantic_scholar_q2" → "semantic_scholar",  "core_Chinese..." → "core"
        api_key = source_name
        for known in _MULTIWORD_KEYS:
            if source_name.startswith(known):
                api_key = known
                break
        else:
            api_key = source_name.split("_")[0] if "_" in source_name else source_name
        if isinstance(result, Exception):
            log.warning("Error searching %s: %s", source_name, result)
            if api_key not in errors:
                errors.append(api_key)
        elif isinstance(result, list):
            # Tag with canonical api name so source breakdown is clean
            for src in result:
                src.metadata.setdefault("api", api_key)
            sources.extend(result)
            raw_counts[api_key] = raw_counts.get(api_key, 0) + len(result)

    return sources, raw_counts, errors


# ---------------------------------------------------------------------------
# Semantic Scholar
# ---------------------------------------------------------------------------

async def _search_semantic_scholar(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    headers = {}
    key = _config.get_semantic_scholar_key()
    if key:
        headers["x-api-key"] = key

    fields = "title,authors,year,externalIds,abstract,venue,citationCount"
    params = {
        "query": query,
        "fields": fields,
        "limit": min(settings.max_results_per_source, 100),
    }
    if brief.date_range:
        params["year"] = f"{brief.date_range[0]}-{brief.date_range[1]}"

    resp = await _http_get(
        client,
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params=params,
        headers=headers,
    )
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

    client = arxiv.Client(delay_seconds=3.0, num_retries=2)
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


# ---------------------------------------------------------------------------
# CORE (core.ac.uk) — 300M+ open-access papers globally
# ---------------------------------------------------------------------------

async def _search_core(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    headers: dict[str, str] = {}
    core_key = _config.get_core_key()
    if core_key:
        headers["Authorization"] = f"Bearer {core_key}"

    resp = await _http_get(
        client,
        "https://api.core.ac.uk/v3/search/works",
        params={"q": query, "limit": min(settings.max_results_per_source, 100), "offset": 0},
        headers=headers,
    )
    data = resp.json()

    sources: list[SourceIn] = []
    for item in data.get("results", []):
        authors = [a.get("name", "") for a in (item.get("authors") or [])]
        doi = item.get("doi")
        urls = item.get("sourceFulltextUrls") or []
        url = item.get("downloadUrl") or (urls[0] if urls else None) or (
            f"https://doi.org/{doi}" if doi else ""
        )
        sources.append(SourceIn(
            title=item.get("title") or "Untitled",
            authors=authors,
            year=item.get("yearPublished"),
            doi=doi,
            url=url,
            abstract=item.get("abstract"),
            citation_count=item.get("citationCount"),
            source_type="academic",
            metadata={"api": "core", "core_id": item.get("id")},
        ))
    return sources


# ---------------------------------------------------------------------------
# Europe PMC — 40M biomedical / life-science papers
# ---------------------------------------------------------------------------

async def _search_europe_pmc(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    q = query
    if brief.date_range:
        lo, hi = brief.date_range
        q += f" (FIRST_PDATE:[{lo}-01-01 TO {hi}-12-31])"

    resp = await client.get(
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
        params={
            "query": q,
            "resultType": "core",
            "format": "json",
            "pageSize": min(settings.max_results_per_source, 100),
            "cursorMark": "*",
        },
    )
    resp.raise_for_status()
    data = resp.json()

    sources: list[SourceIn] = []
    for item in data.get("resultList", {}).get("result", []):
        author_str = item.get("authorString") or ""
        authors = [a.strip().rstrip(".") for a in author_str.split(",") if a.strip()]
        doi = item.get("doi")
        pmid = item.get("pmid") or item.get("id")
        src = item.get("source", "MED")
        url = (
            f"https://europepmc.org/article/{src}/{pmid}" if pmid
            else f"https://doi.org/{doi}" if doi else ""
        )
        try:
            year = int(item.get("pubYear") or 0) or None
        except (ValueError, TypeError):
            year = None
        sources.append(SourceIn(
            title=item.get("title") or "Untitled",
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=item.get("abstractText"),
            venue=item.get("journalTitle"),
            citation_count=item.get("citedByCount"),
            source_type="academic",
            metadata={"api": "europe_pmc", "pmid": pmid},
        ))
    return sources


# ---------------------------------------------------------------------------
# DOAJ — Directory of Open Access Journals (all languages)
# ---------------------------------------------------------------------------

async def _search_doaj(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    encoded = urllib.parse.quote(query)
    resp = await client.get(
        f"https://doaj.org/api/v4/search/articles/{encoded}",
        params={"page": 1, "pageSize": min(settings.max_results_per_source, 100)},
    )
    resp.raise_for_status()
    data = resp.json()

    sources: list[SourceIn] = []
    for item in data.get("results", []):
        bib = item.get("bibjson") or {}
        title = bib.get("title") or "Untitled"
        authors = [a.get("name", "") for a in (bib.get("author") or [])]
        year_str = bib.get("year") or ""
        try:
            year = int(year_str) if year_str else None
        except (ValueError, TypeError):
            year = None
        doi = next(
            (i.get("id") for i in (bib.get("identifier") or []) if i.get("type") == "doi"),
            None,
        )
        url = next(
            (ln.get("url") for ln in (bib.get("link") or []) if ln.get("type") in ("fulltext", "doi")),
            None,
        ) or (f"https://doi.org/{doi}" if doi else "")
        sources.append(SourceIn(
            title=title,
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=bib.get("abstract"),
            venue=(bib.get("journal") or {}).get("title"),
            source_type="academic",
            metadata={"api": "doaj"},
        ))
    return sources


# ---------------------------------------------------------------------------
# BASE (Bielefeld Academic Search Engine) — 400M+ multilingual documents
# ---------------------------------------------------------------------------

async def _search_base(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    params: dict[str, Any] = {
        "func": "PerformSearch",
        "query": query,
        "format": "json",
        "hits": min(settings.max_results_per_source, 100),
        "offset": 0,
    }
    if brief.date_range:
        lo, hi = brief.date_range
        params["filter[dcdate]"] = f"[{lo} TO {hi}]"

    resp = await _http_get(
        client,
        "https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi",
        params=params,
        headers={"User-Agent": _UA},
    )
    data = resp.json()

    def _listify(val: Any) -> list:
        if val is None:
            return []
        return val if isinstance(val, list) else [val]

    sources: list[SourceIn] = []
    for doc in data.get("response", {}).get("docs", []):
        title_raw = doc.get("dctitle")
        titles = _listify(title_raw)
        title = titles[0] if titles else "Untitled"

        creators = _listify(doc.get("dccreator"))

        identifiers = _listify(doc.get("dcidentifier"))
        doi = next(
            (i.replace("doi:", "").strip() for i in identifiers if str(i).startswith("doi:")),
            None,
        )
        if not doi:
            doi = next((i for i in identifiers if re.match(r"10\.\d{4,}/", str(i))), None)

        url = doc.get("dclink") or (f"https://doi.org/{doi}" if doi else "")

        desc_raw = doc.get("dcdescription") or ""
        abstract = " ".join(_listify(desc_raw)) if isinstance(desc_raw, list) else desc_raw or None

        date_vals = _listify(doc.get("dcdate") or doc.get("dcyear"))
        year_str = date_vals[0] if date_vals else ""
        year_match = re.search(r"\b(19|20)\d{2}\b", str(year_str))
        year = int(year_match.group()) if year_match else None

        sources.append(SourceIn(
            title=title,
            authors=creators,
            year=year,
            doi=doi,
            url=url,
            abstract=abstract or None,
            source_type="academic",
            metadata={"api": "base"},
        ))
    return sources


# ---------------------------------------------------------------------------
# OpenAIRE — European multilingual open science
# ---------------------------------------------------------------------------

async def _search_openaire(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    params: dict[str, Any] = {
        "keywords": query,
        "size": min(settings.max_results_per_source, 100),
        "page": 1,
    }
    if brief.date_range:
        lo, hi = brief.date_range
        params["fromDateAccepted"] = f"{lo}-01-01"
        params["toDateAccepted"] = f"{hi}-12-31"

    resp = await _http_get(
        client,
        "https://api.openaire.eu/graph/research-products",
        params={**params, "type": "publication"},
    )
    data = resp.json()

    sources: list[SourceIn] = []
    for item in data.get("results", []):
        titles = item.get("titles") or []
        title = (titles[0].get("value") if isinstance(titles[0], dict) else titles[0]) if titles else "Untitled"

        authors = [a.get("fullName", "") for a in (item.get("authors") or [])]

        pub_date = item.get("publicationDate") or ""
        year_match = re.search(r"\b(19|20)\d{2}\b", pub_date)
        year = int(year_match.group()) if year_match else None

        identifiers = item.get("identifiers") or []
        doi = next((i.get("value") for i in identifiers if i.get("scheme") == "doi"), None)

        best_url = None
        for inst in (item.get("instances") or []):
            u = inst.get("url")
            if u:
                best_url = u
                if inst.get("accessRightCode") in ("OPEN", "OPEN SOURCE"):
                    break
        url = best_url or (f"https://doi.org/{doi}" if doi else "")

        descriptions = item.get("descriptions") or []
        abstract = descriptions[0].get("value") if descriptions and isinstance(descriptions[0], dict) else (descriptions[0] if descriptions else None)

        journals = item.get("journals") or []
        venue = journals[0].get("name") if journals else None

        sources.append(SourceIn(
            title=title,
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=abstract,
            venue=venue,
            source_type="academic",
            metadata={"api": "openaire"},
        ))
    return sources


# ---------------------------------------------------------------------------
# SciELO — Latin American / Spanish / Portuguese research
# ---------------------------------------------------------------------------

async def _search_scielo(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    resp = await client.get(
        "https://search.scielo.org/api/v1/article/",
        params={
            "q": query,
            "count": min(settings.max_results_per_source, 100),
            "from": 1,
            "output": "json",
            "lang": "en",
        },
    )
    resp.raise_for_status()
    data = resp.json()

    def _first_dict_val(d: Any) -> str | None:
        if not d:
            return None
        if isinstance(d, dict):
            return next(iter(d.values()), None)
        if isinstance(d, list):
            v = d[0] if d else None
            return _first_dict_val(v) if isinstance(v, dict) else v
        return str(d)

    sources: list[SourceIn] = []
    for item in (data.get("hits") or {}).get("hits", []):
        src = item.get("_source") or {}

        title = _first_dict_val(src.get("ti") or src.get("title")) or "Untitled"

        authors_raw = src.get("au") or []
        authors = authors_raw if isinstance(authors_raw, list) else [authors_raw]

        doi = src.get("doi")
        url_raw = src.get("ur") or (f"https://doi.org/{doi}" if doi else "")
        url = url_raw[0] if isinstance(url_raw, list) else url_raw

        abstract = _first_dict_val(src.get("ab"))

        year_str = str(src.get("da") or src.get("year") or "")
        year_match = re.search(r"\b(19|20)\d{2}\b", year_str)
        year = int(year_match.group()) if year_match else None

        venue = src.get("ta") or None

        sources.append(SourceIn(
            title=title,
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=abstract,
            venue=venue,
            source_type="academic",
            metadata={"api": "scielo"},
        ))
    return sources


# ---------------------------------------------------------------------------
# J-STAGE — Japanese science journals (Atom XML)
# ---------------------------------------------------------------------------

def _search_jstage_sync(query: str, brief: StructuredBrief) -> list[SourceIn]:
    resp = httpx.get(
        "https://api.jstage.jst.go.jp/searchapi/do",
        params={
            "service": 3,
            "text": query,
            "lang": 1,  # Japanese and English results
            "count": min(settings.max_results_per_source, 100),
            "start": 1,
        },
        timeout=30.0,
        headers={"User-Agent": _UA},
    )
    resp.raise_for_status()

    ns = {
        "atom":  "http://www.w3.org/2005/Atom",
        "prism": "http://prismstandard.org/namespaces/basic/2.0/",
        "dc":    "http://purl.org/dc/elements/1.1/",
    }
    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as e:
        log.warning("J-STAGE XML parse error: %s", e)
        return []

    sources: list[SourceIn] = []
    for entry in root.findall("atom:entry", ns):
        title_el = entry.find("atom:title", ns)
        title = (title_el.text or "").strip() or "Untitled"

        authors = []
        for author_el in entry.findall("atom:author", ns):
            name_el = author_el.find("atom:name", ns)
            if name_el is not None and name_el.text:
                authors.append(name_el.text.strip())

        id_el = entry.find("atom:id", ns)
        url = (id_el.text or "").strip()

        summary_el = entry.find("atom:summary", ns)
        abstract = (summary_el.text or "").strip() or None

        pub_el = entry.find("atom:published", ns)
        year = None
        if pub_el is not None and pub_el.text:
            ym = re.search(r"\b(19|20)\d{2}\b", pub_el.text)
            year = int(ym.group()) if ym else None

        doi_el = entry.find("prism:doi", ns) or entry.find("dc:identifier", ns)
        doi = (doi_el.text or "").strip() or None

        sources.append(SourceIn(
            title=title,
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=abstract,
            source_type="academic",
            metadata={"api": "jstage"},
        ))
    return sources


# ---------------------------------------------------------------------------
# CyberLeninka — Russian open-access repository
# ---------------------------------------------------------------------------

async def _search_cyberleninka(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    resp = await client.post(
        "https://cyberleninka.ru/api/search",
        json={
            "q": query,
            "page": 0,
            "size": min(settings.max_results_per_source, 25),
            "sortBy": "relevance",
        },
    )
    resp.raise_for_status()
    data = resp.json()

    sources: list[SourceIn] = []
    for item in data.get("articles", []):
        doi = item.get("doi") or None
        art_id = item.get("id", "")
        url = (
            f"https://cyberleninka.ru/article/n/{art_id}" if art_id
            else f"https://doi.org/{doi}" if doi else ""
        )
        raw_authors = item.get("authors") or []
        if raw_authors and isinstance(raw_authors[0], dict):
            authors = [a.get("name", "") for a in raw_authors]
        else:
            authors = [str(a) for a in raw_authors]

        journal = item.get("journal") or {}
        venue = journal.get("name") if isinstance(journal, dict) else None

        sources.append(SourceIn(
            title=item.get("name") or "Untitled",
            authors=authors,
            year=item.get("year"),
            doi=doi,
            url=url,
            abstract=item.get("annotation"),
            venue=venue,
            source_type="academic",
            metadata={"api": "cyberleninka"},
        ))
    return sources


# ---------------------------------------------------------------------------
# ERIC — US Education Resources Information Center
# ---------------------------------------------------------------------------

async def _search_eric(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    params: dict[str, Any] = {
        "search": query,
        "fields": "title,author,publicationdateyear,description,url,doi,sourcetitle,id",
        "format": "json",
        "rows": min(settings.max_results_per_source, 100),
        "start": 0,
    }
    if brief.date_range:
        lo, hi = brief.date_range
        params["dateRange"] = f"{lo}-{hi}"

    resp = await client.get("https://api.ies.ed.gov/eric/", params=params)
    resp.raise_for_status()
    data = resp.json()

    sources: list[SourceIn] = []
    for item in data.get("response", {}).get("docs", []):
        eric_id = item.get("id", "")
        doi = item.get("doi")
        url = item.get("url") or (
            f"https://eric.ed.gov/?id={eric_id}" if eric_id
            else f"https://doi.org/{doi}" if doi else ""
        )
        try:
            year = int(item.get("publicationdateyear") or 0) or None
        except (ValueError, TypeError):
            year = None
        authors_raw = item.get("author") or []
        authors = [authors_raw] if isinstance(authors_raw, str) else list(authors_raw)

        sources.append(SourceIn(
            title=item.get("title") or "Untitled",
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=item.get("description"),
            venue=item.get("sourcetitle"),
            source_type="academic",
            metadata={"api": "eric", "eric_id": eric_id},
        ))
    return sources


# ---------------------------------------------------------------------------
# WHO IRIS — WHO institutional repository (Arabic, Chinese, EN, FR, RU, ES)
# ---------------------------------------------------------------------------

async def _search_who_iris(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    resp = await client.get(
        "https://iris.who.int/rest/discover/search/objects",
        params={
            "query": query,
            "rpp": min(settings.max_results_per_source, 50),
            "sort_by": "score",
            "order": "DESC",
            "scope": "",
            "expand": "metadata",
        },
    )
    resp.raise_for_status()
    data = resp.json()

    def _get_meta(metadata: dict, key: str) -> str | None:
        vals = metadata.get(key) or []
        return vals[0].get("value") if vals else None

    def _get_meta_list(metadata: dict, key: str) -> list[str]:
        return [v.get("value", "") for v in (metadata.get(key) or [])]

    sources: list[SourceIn] = []
    embedded = (
        data.get("_embedded", {})
        .get("searchResult", {})
        .get("_embedded", {})
        .get("objects", [])
    )
    for obj in embedded:
        item = obj.get("_embedded", {}).get("indexableObject", {})
        metadata = item.get("metadata", {})

        title = _get_meta(metadata, "dc.title") or "Untitled"
        authors = (
            _get_meta_list(metadata, "dc.contributor.author")
            or _get_meta_list(metadata, "dc.creator")
        )
        doi = _get_meta(metadata, "dc.identifier.doi")
        url = _get_meta(metadata, "dc.identifier.uri") or (
            f"https://doi.org/{doi}" if doi else ""
        )
        abstract = _get_meta(metadata, "dc.description.abstract") or _get_meta(
            metadata, "dc.description"
        )
        venue = _get_meta(metadata, "dc.publisher")
        date_str = _get_meta(metadata, "dc.date.issued") or ""
        ym = re.search(r"\b(19|20)\d{2}\b", date_str)
        year = int(ym.group()) if ym else None

        if not url:
            continue

        sources.append(SourceIn(
            title=title,
            authors=authors,
            year=year,
            doi=doi,
            url=url,
            abstract=abstract,
            venue=venue,
            source_type="academic",
            metadata={"api": "who_iris"},
        ))
    return sources


# ---------------------------------------------------------------------------
# ClinicalTrials.gov — global clinical trial registry
# ---------------------------------------------------------------------------

async def _search_clinicaltrials(
    client: httpx.AsyncClient, query: str, brief: StructuredBrief
) -> list[SourceIn]:
    params: dict[str, Any] = {
        "query.term": query,
        "pageSize": min(settings.max_results_per_source, 100),
        "format": "json",
    }
    if brief.date_range:
        lo, hi = brief.date_range
        params["query.term"] += f" AREA[StartDate] RANGE[{lo}-01-01, {hi}-12-31]"

    resp = await client.get(
        "https://clinicaltrials.gov/api/v2/studies",
        params=params,
    )
    resp.raise_for_status()
    data = resp.json()

    sources: list[SourceIn] = []
    for study in data.get("studies", []):
        protocol = study.get("protocolSection") or {}
        id_mod = protocol.get("identificationModule") or {}
        desc_mod = protocol.get("descriptionModule") or {}
        status_mod = protocol.get("statusModule") or {}
        sponsor_mod = protocol.get("sponsorCollaboratorsModule") or {}

        nct_id = id_mod.get("nctId", "")
        title = id_mod.get("briefTitle") or id_mod.get("officialTitle") or "Untitled"
        abstract = desc_mod.get("briefSummary")
        lead_sponsor = (sponsor_mod.get("leadSponsor") or {}).get("name", "")

        start_date = (status_mod.get("startDateStruct") or {}).get("date", "")
        ym = re.search(r"\b(19|20)\d{2}\b", start_date)
        year = int(ym.group()) if ym else None

        url = f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else ""

        sources.append(SourceIn(
            title=title,
            authors=[lead_sponsor] if lead_sponsor else [],
            year=year,
            doi=None,
            url=url,
            abstract=abstract,
            venue="ClinicalTrials.gov",
            source_type="academic",
            metadata={"api": "clinicaltrials", "nct_id": nct_id},
        ))
    return sources
