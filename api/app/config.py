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

    JUDGE_INTERNAL_SECRET: str = Field(
        default="",
        description="Shared secret for internal /judge calls. Empty = judge disabled (returns 500).",
    )

    FRONTEND_URL: str = Field(
        default="",
        description="Production frontend origin for CORS (e.g. https://koj.vercel.app). Empty = localhost-only in dev.",
    )

    MAX_JUDGE_BODY_BYTES: int = Field(
        default=262144,
        ge=1024,
        le=10 * 1024 * 1024,
        description="Max request body (bytes) accepted on /judge and /judge-async. Larger -> 413.",
    )

    # Docker-only sandbox images. Fixed server-side allow-list — never taken
    # from the request. Pre-pull these on the judge host.
    JUDGE_DOCKER_IMAGE_PYTHON: str = Field(
        default="python:3.11-slim",
        description="Sandbox image for python compile+run.",
    )
    JUDGE_DOCKER_IMAGE_GCC: str = Field(
        default="gcc:13-bookworm",
        description="Sandbox image for c and c++ compile+run.",
    )
    JUDGE_DOCKER_IMAGE_JAVA: str = Field(
        default="eclipse-temurin:17-jdk-jammy",
        description="Sandbox image for java compile+run.",
    )
    JUDGE_DOCKER_CPUS: float = Field(
        default=1.0,
        ge=0.1,
        le=4.0,
        description="CPU limit passed as docker --cpus.",
    )
    JUDGE_DOCKER_PIDS_LIMIT: int = Field(
        default=64,
        ge=16,
        le=512,
        description="docker --pids-limit for the sandbox.",
    )
    JUDGE_DOCKER_USER: str = Field(
        default="65534:65534",
        description="Non-root user for docker --user (uid:gid).",
    )
    JUDGE_MAX_CONCURRENT: int = Field(
        default=4,
        ge=1,
        le=32,
        description="Max concurrent judgements per FastAPI worker. Saturated requests get 503 + Retry-After.",
    )
    JUDGE_SECCOMP_PROFILE: str = Field(
        default="/etc/koj/seccomp-koj.json",
        description="Docker daemon host path to the repo-managed seccomp profile (api/seccomp-koj.json provisioned to this path). Always passed as --security-opt seccomp=...; missing/invalid profile fails closed.",
    )

    @property
    def FASTAPI_URL(self) -> str:
        """Legacy convenience origin. NOT used for CORS (allow-list is localhost + FRONTEND_URL)."""
        return f"http://{self.FASTAPI_HOST}:{self.FASTAPI_PORT}"


settings = Settings()
