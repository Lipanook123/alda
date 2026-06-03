"""Central search pipeline orchestrator."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from backend.api.models import SearchJobRequest, SearchJobStatus, SearchProgress, StructuredBrief
from backend import config as _config
from backend.config import settings
from backend.db import database
from backend.search import academic, grey
from backend.search.dedup import deduplicate
from backend.processing import summarizer
from backend.processing.translator import detect_language, translate_to_english
from backend.agent import iterative

log = logging.getLogger(__name__)

# In-memory job registry (single-instance MVP)
_jobs: dict[str, SearchJobStatus] = {}
_job_requests: dict[str, SearchJobRequest] = {}


def create_job(query_id: str) -> SearchJobStatus:
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    job = SearchJobStatus(
        job_id=job_id,
        query_id=query_id,
        status="pending",
        progress=SearchProgress(),
        created_at=now,
        updated_at=now,
    )
    _jobs[job_id] = job
    return job


def get_job(job_id: str) -> SearchJobStatus | None:
    return _jobs.get(job_id)


def get_job_request(job_id: str) -> SearchJobRequest | None:
    return _job_requests.get(job_id)


async def run_search(job_id: str, request: SearchJobRequest) -> None:
    """Search pipeline (fetch + dedup + insert). Pauses at awaiting_scoring for user confirmation."""
    _job_requests[job_id] = request
    job = _jobs[job_id]
    job.status = "running"
    job.updated_at = datetime.now(timezone.utc)

    try:
        await _pipeline(job, request)
    except Exception as e:
        log.exception("Search pipeline error for job %s", job_id)
        job.status = "failed"
        job.progress.error = str(e)
        job.updated_at = datetime.now(timezone.utc)
        async with database.get_conn() as conn:
            database.update_query_status(conn, request.query_id, "failed")


async def run_scoring(job_id: str) -> None:
    """LLM relevance scoring phase, runs after user confirms."""
    job = _jobs.get(job_id)
    request = _job_requests.get(job_id)
    if not job or not request:
        log.error("run_scoring called for unknown job %s", job_id)
        return

    job.status = "scoring"
    job.updated_at = datetime.now(timezone.utc)

    try:
        await _score_phase(job, request)
    except Exception as e:
        log.exception("Scoring error for job %s", job_id)
        job.status = "failed"
        job.progress.error = str(e)
        job.updated_at = datetime.now(timezone.utc)
        async with database.get_conn() as conn:
            database.update_query_status(conn, request.query_id, "failed")


async def _pipeline(job: SearchJobStatus, request: SearchJobRequest) -> None:
    query_id = request.query_id

    # Load structured brief from DB
    async with database.get_conn() as conn:
        query_row = database.get_query(conn, query_id)

    if not query_row:
        raise ValueError(f"Query {query_id} not found")

    strategy_json = query_row.get("search_strategy") or "{}"
    try:
        brief_data = json.loads(strategy_json)
        brief = StructuredBrief(**brief_data)
    except Exception as e:
        raise ValueError(f"Could not load structured brief: {e}") from e

    # Mark query as running
    async with database.get_conn() as conn:
        database.update_query_status(conn, query_id, "running")

    # Separate academic vs grey sources
    _ACADEMIC_SOURCES = frozenset({
        "semantic_scholar", "crossref", "openalex", "arxiv", "pubmed",
        "core", "europe_pmc", "doaj", "base", "openaire",
        "scielo", "jstage", "cyberleninka", "eric", "who_iris", "clinicaltrials",
    })
    academic_sources_requested = [s for s in request.sources if s in _ACADEMIC_SOURCES]
    grey_sources_requested = [
        s for s in request.sources
        if s in ("google_cse", "bing", "duckduckgo")
    ]

    iteration_new_counts: list[int] = []
    extra_terms: list[str] | None = None
    total_inserted = 0
    total_duplicates = 0
    max_iterations = 5

    for iteration in range(1, max_iterations + 1):
        job.progress.current_iteration = iteration
        job.updated_at = datetime.now(timezone.utc)

        # Fetch existing state for dedup
        async with database.get_conn() as conn:
            existing_dois = database.get_all_source_dois(conn)
            existing_titles = database.get_all_sources_brief(conn)

        # Search
        academic_results = []
        grey_results = []
        if academic_sources_requested:
            academic_results = await academic.search(brief, academic_sources_requested, extra_terms)
        if grey_sources_requested:
            grey_results = await grey.search(brief, grey_sources_requested, extra_terms)

        candidates = academic_results + grey_results

        # Deduplicate — also returns IDs of sources already in DB that match
        unique_candidates, dup_count, existing_db_ids = deduplicate(
            candidates, existing_dois, existing_titles
        )
        total_duplicates += dup_count

        # Language detection + title/abstract translation for non-English content
        if _config.is_llm_configured():
            for src in unique_candidates:
                text = src.abstract or src.title or ""
                lang = detect_language(text)
                if lang:
                    src.metadata["detected_language"] = lang
                    translated_title = await asyncio.to_thread(translate_to_english, src.title, lang)
                    translated_abstract = await asyncio.to_thread(translate_to_english, src.abstract or "", lang)
                    if translated_title:
                        src.metadata["translated_title"] = translated_title
                    if translated_abstract:
                        src.metadata["translated_abstract"] = translated_abstract

        # Insert into DB
        inserted_this_iter = 0
        async with database.get_conn() as conn:
            for src in unique_candidates:
                src_dict = src.model_dump()
                database.insert_source(conn, src_dict)
                database.insert_query_log(conn, query_id, src_dict["id"], matched=True, score=src.relevance)
                inserted_this_iter += 1
            # Link DB-duplicate sources to this query so they appear in results
            for src_id in existing_db_ids:
                database.insert_query_log(conn, query_id, src_id, matched=True)

        linked_this_iter = inserted_this_iter + len(existing_db_ids)
        total_inserted += linked_this_iter
        iteration_new_counts.append(linked_this_iter)

        # Update progress
        job.progress.total_sources_found = total_inserted
        job.progress.new_this_iteration = linked_this_iter
        job.progress.duplicates_removed = total_duplicates
        # Track per-source breakdown
        for src in unique_candidates:
            api_name = (src.metadata or {}).get("api", src.source_type)
            job.progress.source_breakdown[api_name] = (
                job.progress.source_breakdown.get(api_name, 0) + 1
            )
        job.updated_at = datetime.now(timezone.utc)

        log.info(
            "Iteration %d: found %d new, %d duplicates, %d total",
            iteration, inserted_this_iter, dup_count, total_inserted,
        )

        # Check saturation
        if iterative.check_saturation(iteration_new_counts, total_inserted):
            job.progress.saturation_reached = True
            log.info("Saturation reached after %d iterations", iteration)
            break

        # Generate expanded terms for next iteration
        abstracts = [src.abstract for src in unique_candidates if src.abstract][:20]
        extra_terms = iterative.expand_query(brief, abstracts) if abstracts else None

        # Stop if we have enough results (0 = unlimited, rely on saturation)
        effective_limit = request.max_results if request.max_results is not None else brief.max_results
        if effective_limit and total_inserted >= effective_limit:
            break

    # Always pause for user to review source counts before any LLM scoring
    job.status = "awaiting_scoring"
    job.updated_at = datetime.now(timezone.utc)
    async with database.get_conn() as conn:
        database.update_query_status(conn, query_id, job.status, results_count=total_inserted)

    log.info("Job %s search phase done: status=%s, total=%d", job.job_id, job.status, total_inserted)


async def _score_phase(job: SearchJobStatus, request: SearchJobRequest) -> None:
    """Score all sources for this query with the LLM and update the DB."""
    query_id = request.query_id

    async with database.get_conn() as conn:
        query_row = database.get_query(conn, query_id)
    brief_data = json.loads(query_row.get("search_strategy") or "{}")
    brief = StructuredBrief(**brief_data)

    async with database.get_conn() as conn:
        sources_data = database.get_sources_for_query_all(conn, query_id)

    from backend.api.models import SourceIn as _SourceIn  # noqa: PLC0415
    source_ins: list[_SourceIn] = []
    for s in sources_data:
        try:
            source_ins.append(_SourceIn(**s))
        except Exception:
            pass

    tokens_total = 0
    if source_ins:
        budget_ok = (request.max_token_budget is None or tokens_total < request.max_token_budget)
        if budget_ok:
            scored, batch_tokens = summarizer.score_relevance(source_ins, brief)
            tokens_total += batch_tokens
            job.progress.tokens_used = tokens_total
            async with database.get_conn() as conn:
                for src in scored:
                    if src.relevance is not None and src.id:
                        database.update_source_relevance(conn, src.id, src.relevance)

    final_status = "saturated" if job.progress.saturation_reached else "complete"
    job.status = final_status
    job.updated_at = datetime.now(timezone.utc)
    async with database.get_conn() as conn:
        database.update_query_status(conn, query_id, final_status)

    log.info("Job %s scoring done: status=%s, sources=%d, tokens=%d",
             job.job_id, final_status, len(source_ins), tokens_total)
