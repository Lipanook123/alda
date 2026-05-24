import json
import logging
from pathlib import Path
from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)

# ── Runtime-applied LLM config ──────────────────────────────────────────────
# Set by POST /api/v1/setup/llm. Checked before env-var settings so the
# user can configure the key from the browser on first run.
_runtime_llm: dict[str, str] = {}


def apply_runtime_llm(provider: str, api_key: str, model: str) -> None:
    global _runtime_llm
    _runtime_llm = {"provider": provider, "api_key": api_key, "model": model}


def get_llm_provider() -> str | None:
    return _runtime_llm.get("provider") or settings.llm_provider


def get_llm_api_key() -> str | None:
    return _runtime_llm.get("api_key") or settings.llm_api_key


def get_llm_model() -> str | None:
    return _runtime_llm.get("model") or settings.llm_model


def is_llm_configured() -> bool:
    return bool(get_llm_provider() and get_llm_model())


# ── Runtime-applied source API keys ─────────────────────────────────────────
# Set by POST /api/v1/setup/keys. Checked before env-var settings.
_runtime_keys: dict[str, str] = {}


def apply_runtime_keys(
    semantic_scholar_api_key: str | None = None,
    core_api_key: str | None = None,
    google_cse_id: str | None = None,
    google_api_key: str | None = None,
    bing_api_key: str | None = None,
) -> None:
    global _runtime_keys
    updates = {
        k: v for k, v in {
            "semantic_scholar_api_key": semantic_scholar_api_key,
            "core_api_key": core_api_key,
            "google_cse_id": google_cse_id,
            "google_api_key": google_api_key,
            "bing_api_key": bing_api_key,
        }.items()
        if v is not None
    }
    _runtime_keys.update(updates)


def get_semantic_scholar_key() -> str | None:
    return _runtime_keys.get("semantic_scholar_api_key") or settings.semantic_scholar_api_key


def get_core_key() -> str | None:
    return _runtime_keys.get("core_api_key") or settings.core_api_key


def get_google_cse_id() -> str | None:
    return _runtime_keys.get("google_cse_id") or settings.google_cse_id


def get_google_api_key() -> str | None:
    return _runtime_keys.get("google_api_key") or settings.google_api_key


def get_bing_api_key() -> str | None:
    return _runtime_keys.get("bing_api_key") or settings.bing_api_key


def load_persisted_config() -> None:
    """Called at startup — loads LLM credentials and API keys saved by the setup wizards."""
    config_file = settings.data_dir / "alda_config.json"
    if not config_file.exists():
        return
    try:
        data = json.loads(config_file.read_text())
        provider = data.get("llm_provider", "")
        model = data.get("llm_model", "")
        if provider and model:
            apply_runtime_llm(provider, data.get("llm_api_key", ""), model)
            log.info("Loaded persisted LLM config: %s/%s", provider, model)
        # Load source API keys
        apply_runtime_keys(
            semantic_scholar_api_key=data.get("semantic_scholar_api_key") or None,
            core_api_key=data.get("core_api_key") or None,
            google_cse_id=data.get("google_cse_id") or None,
            google_api_key=data.get("google_api_key") or None,
            bing_api_key=data.get("bing_api_key") or None,
        )
    except Exception as e:
        log.warning("Could not load persisted config: %s", e)


# Keep the old name as an alias for backward compatibility
load_persisted_llm_config = load_persisted_config


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = Path("/data")

    @computed_field
    @property
    def duckdb_path(self) -> Path:
        return self.data_dir / "alda.duckdb"

    scraping_enabled: bool = False

    # LLM — BYOK
    llm_provider: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None

    @computed_field
    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_provider and self.llm_api_key and self.llm_model)

    # Search API keys (optional)
    semantic_scholar_api_key: str | None = None
    core_api_key: str | None = None  # optional; increases CORE rate limit from 10→100 req/min
    google_cse_id: str | None = None
    google_api_key: str | None = None
    bing_api_key: str | None = None

    cors_origins: list[str] = [
        "https://lipanook123.github.io",
        "http://localhost:5500",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://127.0.0.1:5500",
    ]

    max_results_per_source: int = 100
    saturation_threshold: float = 0.05
    saturation_min_iterations: int = 3


settings = Settings()
