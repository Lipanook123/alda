# Running ALDA Locally

This guide walks you through running ALDA entirely on your own machine — no GitHub Pages, no Render account needed.

---

## What you need

| Requirement | Notes |
|---|---|
| **Python 3.11 or 3.12** | Check with `python --version` |
| **Git** | To clone the repo |
| **An LLM API key** | OpenAI, Mistral, Anthropic, or any provider — see [Choosing a provider](#choosing-a-provider) |

A static file server for the frontend is also needed, but Python's built-in one works fine.

---

## 1. Clone the repository

```bash
git clone https://github.com/lipanook123/alda.git
cd alda
```

---

## 2. Set up the backend

### Create a virtual environment

```bash
cd backend
python -m venv venv
```

Activate it:

```bash
# macOS / Linux
source venv/bin/activate

# Windows (Command Prompt)
venv\Scripts\activate.bat

# Windows (PowerShell)
venv\Scripts\Activate.ps1
```

### Install dependencies

```bash
pip install -r requirements.txt
```

This installs FastAPI, DuckDB, litellm, and all other backend dependencies. It may take a minute or two.

### Create a data directory

ALDA stores its database in a `data/` folder. Create it inside the `backend/` directory:

```bash
mkdir data
```

### (Optional) Create a `.env` file

You can set configuration in a `.env` file inside the `backend/` directory instead of passing environment variables each time. Copy the template and edit it:

```bash
# From inside backend/
cp .env.example .env   # if the example exists, otherwise create it manually
```

A minimal `.env` for local use:

```env
DATA_DIR=./data
```

You can also set your LLM key here if you prefer not to enter it in the browser each time:

```env
DATA_DIR=./data
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

> If you set LLM credentials in `.env`, ALDA will use them automatically on startup and skip the setup wizard. If you leave them out, the browser wizard will ask you on first run — this is fine and is the recommended approach for most users.

---

## 3. Start the backend

From inside the `backend/` directory (with your virtual environment active):

```bash
DATA_DIR=./data uvicorn backend.api.main:app --reload --port 8000
```

On Windows:

```cmd
set DATA_DIR=./data && uvicorn backend.api.main:app --reload --port 8000
```

You should see output like:

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Application startup complete.
```

The `--reload` flag restarts the server automatically when you change code. Leave it off if you are not developing.

You can verify the backend is working by visiting: http://localhost:8000/api/v1/health

---

## 4. Serve the frontend

Open a **second terminal** (leave the backend running in the first). From the repo root:

```bash
cd frontend
python -m http.server 5500
```

Then open http://localhost:5500 in your browser.

---

## 5. Connect the frontend to the backend

On first load you will see the **"Connect to server"** screen. Enter:

```
http://localhost:8000
```

and click **Connect**. ALDA will verify the connection and proceed.

If you want to skip this step on future visits, run this once in your browser's developer console (F12 → Console):

```js
localStorage.setItem("alda_backend_url", "http://localhost:8000")
```

---

## 6. Set up your language model

After connecting to the backend, ALDA will show the **Language model setup** wizard. This is required — ALDA uses the LLM to parse your research brief, translate queries for non-English databases, and score results for relevance.

### Choosing a provider

All of the following work with ALDA:

| Provider | Recommended model | Cost (approx.) | Get a key |
|---|---|---|---|
| **OpenAI** | `gpt-4o-mini` | ~$0.01–0.05 per search | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Mistral** | `mistral-small-latest` | ~$0.01–0.03 per search | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys/) |
| **Anthropic** | `claude-haiku-4-5-20251001` | ~$0.01–0.05 per search | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| **Google** | `gemini-1.5-flash` | Very low / free tier | [aistudio.google.com](https://aistudio.google.com/) |
| **DeepSeek** | `deepseek-chat` | Very low | [platform.deepseek.com](https://platform.deepseek.com/) |
| **Ollama** | Any local model | Free (runs locally) | [ollama.ai](https://ollama.ai) — no key needed |

For most users, **OpenAI `gpt-4o-mini`** or **Mistral `mistral-small-latest`** are the best starting points: capable, fast, and inexpensive.

### Entering your key

1. Click your provider in the wizard
2. Follow the link to your provider's dashboard to create an API key
3. Paste the key into ALDA and click **Test & connect**

ALDA tests the key with a single small API call before saving it. The key is stored in your browser's `localStorage` (never sent anywhere except your chosen provider).

---

## 7. Run a search

You are now ready to use ALDA:

1. **Step 1 — Brief**: Describe your research question in plain language
2. **Step 2 — Search**: Choose your databases and click **Start Search**
3. **Scoring gate**: Review how many results each database found, then choose whether to run relevance scoring
4. **Step 3 — Results**: Browse, filter, and export your sources

---

## Optional: Enhanced search coverage

The following API keys are optional but improve coverage or rate limits.

### Semantic Scholar (higher rate limits)

Without a key, Semantic Scholar allows ~1 request per second. With a free key the limit is much higher.

1. Sign up at [semanticscholar.org/product/api](https://www.semanticscholar.org/product/api)
2. Enter the key in ALDA's **Settings → API Keys** panel, or add to `.env`:
   ```env
   SEMANTIC_SCHOLAR_API_KEY=your-key-here
   ```

### CORE (higher rate limits)

CORE provides access to open-access papers. Without a key: 10 requests/min. With a free key: 100 requests/min.

1. Register at [core.ac.uk/services/api](https://core.ac.uk/services/api)
2. Add to Settings or `.env`:
   ```env
   CORE_API_KEY=your-key-here
   ```

### Google Custom Search (grey literature)

Adds Google web search results to your grey literature sweep.

1. Create a Custom Search Engine at [programmablesearchengine.google.com](https://programmablesearchengine.google.com/)
   - Set it to search the whole web
2. Get a Google Cloud API key at [console.cloud.google.com](https://console.cloud.google.com/) with the Custom Search API enabled
3. Add to Settings or `.env`:
   ```env
   GOOGLE_CSE_ID=your-cse-id
   GOOGLE_API_KEY=your-cloud-api-key
   ```

### Bing Web Search (grey literature)

Adds Bing search results. Requires an Azure account.

1. Create a Bing Search resource in the [Azure Portal](https://portal.azure.com)
2. Add to Settings or `.env`:
   ```env
   BING_API_KEY=your-bing-key
   ```

---

## Optional: Web scraping (Playwright)

ALDA can scrape full-text from web pages it finds. This is disabled by default.

### Install Chromium

```bash
# With your virtual environment active, from inside backend/
playwright install chromium
```

### Enable scraping

Toggle it in the ALDA interface under **Settings → Web scraping**, or set it persistently in `.env`:

```env
SCRAPING_ENABLED=true
```

Scraping respects `robots.txt` and applies per-domain rate limiting.

---

## Optional: Docker

If you prefer not to manage a Python environment, you can run the backend with Docker:

```bash
# From the repo root
docker build -t alda-backend -f backend/Dockerfile .

docker run -p 8000:8000 \
  -v $(pwd)/backend/data:/data \
  -e DATA_DIR=/data \
  alda-backend
```

On Windows (PowerShell):

```powershell
docker run -p 8000:8000 `
  -v ${PWD}/backend/data:/data `
  -e DATA_DIR=/data `
  alda-backend
```

Then serve the frontend separately as in [step 4](#4-serve-the-frontend).

---

## Keeping your data

ALDA stores everything in a single DuckDB file: `backend/data/alda.duckdb`. Back this file up to preserve your search history and results. It is fully portable — copy it to another machine and point a new ALDA instance at it.

LLM credentials and API keys are stored in `backend/data/alda_config.json`. These are loaded automatically on startup so you do not need to re-enter them after a restart.

---

## Stopping and restarting

- Stop the backend with **Ctrl+C** in its terminal
- Stop the frontend server with **Ctrl+C** in its terminal
- Restart both the same way you started them — your data is preserved in `backend/data/`

---

## Troubleshooting

### "Connection refused" when connecting the frontend

- Make sure the backend is running (`uvicorn` should be printing logs)
- Check you entered `http://localhost:8000` (not `https://`)
- If you changed the port, use that port number instead

### "CORS error" in the browser console

The backend's allowed origins include `http://localhost:5500` by default. If you serve the frontend on a different port, add it to `CORS_ORIGINS` in `.env`:

```env
CORS_ORIGINS=http://localhost:YOUR_PORT,http://localhost:5500
```

### LLM key test fails

- Double-check the key was copied correctly (no trailing spaces)
- Make sure your account has credit / is not rate-limited
- For Ollama: ensure the Ollama service is running (`ollama serve`) and the model is pulled (`ollama pull mistral`)

### Database errors on startup

If the database file becomes corrupted, delete `backend/data/alda.duckdb` and restart. ALDA will create a fresh one. (Export your results first if you need to keep them.)

### Python version issues

ALDA requires Python 3.11 or 3.12. Check with `python --version`. If your system Python is older, use [pyenv](https://github.com/pyenv/pyenv) (macOS/Linux) or download from [python.org](https://www.python.org/downloads/) (Windows).
