from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed settings; credential values are never logged or serialized."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-5-mini", validation_alias="OPENAI_MODEL")
    google_routes_server_api_key: str | None = Field(
        default=None, validation_alias="GOOGLE_ROUTES_SERVER_API_KEY"
    )
    google_maps_browser_api_key: str | None = Field(
        default=None, validation_alias="GOOGLE_MAPS_BROWSER_API_KEY"
    )
    tdx_client_id: str | None = Field(default=None, validation_alias="TDX_CLIENT_ID")
    tdx_client_secret: str | None = Field(default=None, validation_alias="TDX_CLIENT_SECRET")
    cors_allowed_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        validation_alias="CORS_ALLOWED_ORIGINS",
    )
    solver_time_limit_seconds: int = Field(
        default=10, ge=1, le=300, validation_alias="SOLVER_TIME_LIMIT_SECONDS"
    )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    def credential_status(self) -> dict[str, str]:
        return {
            "OPENAI_API_KEY": "CONFIGURED" if self.openai_api_key else "MISSING",
            "OPENAI_MODEL": "CONFIGURED" if self.openai_model else "MISSING",
            "GOOGLE_ROUTES_SERVER_API_KEY": "CONFIGURED"
            if self.google_routes_server_api_key
            else "MISSING",
            "GOOGLE_MAPS_BROWSER_API_KEY": "CONFIGURED"
            if self.google_maps_browser_api_key
            else "MISSING",
            "TDX_CLIENT_ID": "CONFIGURED" if self.tdx_client_id else "MISSING",
            "TDX_CLIENT_SECRET": "CONFIGURED" if self.tdx_client_secret else "MISSING",
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
