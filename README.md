# ALDA — Autonomous Literature Discovery Agent

> Automate the discovery phase of literature reviews. Free, open-source, globally applicable.

ALDA combines **free academic APIs**, **grey literature search**, **ethical scraping**, and **LLM-assisted analysis** to produce a comprehensive, reproducible evidence base — with minimal human intervention.

---

## Features

- **Mission Brief Interpreter** — describe your research in plain language; ALDA structures it into a search strategy
- **Academic Search** — Semantic Scholar, CrossRef, OpenAlex, arXiv, PubMed (all free)
- **Grey Literature** — Google CSE, Bing (BYOK), DuckDuckGo
- **Iterative Expansion** — searches refine until saturation (< 5% new results)
- **LLM Relevance Scoring** — BYOK (any OpenAI-compatible provider via litellm)
- **Deduplication** — DOI-based + fuzzy title matching
- **DuckDB Storage** — single-file, portable, analytical queries
- **Export** — CSV / JSON + PRISMA flow statistics
- **File Upload** — import CSV, JSON, or DuckDB from other sources
- **Thematic Clustering** — keyword-frequency or LLM-driven
- **Ethical Scraping** — robots.txt compliance, rate limiting, opt-in only

---

## Quick Start

### Self-Hosted (Docker)

```bash
git clone https://github.com/lipanook123/alda.git
cd alda

# Run backend
docker build -t alda-backend ./backend
docker run -p 8000:8000 -v $(pwd)/data:/data \
  -e DATA_DIR=/data \
  -e LLM_PROVIDER=openai \
  -e LLM_API_KEY=sk-... \
  -e LLM_MODEL=gpt-4o-mini \
  alda-backend

# Open frontend (any static server)
cd frontend && python -m http.server 5500
# Set backend URL in browser console:
# localStorage.setItem("alda_backend_url", "http://localhost:8000")
```

### BYOK Setup {#byok}

ALDA works without any API keys (academic search + DuckDuckGo only).

| Key | Service | Where to get |
|---|---|---|
| `LLM_PROVIDER` + `LLM_API_KEY` + `LLM_MODEL` | Any LLM (OpenAI, Mistral, Ollama…) | Provider dashboard |
| `GOOGLE_CSE_ID` + `GOOGLE_API_KEY` | Google Custom Search | [CSE Control Panel](https://programmablesearchengine.google.com/) |
| `BING_API_KEY` | Bing Web Search | [Azure Portal](https://portal.azure.com) |
| `SEMANTIC_SCHOLAR_API_KEY` | Higher rate limits | [S2 API](https://www.semanticscholar.org/product/api) |

---

## Deployment

### Backend → Render

1. Fork this repo and connect it in [Render](https://render.com/)
2. Render auto-detects `render.yaml` and provisions a web service + 10 GB persistent disk
3. Add your secret env vars in the Render dashboard (LLM_API_KEY, etc.)

### Frontend → GitHub Pages

1. In repo Settings → Pages → Source: **GitHub Actions**
2. Add a repository secret `BACKEND_URL` = your Render URL (e.g. `https://alda-backend.onrender.com`)
3. Push to `main` — the workflow deploys `frontend/` automatically

---

## API Reference

Base URL: `https://your-backend.onrender.com/api/v1`

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Status check |
| `/mission/parse` | POST | Parse free-text brief |
| `/search/start` | POST | Launch background search |
| `/search/status/{job_id}` | GET | Poll job progress |
| `/search/results/{query_id}` | GET | Paginated results |
| `/upload/` | POST | Upload CSV/JSON/DuckDB |
| `/export/` | POST | Download CSV or JSON |
| `/export/prisma/{query_id}` | GET | PRISMA flow statistics |
| `/themes/cluster/{query_id}` | POST | Run theme clustering |
| `/themes/{query_id}` | GET | Get theme clusters |

Interactive docs: `https://your-backend.onrender.com/docs`

---

## Architecture

```
GitHub Pages (Frontend)       Render (Backend)
┌─────────────────────┐      ┌──────────────────────────┐
│ HTML/CSS/Vanilla JS │ ──►  │ FastAPI                  │
│                     │      │  ├── Mission Brief Parser │
│ • Mission form      │      │  ├── Academic Search      │◄── Semantic Scholar
│ • Results table     │      │  │   (async, concurrent)  │◄── CrossRef / OpenAlex
│ • Upload drop zone  │      │  ├── Grey Lit Search      │◄── Google CSE / Bing
│ • Export buttons    │      │  ├── Deduplication        │◄── DuckDuckGo
│ • Theme cloud       │      │  ├── LLM Scoring (BYOK)  │
└─────────────────────┘      │  └── DuckDB (persistent) │
                             └──────────────────────────┘
```

---

## License

[AGPLv3](LICENSE) — free for personal and open-source use. For proprietary/commercial use, contact us for a commercial license.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Funding

ALDA is community-driven. Support development via [GitHub Sponsors](https://github.com/sponsors/lipanook123).
