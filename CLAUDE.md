# ALDA — Developer Guide

## Repo Layout
```
alda/
├── frontend/           # GitHub Pages SPA (no build step)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js       # %%BACKEND_URL%% placeholder replaced by CI
├── backend/            # FastAPI app
│   ├── api/            # Routes, models, main entry
│   ├── agent/          # Brief parser, orchestrator, iterative expansion
│   ├── search/         # Academic and grey literature clients + dedup
│   ├── db/             # DuckDB schema + connection management
│   ├── processing/     # LLM summarizer, upload parser, PDF extractor
│   ├── scraping/       # Ethical scraper (disabled by default)
│   ├── output/         # CSV/JSON export, PRISMA stats, theme clustering
│   ├── config.py       # All config via pydantic-settings + env vars
│   ├── requirements.txt
│   └── Dockerfile
├── render.yaml         # Render.com deployment (persistent disk at /data)
└── .github/workflows/pages.yml
```

## Running Locally

```bash
# Backend (from repo root)
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Optional: copy and edit env vars
cp .env.example .env

DATA_DIR=./data uvicorn backend.api.main:app --reload --port 8000

# Frontend (any static server)
cd frontend
python -m http.server 5500
# Open http://localhost:5500
# The app uses localStorage key "alda_backend_url" as override,
# or falls back to the %%BACKEND_URL%% placeholder (which becomes
# http://localhost:8000 for local dev if you set localStorage).
```

Set `alda_backend_url` in browser console for local dev:
```js
localStorage.setItem("alda_backend_url", "http://localhost:8000")
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `/data` | Directory for `alda.duckdb` |
| `LLM_PROVIDER` | `null` | `openai`, `mistral`, `ollama`, etc. |
| `LLM_API_KEY` | `null` | Provider API key |
| `LLM_MODEL` | `null` | e.g. `gpt-4o-mini`, `mistral-large-latest` |
| `SEMANTIC_SCHOLAR_API_KEY` | `null` | Optional — higher rate limits |
| `GOOGLE_CSE_ID` | `null` | Google Custom Search Engine ID |
| `GOOGLE_API_KEY` | `null` | Google Cloud API key |
| `BING_API_KEY` | `null` | Bing Web Search API key |
| `SCRAPING_ENABLED` | `false` | Enable Playwright scraper |
| `CORS_ORIGINS` | `[...]` | Comma-separated CORS allowed origins |

## Architecture Notes

### DuckDB Concurrency
Single write connection (`_conn`) protected by `asyncio.Lock` in `db/database.py`.
All DB access goes through `async with database.get_conn() as conn:`.
This serialises writes — fine for single-user MVP.

### Search Job State
`agent/orchestrator.py` stores job state in a module-level dict `_jobs`.
This is in-memory: lost on restart. Acceptable for MVP (single Render instance).
The `/api/v1/search/status/{job_id}` endpoint reads from this dict.

### LLM Integration
Uses `litellm` as a provider-agnostic wrapper.
Set `LLM_PROVIDER/LLM_API_KEY/LLM_MODEL` env vars.
All LLM calls gracefully skip (no error, no scoring) if not configured.

### Scraping
Hard-gated behind `SCRAPING_ENABLED=true`.
Uses Playwright (Chromium, headless) + robots.txt checking + per-domain rate limiting.
Disabled by default — user must explicitly opt in.

### Saturation Detection
`agent/iterative.py::check_saturation()`:
- Returns True when the last `saturation_min_iterations` (default 3) iterations
  each added fewer than `saturation_threshold` (default 5%) new results relative to total.

## Key Files

| File | Purpose |
|---|---|
| `backend/api/main.py` | FastAPI app, lifespan, CORS, router registration |
| `backend/db/database.py` | DuckDB connection management (the concurrency contract) |
| `backend/agent/orchestrator.py` | Central pipeline, job state machine |
| `backend/config.py` | All configuration — touch this first |
| `frontend/js/app.js` | Entire frontend SPA logic |

## Deployment

### Render (backend)
1. Connect repo in Render dashboard
2. Use `render.yaml` — detected automatically
3. Set secret env vars in Render dashboard (LLM_API_KEY etc.)
4. Render mounts a 10GB disk at `/data`; DuckDB file persists across deploys

### GitHub Pages (frontend)
1. Enable Pages → Source: GitHub Actions
2. Add repo secret `BACKEND_URL` = your Render service URL
3. Push to `main` — workflow deploys automatically
