from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from backend.agent import orchestrator
from backend.api.models import SearchJobRequest, SearchJobStatus, SourceOut
from backend.db import database

router = APIRouter(prefix="/search", tags=["search"])


@router.post("/start")
async def start_search(body: SearchJobRequest, background_tasks: BackgroundTasks) -> dict:
    # Verify query exists
    async with database.get_conn() as conn:
        row = database.get_query(conn, body.query_id)
    if not row:
        raise HTTPException(status_code=404, detail="Query not found. Parse a mission brief first.")

    job = orchestrator.create_job(body.query_id)
    background_tasks.add_task(orchestrator.run_search, job.job_id, body)
    return {"job_id": job.job_id, "status": "pending"}


@router.get("/status/{job_id}", response_model=SearchJobStatus)
async def get_status(job_id: str) -> SearchJobStatus:
    job = orchestrator.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/results/{query_id}/count")
async def get_results_count(
    query_id: str,
    source_type: str = Query("all", pattern="^(all|academic|grey|upload|scraped)$"),
    min_relevance: float = Query(0.0, ge=0.0, le=1.0),
) -> dict:
    async with database.get_conn() as conn:
        return database.count_sources_for_query(
            conn, query_id, source_type=source_type, min_relevance=min_relevance,
        )


@router.get("/results/{query_id}", response_model=list[SourceOut])
async def get_results(
    query_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: str = Query("relevance", pattern="^(relevance|year|citation_count|title)$"),
    source_type: str = Query("all", pattern="^(all|academic|grey|upload|scraped)$"),
    min_relevance: float = Query(0.0, ge=0.0, le=1.0),
) -> list[SourceOut]:
    async with database.get_conn() as conn:
        rows = database.get_sources_for_query(
            conn, query_id, page=page, page_size=page_size,
            sort_by=sort_by, source_type=source_type, min_relevance=min_relevance,
        )
    return [SourceOut(**r) for r in rows]


@router.delete("/{query_id}")
async def delete_query(query_id: str) -> dict:
    async with database.get_conn() as conn:
        row = database.get_query(conn, query_id)
        if not row:
            raise HTTPException(status_code=404, detail="Query not found")
        database.delete_query(conn, query_id)
    return {"deleted": query_id}
