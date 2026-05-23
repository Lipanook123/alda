"""Output generators: CSV, JSON, PRISMA stats."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime

from backend.api.models import PrismaStats, SourceOut

_DEFAULT_FIELDS = [
    "id", "title", "authors", "year", "doi", "url",
    "abstract", "venue", "citation_count", "source_type", "relevance", "themes",
]


def generate_csv(sources: list[dict], fields: list[str] | None = None) -> str:
    cols = fields or _DEFAULT_FIELDS
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for src in sources:
        row = dict(src)
        # Serialise list fields
        if isinstance(row.get("authors"), list):
            row["authors"] = "; ".join(row["authors"])
        if isinstance(row.get("themes"), list):
            row["themes"] = "; ".join(row["themes"])
        if isinstance(row.get("created_at"), datetime):
            row["created_at"] = row["created_at"].isoformat()
        writer.writerow(row)
    return out.getvalue()


def generate_json(sources: list[dict]) -> list[dict]:
    result: list[dict] = []
    for src in sources:
        row = dict(src)
        if isinstance(row.get("created_at"), datetime):
            row["created_at"] = row["created_at"].isoformat()
        if isinstance(row.get("metadata"), dict):
            row["metadata"] = json.dumps(row["metadata"])
        result.append(row)
    return result


def compute_prisma_stats(raw: dict) -> PrismaStats:
    """Convert raw DB stats dict into PrismaStats model."""
    return PrismaStats(
        identified=raw.get("identified", 0),
        duplicates_removed=raw.get("duplicates_removed", 0),
        screened=raw.get("screened", 0),
        excluded=raw.get("excluded", 0),
        included=raw.get("included", 0),
        by_source=raw.get("by_source", {}),
    )


def cluster_by_keywords(sources: list[dict], top_n: int = 10) -> list[dict]:
    """Simple keyword-frequency theme clustering when LLM is unavailable."""
    from collections import Counter
    import re

    stopwords = {
        "the", "a", "an", "and", "or", "in", "on", "of", "to", "for",
        "is", "are", "was", "were", "be", "this", "that", "with", "from",
        "by", "as", "at", "an", "also", "study", "research", "paper",
        "using", "used", "results", "data", "based", "show", "shows",
    }

    word_counter: Counter = Counter()
    for src in sources:
        text = f"{src.get('title', '')} {src.get('abstract', '') or ''}"
        words = re.findall(r"\b[a-zA-Z]{4,}\b", text.lower())
        word_counter.update(w for w in words if w not in stopwords)

    themes: list[dict] = []
    for word, count in word_counter.most_common(top_n):
        themes.append({
            "name": word.title(),
            "description": f"Sources mentioning '{word}' ({count} occurrences)",
            "source_count": count,
        })
    return themes
