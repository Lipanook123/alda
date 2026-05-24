from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# Core entities
# ---------------------------------------------------------------------------

class SourceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    authors: list[str] = []
    year: int | None = None
    doi: str | None = None
    url: str
    abstract: str | None = None
    venue: str | None = None
    citation_count: int | None = None
    source_type: Literal["academic", "grey", "upload", "scraped"] = "academic"
    relevance: float | None = None
    themes: list[str] = []
    metadata: dict = {}
    id: str | None = None


class SourceOut(SourceIn):
    id: str
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# Mission brief
# ---------------------------------------------------------------------------

class StructuredBrief(BaseModel):
    topic: str
    keywords: list[str]
    search_queries: list[str] = []   # targeted Boolean queries generated from the brief
    inclusion_criteria: list[str] = []
    exclusion_criteria: list[str] = []
    date_range: tuple[int, int] | None = None
    source_types: list[str] = ["both"]
    max_results: int = 500
    parsed_with_llm: bool = False    # False = heuristic fallback, True = LLM-parsed
    raw_text: str


class MissionBriefIn(BaseModel):
    text: str


class MissionBriefOut(BaseModel):
    query_id: str
    structured: StructuredBrief


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

class QueryOut(BaseModel):
    id: str
    query_text: str
    search_strategy: str | None = None
    timestamp: datetime | None = None
    results_count: int | None = None
    status: str | None = None


# ---------------------------------------------------------------------------
# Search jobs
# ---------------------------------------------------------------------------

class SearchJobRequest(BaseModel):
    query_id: str
    sources: list[str] = [
        # Core academic databases
        "semantic_scholar", "crossref", "openalex", "arxiv", "pubmed",
        # Global open access (on by default — free, no auth required)
        "core", "europe_pmc", "doaj", "base", "openaire",
        # Web
        "duckduckgo",
    ]
    use_llm_relevance: bool = True
    max_token_budget: int | None = None  # stop LLM scoring when exceeded
    max_results: int | None = None       # override brief.max_results; 0 = unlimited


class SearchProgress(BaseModel):
    current_iteration: int = 0
    total_sources_found: int = 0
    new_this_iteration: int = 0
    duplicates_removed: int = 0
    saturation_reached: bool = False
    source_breakdown: dict[str, int] = {}
    tokens_used: int = 0
    error: str | None = None


class SearchJobStatus(BaseModel):
    job_id: str
    query_id: str
    status: Literal["pending", "running", "complete", "failed", "saturated"] = "pending"
    progress: SearchProgress = SearchProgress()
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class UploadResult(BaseModel):
    records_parsed: int
    records_inserted: int
    records_skipped_duplicate: int
    errors: list[str] = []


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

class ExportRequest(BaseModel):
    query_id: str | None = None
    format: Literal["csv", "json"] = "csv"
    include_fields: list[str] | None = None


# ---------------------------------------------------------------------------
# Themes
# ---------------------------------------------------------------------------

class ThemeOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    source_count: int = 0
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# PRISMA
# ---------------------------------------------------------------------------

class PrismaStats(BaseModel):
    identified: int
    duplicates_removed: int
    screened: int
    excluded: int
    included: int
    by_source: dict[str, int] = {}


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class HealthStatus(BaseModel):
    status: str = "ok"
    db: str = "connected"
    llm_configured: bool = False
    llm_provider: str | None = None
    llm_model: str | None = None
    scraping_enabled: bool = False
    available_sources: dict[str, bool] = {}
    version: str = "0.1.0"
