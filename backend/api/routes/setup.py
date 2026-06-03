"""First-run setup wizard endpoints: configure LLM credentials and source API keys."""
import asyncio
import json
import logging
import sys
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from backend import config as _config

log = logging.getLogger(__name__)
router = APIRouter(tags=["setup"])

_install_jobs: dict[str, dict] = {}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _persist_config() -> None:
    """Write runtime LLM + key config to alda_config.json for restart persistence."""
    config_file = _config.settings.data_dir / "alda_config.json"
    try:
        _config.settings.data_dir.mkdir(parents=True, exist_ok=True)
        existing: dict = {}
        if config_file.exists():
            try:
                existing = json.loads(config_file.read_text())
            except Exception:
                pass
        existing.update({
            "llm_provider": _config.get_llm_provider() or "",
            "llm_api_key": _config.get_llm_api_key() or "",
            "llm_model": _config.get_llm_model() or "",
            "semantic_scholar_api_key": _config.get_semantic_scholar_key() or "",
            "core_api_key": _config.get_core_key() or "",
            "google_cse_id": _config.get_google_cse_id() or "",
            "google_api_key": _config.get_google_api_key() or "",
            "bing_api_key": _config.get_bing_api_key() or "",
            "scraping_enabled": _config.get_scraping_enabled(),
        })
        config_file.write_text(json.dumps(existing))
    except Exception as e:
        log.warning("Could not persist config to disk: %s", e)


async def _check_chromium() -> bool:
    """Return True if the Playwright Chromium binary is already installed."""
    try:
        from playwright.async_api import async_playwright  # noqa: PLC0415
        async with async_playwright() as pw:
            path = pw.chromium.executable_path
        from pathlib import Path  # noqa: PLC0415
        return Path(path).exists()
    except Exception:
        return False


async def _run_chromium_install(job_id: str) -> None:
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "playwright", "install", "chromium",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            _install_jobs[job_id] = {"status": "complete", "message": "Chromium installed."}
        else:
            _install_jobs[job_id] = {"status": "failed", "message": (stdout or b"").decode()[:500]}
    except Exception as e:
        _install_jobs[job_id] = {"status": "failed", "message": str(e)}


# ── LLM setup ────────────────────────────────────────────────────────────────

class LLMSetupRequest(BaseModel):
    provider: str
    api_key: str = ""
    model: str


class LLMSetupResponse(BaseModel):
    success: bool
    message: str


@router.post("/setup/llm", response_model=LLMSetupResponse)
async def configure_llm(req: LLMSetupRequest):
    """Test and save LLM credentials. Works even before env vars are set."""
    try:
        import litellm  # noqa: PLC0415

        litellm.completion(
            model=f"{req.provider}/{req.model}",
            messages=[{"role": "user", "content": "Reply with the single word: ok"}],
            api_key=req.api_key or None,
            max_tokens=8,
            timeout=15,
        )
    except Exception as e:
        err = str(e)
        if "AuthenticationError" in err or "401" in err:
            msg = "Authentication failed — please check your API key and try again."
        elif "NotFoundError" in err or "404" in err:
            msg = f"Model '{req.model}' not found for provider '{req.provider}'. Try a different model name."
        elif "ConnectionError" in err or "connect" in err.lower():
            msg = "Could not reach the AI provider. Check your internet connection and try again."
        else:
            msg = f"Connection failed: {err[:250]}"
        return LLMSetupResponse(success=False, message=msg)

    _config.apply_runtime_llm(req.provider, req.api_key, req.model)
    _persist_config()
    log.info("LLM configured via setup wizard: %s/%s", req.provider, req.model)
    return LLMSetupResponse(success=True, message="AI scoring is now active.")


@router.get("/setup/llm/status")
async def llm_setup_status():
    return {"configured": _config.is_llm_configured()}


# ── Source API keys setup ─────────────────────────────────────────────────────

class KeysSetupRequest(BaseModel):
    semantic_scholar_api_key: str | None = None
    core_api_key: str | None = None
    google_cse_id: str | None = None
    google_api_key: str | None = None
    bing_api_key: str | None = None


@router.post("/setup/keys")
async def setup_keys(req: KeysSetupRequest):
    """Save source API keys at runtime — no server restart required."""
    _config.apply_runtime_keys(**{
        k: v for k, v in req.model_dump().items() if v is not None
    })
    _persist_config()
    log.info("Source API keys updated via settings")
    return {"success": True, "message": "API keys updated."}


@router.get("/setup/keys")
async def get_keys():
    """Return which source keys are configured (values redacted)."""
    return {
        "semantic_scholar": bool(_config.get_semantic_scholar_key()),
        "core": bool(_config.get_core_key()),
        "google_cse": bool(_config.get_google_cse_id() and _config.get_google_api_key()),
        "bing": bool(_config.get_bing_api_key()),
    }


# ── Web scraping toggle ───────────────────────────────────────────────────────

class ScrapingToggleRequest(BaseModel):
    enabled: bool


@router.get("/setup/scraping")
async def get_scraping_status():
    return {
        "enabled": _config.get_scraping_enabled(),
        "chromium_installed": await _check_chromium(),
    }


@router.post("/setup/scraping")
async def set_scraping(req: ScrapingToggleRequest):
    if req.enabled and not await _check_chromium():
        return {"enabled": False, "needs_install": True}
    _config.set_scraping_enabled(req.enabled)
    _persist_config()
    return {"enabled": req.enabled, "needs_install": False}


@router.post("/setup/scraping/install-chromium")
async def install_chromium(background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    _install_jobs[job_id] = {"status": "running", "message": "Downloading Chromium (~150 MB)…"}
    background_tasks.add_task(_run_chromium_install, job_id)
    return {"job_id": job_id}


@router.get("/setup/scraping/install-status/{job_id}")
async def chromium_install_status(job_id: str):
    job = _install_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Install job not found")
    return job
