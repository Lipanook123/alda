import asyncio
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend.api.models import ThemeOut
from backend.config import settings
from backend.db import database
from backend.output.generator import cluster_by_keywords

log = logging.getLogger(__name__)

router = APIRouter(prefix="/themes", tags=["themes"])

_clustering_jobs: dict[str, str] = {}  # job_id -> status


@router.post("/cluster/{query_id}")
async def cluster_themes(query_id: str, background_tasks: BackgroundTasks) -> dict:
    async with database.get_conn() as conn:
        row = database.get_query(conn, query_id)
    if not row:
        raise HTTPException(status_code=404, detail="Query not found")

    job_id = str(uuid.uuid4())
    _clustering_jobs[job_id] = "running"
    background_tasks.add_task(_run_clustering, job_id, query_id)
    return {"job_id": job_id, "status": "running"}


@router.get("/cluster/status/{job_id}")
async def clustering_status(job_id: str) -> dict:
    status = _clustering_jobs.get(job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": status}


@router.get("/{query_id}", response_model=list[ThemeOut])
async def get_themes(query_id: str) -> list[ThemeOut]:
    async with database.get_conn() as conn:
        rows = database.get_themes_for_query(conn, query_id)
    return [ThemeOut(**r) for r in rows]


async def _run_clustering(job_id: str, query_id: str) -> None:
    try:
        async with database.get_conn() as conn:
            sources = database.get_sources_for_query(conn, query_id, page=1, page_size=1000)

        if settings.llm_configured:
            themes = await _cluster_with_llm(sources, query_id)
        else:
            themes = cluster_by_keywords(sources, top_n=10)

        async with database.get_conn() as conn:
            for theme in themes:
                theme_id = theme.get("id") or str(uuid.uuid4())
                database.insert_theme(conn, {
                    "id": theme_id,
                    "name": theme["name"],
                    "description": theme.get("description"),
                })
                # Tag matching sources
                for src in sources:
                    text = f"{src.get('title', '')} {src.get('abstract', '') or ''}".lower()
                    if theme["name"].lower() in text:
                        current_themes = src.get("themes") or []
                        if theme_id not in current_themes:
                            new_themes = current_themes + [theme_id]
                            conn.execute(
                                "UPDATE sources SET themes = ? WHERE id = ?",
                                [new_themes, src["id"]],
                            )

        _clustering_jobs[job_id] = "complete"
    except Exception as e:
        log.exception("Clustering failed for query %s", query_id)
        _clustering_jobs[job_id] = f"failed: {e}"


async def _cluster_with_llm(sources: list[dict], query_id: str) -> list[dict]:
    import json
    import re
    import litellm
    from backend.config import settings

    abstracts = [
        f"Title: {s.get('title', '')}\nAbstract: {(s.get('abstract') or '')[:200]}"
        for s in sources[:30]
    ]
    sample = "\n---\n".join(abstracts)

    prompt = f"""Analyze these research sources and identify 5-8 key thematic clusters.
Return ONLY a JSON array: [{{"name": "Theme Name", "description": "one sentence description"}}]

Sources:
{sample}"""

    response = await asyncio.to_thread(
        litellm.completion,
        model=f"{settings.llm_provider}/{settings.llm_model}",
        messages=[{"role": "user", "content": prompt}],
        api_key=settings.llm_api_key,
        max_tokens=500,
    )
    content = response.choices[0].message.content
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return cluster_by_keywords(sources, top_n=8)

    themes = json.loads(match.group())
    for t in themes:
        t["id"] = str(uuid.uuid4())
    return themes
