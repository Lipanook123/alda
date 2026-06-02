import os
import tempfile

from fastapi import APIRouter, Form, HTTPException, UploadFile

from backend.api.models import UploadResult
from backend.db import database
from backend.processing import upload_parser
from backend.search.dedup import deduplicate

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("/", response_model=UploadResult)
async def upload_file(
    file: UploadFile,
    query_id: str | None = Form(default=None),
) -> UploadResult:
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    content = await file.read()
    errors: list[str] = []

    if ext == "csv":
        sources, errors = upload_parser.parse_csv(content)
    elif ext == "json" or ext == "jsonl":
        sources, errors = upload_parser.parse_json(content)
    elif ext in ("duckdb", "db"):
        # Write to a temp file first
        with tempfile.NamedTemporaryFile(suffix=".duckdb", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            sources, errors = upload_parser.parse_duckdb(tmp_path)
        finally:
            os.unlink(tmp_path)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext!r}. Use CSV, JSON, or DuckDB.",
        )

    # Dedup against existing DB
    async with database.get_conn() as conn:
        existing_dois = database.get_all_source_dois(conn)
        existing_titles = database.get_all_sources_brief(conn)

    unique_sources, dup_count, existing_db_ids = deduplicate(sources, existing_dois, existing_titles)

    inserted = 0
    async with database.get_conn() as conn:
        for src in unique_sources:
            src_dict = src.model_dump()
            database.insert_source(conn, src_dict)
            if query_id:
                database.insert_query_log(conn, query_id, src_dict["id"])
            inserted += 1
        if query_id:
            for src_id in existing_db_ids:
                database.insert_query_log(conn, query_id, src_id)

    return UploadResult(
        records_parsed=len(sources),
        records_inserted=inserted,
        records_skipped_duplicate=dup_count,
        errors=errors,
    )
