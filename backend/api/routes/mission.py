import json
import uuid

from fastapi import APIRouter, HTTPException

from backend.agent import brief_parser
from backend.api.models import MissionBriefIn, MissionBriefOut, QueryOut
from backend.db import database

router = APIRouter(prefix="/mission", tags=["mission"])


@router.post("/parse", response_model=MissionBriefOut)
async def parse_mission(body: MissionBriefIn) -> MissionBriefOut:
    try:
        structured = brief_parser.parse(body.text)
    except brief_parser.LLMNotConfiguredError:
        raise HTTPException(status_code=503, detail="llm_not_configured")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Language model parsing failed: {e}")

    query_id = str(uuid.uuid4())
    async with database.get_conn() as conn:
        database.insert_query(conn, {
            "id": query_id,
            "query_text": body.text[:500],
            "search_strategy": structured.model_dump_json(),
            "status": "pending",
        })

    return MissionBriefOut(query_id=query_id, structured=structured)


@router.get("/", response_model=list[QueryOut])
async def list_queries() -> list[QueryOut]:
    async with database.get_conn() as conn:
        rows = database.list_queries(conn)
    return [QueryOut(**r) for r in rows]


@router.get("/{query_id}", response_model=QueryOut)
async def get_query(query_id: str) -> QueryOut:
    async with database.get_conn() as conn:
        row = database.get_query(conn, query_id)
    if not row:
        raise HTTPException(status_code=404, detail="Query not found")
    return QueryOut(**row)
