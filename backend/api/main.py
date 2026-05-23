from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from backend import config as _config
from backend.config import settings
from backend.db.database import close_db, init_db
from backend.api.models import HealthStatus
from backend.api.routes import mission, search, upload, export, themes, setup


@asynccontextmanager
async def lifespan(app: FastAPI):
    _config.load_persisted_llm_config()
    await init_db(settings.duckdb_path)
    yield
    close_db()


app = FastAPI(
    title="ALDA API",
    description="Autonomous Literature Discovery Agent",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mission.router, prefix="/api/v1")
app.include_router(search.router, prefix="/api/v1")
app.include_router(upload.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(themes.router, prefix="/api/v1")
app.include_router(setup.router, prefix="/api/v1")


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")


@app.get("/api/v1/health", response_model=HealthStatus)
async def health():
    return HealthStatus(
        status="ok",
        db="connected",
        llm_configured=_config.is_llm_configured(),
        llm_provider=_config.get_llm_provider(),
        llm_model=_config.get_llm_model(),
        scraping_enabled=settings.scraping_enabled,
        available_sources={
            "semantic_scholar": True,
            "crossref": True,
            "openalex": True,
            "arxiv": True,
            "pubmed": True,
            "google_cse": bool(settings.google_cse_id and settings.google_api_key),
            "bing": bool(settings.bing_api_key),
            "duckduckgo": True,
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "status": 500},
    )
