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
    existing_dois: set[str],
    existing_titles: list[dict],
) -> tuple[list[SourceIn], int]:
    """
    Filter candidates against existing sources and within themselves.
    Returns (unique_candidates, duplicate_count).
    """
    duplicates = 0
    seen_dois: set[str] = set(existing_dois)
    seen_titles: list[dict] = list(existing_titles)
    result: list[SourceIn] = []

    for src in candidates:
        doi_norm = normalize_doi(src.doi) if src.doi else None

        # DOI match
        if doi_norm and doi_norm in seen_dois:
            duplicates += 1
            continue

        # Fuzzy title match
        title_norm = normalize_title(src.title)
        year = src.year
        is_dup = False
        for existing in seen_titles:
            ex_title = normalize_title(existing.get("title") or "")
            ex_year = existing.get("year")
            if not ex_title:
                continue
            score = fuzz.token_sort_ratio(title_norm, ex_title)
            if score >= _SIMILARITY_THRESHOLD:
                # Year check: if both have years and they differ by > 1, not a dup
                if year and ex_year and abs(year - ex_year) > 1:
                    continue
                is_dup = True
                break

        if is_dup:
            duplicates += 1
            continue

        # Assign stable ID
        if not src.id:
            src = src.model_copy(update={"id": make_id(doi_norm)})

        # Register as seen
        if doi_norm:
            seen_dois.add(doi_norm)
        seen_titles.append({"title": src.title, "year": src.year})
        result.append(src)

    return result, duplicates
