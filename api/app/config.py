"""Application configuration loaded from environment / .env."""

from __future__ import annotations

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the FastAPI service.

    Values are loaded from environment variables and (in development)
    a local `.env` file. Never log this object directly — it contains
    the database DSN.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    DATABASE_URL: PostgresDsn = Field(
        ...,
        description="Postgres connection string, e.g. postgresql://user:pw@host/db?sslmode=require",
    )

    FASTAPI_HOST: str = Field(
        default="127.0.0.1",
        description="Interface the uvicorn server binds to.",
    )
    FASTAPI_PORT: int = Field(
        default=8000,
        ge=1,
        le=65535,
        description="TCP port the uvicorn server binds to.",
    )

    @property
    def FASTAPI_URL(self) -> str:
        """Convenience: the http://host:port origin for CORS allow-lists."""
        return f"http://{self.FASTAPI_HOST}:{self.FASTAPI_PORT}"


settings = Settings()
