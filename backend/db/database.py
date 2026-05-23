import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import duckdb

from backend.db.schema import ALL_TABLES

_conn: duckdb.DuckDBPyConnection | None = None
_lock: asyncio.Lock | None = None


async def init_db(path: Path) -> None:
    global _conn, _lock
    path.parent.mkdir(parents=True, exist_ok=True)
    _conn = duckdb.connect(str(path))
    for sql in ALL_TABLES:
        _conn.execute(sql)
    _lock = asyncio.Lock()


def close_db() -> None:
    global _conn
    if _conn:
        _conn.close()
        _conn = None


@asynccontextmanager
async def get_conn():
    """Async context manager that serialises all DB access via a lock."""
    await _lock.acquire()
    try:
        yield _conn
    finally:
        _lock.release()


# ---------------------------------------------------------------------------
# Helper functions — all called inside `async with get_conn() as conn:`
# ---------------------------------------------------------------------------

def _row_to_source(row: tuple, columns: list[str]) -> dict:
    d = dict(zip(columns, row))
    # DuckDB returns arrays as Python lists natively; JSON as string sometimes
    if isinstance(d.get("metadata"), str):
        try:
            d["metadata"] = json.loads(d["metadata"])
        except Exception:
            d["metadata"] = {}
    return d


def insert_source(conn, source: dict) -> None:
    if "id" not in source or not source["id"]:
        source["id"] = str(uuid.uuid4())
    conn.execute(
        """
        INSERT OR IGNORE INTO sources
            (id, title, authors, year, doi, url, abstract, venue,
             citation_count, source_type, relevance, themes, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            source.get("id"),
            source.get("title", ""),
            source.get("authors") or [],
            source.get("year"),
            source.get("doi"),
            source.get("url", ""),
            source.get("abstract"),
            source.get("venue"),
            source.get("citation_count"),
            source.get("source_type", "academic"),
            source.get("relevance"),
            source.get("themes") or [],
            json.dumps(source.get("metadata") or {}),
        ],
    )


def insert_query(conn, query: dict) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO queries
            (id, query_text, search_strategy, results_count, status)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            query["id"],
            query["query_text"],
            query.get("search_strategy"),
            query.get("results_count"),
            query.get("status", "pending"),
        ],
    )


def update_query_status(conn, query_id: str, status: str, results_count: int | None = None) -> None:
    conn.execute(
        "UPDATE queries SET status = ?, results_count = ? WHERE id = ?",
        [status, results_count, query_id],
    )


def insert_query_log(conn, query_id: str, source_id: str, matched: bool = True, score: float | None = None) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO query_logs (id, query_id, source_id, matched, score)
        VALUES (?, ?, ?, ?, ?)
        """,
        [str(uuid.uuid4()), query_id, source_id, matched, score],
    )


def get_sources_for_query(conn, query_id: str, page: int = 1, page_size: int = 50,
                           sort_by: str = "relevance", source_type: str = "all",
                           min_relevance: float = 0.0) -> list[dict]:
    filters = ["ql.query_id = ?"]
    params: list = [query_id]

    if source_type != "all":
        filters.append("s.source_type = ?")
        params.append(source_type)

    if min_relevance > 0:
        filters.append("(s.relevance IS NULL OR s.relevance >= ?)")
        params.append(min_relevance)

    sort_col = {
        "relevance": "COALESCE(s.relevance, 0) DESC",
        "year": "s.year DESC NULLS LAST",
        "citation_count": "s.citation_count DESC NULLS LAST",
        "title": "s.title ASC",
    }.get(sort_by, "COALESCE(s.relevance, 0) DESC")

    offset = (page - 1) * page_size
    where = " AND ".join(filters)

    rows = conn.execute(
        f"""
        SELECT s.id, s.title, s.authors, s.year, s.doi, s.url, s.abstract,
               s.venue, s.citation_count, s.source_type, s.relevance,
               s.themes, s.metadata, s.created_at
        FROM sources s
        JOIN query_logs ql ON s.id = ql.source_id
        WHERE {where}
        ORDER BY {sort_col}
        LIMIT ? OFFSET ?
        """,
        params + [page_size, offset],
    ).fetchall()

    cols = ["id", "title", "authors", "year", "doi", "url", "abstract",
            "venue", "citation_count", "source_type", "relevance",
            "themes", "metadata", "created_at"]
    return [_row_to_source(r, cols) for r in rows]


def get_all_source_ids(conn) -> set[str]:
    rows = conn.execute("SELECT id FROM sources").fetchall()
    return {r[0] for r in rows}


def get_all_source_dois(conn) -> set[str]:
    rows = conn.execute("SELECT doi FROM sources WHERE doi IS NOT NULL").fetchall()
    return {r[0].lower() for r in rows}


def get_all_sources_brief(conn) -> list[dict]:
    """Return id + normalized title + year for dedup checks."""
    rows = conn.execute("SELECT id, title, year FROM sources").fetchall()
    return [{"id": r[0], "title": r[1], "year": r[2]} for r in rows]


def get_query(conn, query_id: str) -> dict | None:
    row = conn.execute(
        "SELECT id, query_text, search_strategy, timestamp, results_count, status FROM queries WHERE id = ?",
        [query_id],
    ).fetchone()
    if not row:
        return None
    return dict(zip(["id", "query_text", "search_strategy", "timestamp", "results_count", "status"], row))


def list_queries(conn, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        "SELECT id, query_text, search_strategy, timestamp, results_count, status FROM queries ORDER BY timestamp DESC LIMIT ?",
        [limit],
    ).fetchall()
    cols = ["id", "query_text", "search_strategy", "timestamp", "results_count", "status"]
    return [dict(zip(cols, r)) for r in rows]


def delete_query(conn, query_id: str) -> None:
    conn.execute("DELETE FROM query_logs WHERE query_id = ?", [query_id])
    conn.execute("DELETE FROM queries WHERE id = ?", [query_id])


def get_prisma_stats(conn, query_id: str) -> dict:
    total = conn.execute(
        "SELECT COUNT(*) FROM query_logs WHERE query_id = ?", [query_id]
    ).fetchone()[0]

    by_source = conn.execute(
        """
        SELECT s.source_type, COUNT(*)
        FROM query_logs ql JOIN sources s ON ql.source_id = s.id
        WHERE ql.query_id = ?
        GROUP BY s.source_type
        """,
        [query_id],
    ).fetchall()

    included = conn.execute(
        """
        SELECT COUNT(*) FROM query_logs ql JOIN sources s ON ql.source_id = s.id
        WHERE ql.query_id = ? AND (s.relevance IS NULL OR s.relevance >= 0.5)
        """,
        [query_id],
    ).fetchone()[0]

    return {
        "identified": total,
        "duplicates_removed": 0,  # tracked in orchestrator job state
        "screened": total,
        "excluded": total - included,
        "included": included,
        "by_source": {r[0]: r[1] for r in by_source},
    }


def insert_theme(conn, theme: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO themes (id, name, description) VALUES (?, ?, ?)",
        [theme["id"], theme["name"], theme.get("description")],
    )


def get_themes_for_query(conn, query_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT t.id, t.name, t.description, COUNT(DISTINCT s.id) as source_count, t.created_at
        FROM themes t
        JOIN sources s ON list_contains(s.themes, t.id)
        JOIN query_logs ql ON s.id = ql.source_id AND ql.query_id = ?
        GROUP BY t.id, t.name, t.description, t.created_at
        ORDER BY source_count DESC
        """,
        [query_id],
    ).fetchall()
    cols = ["id", "name", "description", "source_count", "created_at"]
    return [dict(zip(cols, r)) for r in rows]
