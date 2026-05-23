"""Parse uploaded CSV, JSON, and DuckDB files into SourceIn records."""
from __future__ import annotations

import csv
import io
import json
import logging
import uuid

from backend.api.models import SourceIn

log = logging.getLogger(__name__)

# Flexible column name mapping (lowercase key → SourceIn field)
_FIELD_MAP = {
    "id": "id",
    "title": "title",
    "authors": "authors",
    "author": "authors",
    "year": "year",
    "published": "year",
    "publication_year": "year",
    "doi": "doi",
    "url": "url",
    "link": "url",
    "abstract": "abstract",
    "summary": "abstract",
    "venue": "venue",
    "journal": "venue",
    "conference": "venue",
    "citation_count": "citation_count",
    "citations": "citation_count",
    "source_type": "source_type",
    "type": "source_type",
    "relevance": "relevance",
    "score": "relevance",
}


def _normalize_col(col: str) -> str:
    return col.strip().lower().replace(" ", "_").replace("-", "_")


def _map_row(row: dict) -> dict:
    mapped: dict = {}
    for raw_col, value in row.items():
        field = _FIELD_MAP.get(_normalize_col(raw_col))
        if field and value not in (None, "", "NA", "N/A"):
            mapped[field] = value
    return mapped


def _coerce(mapped: dict) -> SourceIn:
    # year
    if "year" in mapped:
        try:
            mapped["year"] = int(mapped["year"])
        except (ValueError, TypeError):
            mapped.pop("year", None)

    # citation_count
    if "citation_count" in mapped:
        try:
            mapped["citation_count"] = int(mapped["citation_count"])
        except (ValueError, TypeError):
            mapped.pop("citation_count", None)

    # relevance
    if "relevance" in mapped:
        try:
            mapped["relevance"] = float(mapped["relevance"])
        except (ValueError, TypeError):
            mapped.pop("relevance", None)

    # authors — accept comma-separated string or JSON array
    if "authors" in mapped and isinstance(mapped["authors"], str):
        raw = mapped["authors"].strip()
        if raw.startswith("["):
            try:
                mapped["authors"] = json.loads(raw)
            except Exception:
                mapped["authors"] = [a.strip() for a in raw.split(",") if a.strip()]
        else:
            mapped["authors"] = [a.strip() for a in raw.split(";") if a.strip()] or \
                                 [a.strip() for a in raw.split(",") if a.strip()]

    # source_type default
    mapped.setdefault("source_type", "upload")

    # ensure url
    if not mapped.get("url"):
        doi = mapped.get("doi")
        mapped["url"] = f"https://doi.org/{doi}" if doi else f"urn:upload:{uuid.uuid4()}"

    # ensure title
    if not mapped.get("title"):
        mapped["title"] = "Untitled"

    return SourceIn(**{k: v for k, v in mapped.items() if k in SourceIn.model_fields})


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def parse_csv(content: bytes) -> tuple[list[SourceIn], list[str]]:
    errors: list[str] = []
    sources: list[SourceIn] = []
    text = content.decode("utf-8-sig", errors="replace")

    try:
        reader = csv.DictReader(io.StringIO(text))
        for i, row in enumerate(reader):
            try:
                mapped = _map_row(dict(row))
                sources.append(_coerce(mapped))
            except Exception as e:
                errors.append(f"Row {i + 2}: {e}")
    except Exception as e:
        errors.append(f"CSV parse error: {e}")

    return sources, errors


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

def parse_json(content: bytes) -> tuple[list[SourceIn], list[str]]:
    errors: list[str] = []
    sources: list[SourceIn] = []
    text = content.decode("utf-8", errors="replace").strip()

    try:
        # Try JSON array first
        if text.startswith("["):
            records = json.loads(text)
        # Try NDJSON
        elif "\n" in text:
            records = [json.loads(line) for line in text.splitlines() if line.strip()]
        else:
            records = [json.loads(text)]
    except Exception as e:
        return [], [f"JSON parse error: {e}"]

    for i, record in enumerate(records):
        if not isinstance(record, dict):
            errors.append(f"Record {i}: not an object")
            continue
        try:
            mapped = _map_row(record)
            sources.append(_coerce(mapped))
        except Exception as e:
            errors.append(f"Record {i}: {e}")

    return sources, errors


# ---------------------------------------------------------------------------
# DuckDB
# ---------------------------------------------------------------------------

def parse_duckdb(path: str) -> tuple[list[SourceIn], list[str]]:
    errors: list[str] = []
    sources: list[SourceIn] = []
    try:
        import duckdb  # noqa: PLC0415

        conn = duckdb.connect(path, read_only=True)
        tables = [r[0] for r in conn.execute("SHOW TABLES").fetchall()]

        table = None
        for candidate in ("sources", "results", "literature"):
            if candidate in tables:
                table = candidate
                break
        if not table and tables:
            table = tables[0]

        if not table:
            errors.append("No tables found in DuckDB file")
            conn.close()
            return [], errors

        rows = conn.execute(f"SELECT * FROM {table}").fetchall()  # noqa: S608
        cols = [d[0] for d in conn.execute(f"DESCRIBE {table}").fetchall()]  # noqa: S608
        conn.close()

        for i, row in enumerate(rows):
            row_dict = dict(zip(cols, row))
            try:
                mapped = _map_row(row_dict)
                sources.append(_coerce(mapped))
            except Exception as e:
                errors.append(f"Row {i}: {e}")

    except Exception as e:
        errors.append(f"DuckDB parse error: {e}")

    return sources, errors
