from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from backend.api.models import ExportRequest, PrismaStats
from backend.db import database
from backend.output import generator

router = APIRouter(prefix="/export", tags=["export"])


@router.post("/")
async def export_sources(body: ExportRequest):
    async with database.get_conn() as conn:
        if body.query_id:
            rows = database.get_sources_for_query(conn, body.query_id, page=1, page_size=10000)
        else:
            # All sources
            raw = conn.execute(
                """SELECT id, title, authors, year, doi, url, abstract, venue,
                   citation_count, source_type, relevance, themes, metadata, created_at
                   FROM sources ORDER BY created_at DESC"""
            ).fetchall()
            cols = ["id", "title", "authors", "year", "doi", "url", "abstract", "venue",
                    "citation_count", "source_type", "relevance", "themes", "metadata", "created_at"]
            rows = [dict(zip(cols, r)) for r in raw]

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    if body.format == "csv":
        content = generator.generate_csv(rows, body.include_fields)
        return Response(
            content=content,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="alda_export_{timestamp}.csv"'},
        )
    else:
        import json
        data = generator.generate_json(rows)
        return Response(
            content=json.dumps(data, default=str, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="alda_export_{timestamp}.json"'},
        )


@router.get("/prisma/{query_id}", response_model=PrismaStats)
async def prisma_stats(query_id: str) -> PrismaStats:
    async with database.get_conn() as conn:
        row = database.get_query(conn, query_id)
        if not row:
            raise HTTPException(status_code=404, detail="Query not found")
        raw = database.get_prisma_stats(conn, query_id)
    return generator.compute_prisma_stats(raw)
