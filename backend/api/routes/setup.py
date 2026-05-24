"""First-run setup wizard endpoint: configure LLM credentials from the browser."""
import json
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from backend import config as _config

log = logging.getLogger(__name__)
router = APIRouter(tags=["setup"])


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
        # Surface the useful part of litellm error messages
        if "AuthenticationError" in err or "401" in err:
            msg = "Authentication failed — please check your API key and try again."
        elif "NotFoundError" in err or "404" in err:
            msg = f"Model '{req.model}' not found for provider '{req.provider}'. Try a different model name."
        elif "ConnectionError" in err or "connect" in err.lower():
            msg = "Could not reach the AI provider. Check your internet connection and try again."
        else:
            msg = f"Connection failed: {err[:250]}"
        return LLMSetupResponse(success=False, message=msg)

    # Persist to the data directory so the config survives restarts
    config_file = _config.settings.data_dir / "alda_config.json"
    try:
        _config.settings.data_dir.mkdir(parents=True, exist_ok=True)
        config_file.write_text(
            json.dumps({
                "llm_provider": req.provider,
                "llm_api_key": req.api_key,
                "llm_model": req.model,
            })
        )
    except Exception as e:
        log.warning("Could not persist LLM config to disk: %s", e)

    _config.apply_runtime_llm(req.provider, req.api_key, req.model)
    log.info("LLM configured via setup wizard: %s/%s", req.provider, req.model)
    return LLMSetupResponse(success=True, message="AI scoring is now active.")


@router.get("/setup/llm/status")
async def llm_setup_status():
    return {"configured": _config.is_llm_configured()}
