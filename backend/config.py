from pathlib import Path
from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
