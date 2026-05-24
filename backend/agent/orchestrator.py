"""Central search pipeline orchestrator."""
from __future__ import annotations

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
from backend.agent import iterative

log = logging.getLogger(__name__)

# In-memory job registry (single-instance MVP)
_jobs: dict[str, SearchJobStatus] = {}


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


async def run_search(job_id: str, request: SearchJobRequest) -> None:
    """Full search pipeline, runs as a FastAPI background task."""
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
    academic_sources_requested = [
        s for s in request.sources
        if s in ("semantic_scholar", "crossref", "openalex", "arxiv", "pubmed")
    ]
    grey_sources_requested = [
        s for s in request.sources
        if s in ("google_cse", "bing", "duckduckgo")
    ]

    iteration_new_counts: list[int] = []
    extra_terms: list[str] | None = None
    total_inserted = 0
    total_duplicates = 0
    tokens_total = 0
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

        # Deduplicate
        unique_candidates, dup_count = deduplicate(candidates, existing_dois, existing_titles)
        total_duplicates += dup_count

        # Relevance scoring (LLM if configured, budget permitting)
        if request.use_llm_relevance and _config.is_llm_configured() and unique_candidates:
            budget_ok = (
                request.max_token_budget is None
                or tokens_total < request.max_token_budget
            )
            if budget_ok:
                unique_candidates, batch_tokens = summarizer.score_relevance(unique_candidates, brief)
                tokens_total += batch_tokens
                job.progress.tokens_used = tokens_total
            else:
                log.info(
                    "Token budget %d reached (%d used) — skipping LLM scoring",
                    request.max_token_budget, tokens_total,
                )

        # Insert into DB
        inserted_this_iter = 0
        async with database.get_conn() as conn:
            for src in unique_candidates:
                src_dict = src.model_dump()
                database.insert_source(conn, src_dict)
                database.insert_query_log(conn, query_id, src_dict["id"], matched=True, score=src.relevance)
                inserted_this_iter += 1

        total_inserted += inserted_this_iter
        iteration_new_counts.append(inserted_this_iter)

        # Update progress
        job.progress.total_sources_found = total_inserted
        job.progress.new_this_iteration = inserted_this_iter
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
            job.status = "saturated"
            log.info("Saturation reached after %d iterations", iteration)
            break

        # Generate expanded terms for next iteration
        abstracts = [src.abstract for src in unique_candidates if src.abstract][:20]
        extra_terms = iterative.expand_query(brief, abstracts) if abstracts else None

        # Stop if we have enough results
        if total_inserted >= brief.max_results:
            break

    else:
        job.status = "complete"

    if job.status == "running":
        job.status = "complete"

    job.updated_at = datetime.now(timezone.utc)
    async with database.get_conn() as conn:
        database.update_query_status(conn, query_id, job.status, results_count=total_inserted)

    log.info("Job %s finished with status=%s, total=%d, tokens=%d",
             job.job_id, job.status, total_inserted, tokens_total)
