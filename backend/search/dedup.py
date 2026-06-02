import base64
import re
import uuid

from rapidfuzz import fuzz

from backend.api.models import SourceIn

_TITLE_STRIP_RE = re.compile(r"[^a-z0-9 ]")
_SIMILARITY_THRESHOLD = 92


def normalize_doi(doi: str) -> str:
    doi = doi.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
    return doi


def normalize_title(title: str) -> str:
    return _TITLE_STRIP_RE.sub("", title.lower().strip())


def make_id(doi: str | None) -> str:
    if doi:
        safe = base64.urlsafe_b64encode(doi.encode()).decode().rstrip("=")
        return f"doi:{safe}"
    return str(uuid.uuid4())


def deduplicate(
    candidates: list[SourceIn],
    existing_dois: dict[str, str],   # normalized_doi -> source_id
    existing_titles: list[dict],     # dicts with "id", "title", "year"
) -> tuple[list[SourceIn], int, list[str]]:
    """
    Filter candidates against existing sources and within themselves.
    Returns (unique_candidates, duplicate_count, existing_db_ids).

    existing_db_ids contains source IDs that already exist in the DB and were
    duplicated out — the caller should still link them to the current query.
    """
    duplicates = 0
    # Track DB-origin entries separately so we can retrieve their IDs
    db_dois: dict[str, str] = dict(existing_dois)          # doi -> id (DB only)
    db_title_ids: dict[str, str] = {                       # norm_title -> id (DB only)
        normalize_title(r["title"]): r["id"]
        for r in existing_titles if r.get("title") and r.get("id")
    }

    seen_dois: dict[str, str | None] = dict(db_dois)       # doi -> id (None for new)
    seen_titles: list[dict] = list(existing_titles)
    result: list[SourceIn] = []
    existing_db_ids: list[str] = []

    for src in candidates:
        doi_norm = normalize_doi(src.doi) if src.doi else None

        # DOI match
        if doi_norm and doi_norm in seen_dois:
            duplicates += 1
            existing_id = db_dois.get(doi_norm)
            if existing_id:
                existing_db_ids.append(existing_id)
            continue

        # Fuzzy title match
        title_norm = normalize_title(src.title)
        year = src.year
        matched_db_id: str | None = None
        is_dup = False
        for existing in seen_titles:
            ex_title = normalize_title(existing.get("title") or "")
            ex_year = existing.get("year")
            if not ex_title:
                continue
            score = fuzz.token_sort_ratio(title_norm, ex_title)
            if score >= _SIMILARITY_THRESHOLD:
                if year and ex_year and abs(year - ex_year) > 1:
                    continue
                is_dup = True
                matched_db_id = db_title_ids.get(ex_title)
                break

        if is_dup:
            duplicates += 1
            if matched_db_id:
                existing_db_ids.append(matched_db_id)
            continue

        # Assign stable ID
        if not src.id:
            src = src.model_copy(update={"id": make_id(doi_norm)})

        # Register as seen (new entry, no DB id yet)
        if doi_norm:
            seen_dois[doi_norm] = None
        seen_titles.append({"id": None, "title": src.title, "year": src.year})
        result.append(src)

    return result, duplicates, existing_db_ids
