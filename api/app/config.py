"""Application configuration loaded from environment / .env."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, PostgresDsn, field_validator, model_validator
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

    TRAINING_API_SECRET: str = Field(
        default="",
        min_length=0,
        description="Dedicated shared credential for headless research evaluation. Empty disables research endpoints and worker jobs.",
    )
    TRAINING_OIDC_AUDIENCE: str = Field(
        default="",
        description="Expected Google OIDC audience for the private research API.",
    )
    TRAINING_OIDC_PRINCIPAL: str = Field(
        default="",
        description="Expected verified Google service-account email for research API callers.",
    )
    TRAINING_WORKER_ENABLED: bool = Field(
        default=False,
        description="Enable private research queue consumption on the Docker worker; separate from API authentication credentials.",
    )
    TRAINING_ORGANIZATION_ID: int | None = Field(
        default=None,
        ge=1,
        description="Explicit organization owning the private research dataset registry.",
    )
    TRAINING_MAX_BODY_BYTES: int = Field(default=2 * 1024 * 1024, ge=1024, le=5 * 1024 * 1024)
    TRAINING_MAX_ACTIVE_SAMPLES: int = Field(default=128, ge=1, le=1000)
    TRAINING_DAILY_SAMPLE_LIMIT: int = Field(default=3000, ge=1, le=100000)
    TRAINING_MAX_RETAINED_SAMPLES: int = Field(default=100000, ge=1, le=1000000)
    TRAINING_LEASE_SECONDS: int = Field(default=180, ge=30, le=1800)

    @field_validator("TRAINING_API_SECRET")
    @classmethod
    def validate_training_secret(cls, value: str) -> str:
        if value and len(value) < 32:
            raise ValueError("TRAINING_API_SECRET must contain at least 32 characters")
        return value

    @model_validator(mode="after")
    def validate_training_auth(self) -> "Settings":
        if self.TRAINING_API_SECRET and (not self.TRAINING_OIDC_AUDIENCE or not self.TRAINING_OIDC_PRINCIPAL):
            raise ValueError(
                "TRAINING_OIDC_AUDIENCE and TRAINING_OIDC_PRINCIPAL are required when research API auth is enabled"
            )
        if (self.TRAINING_API_SECRET or self.TRAINING_WORKER_ENABLED) and self.TRAINING_ORGANIZATION_ID is None:
            raise ValueError(
                "TRAINING_ORGANIZATION_ID is required when research API or worker execution is enabled"
            )
        return self

    JUDGE_UPSTREAM_URL: str = Field(
        default="",
        description="Trusted judge VM origin for forwarding /judge requests; never supplied by a caller.",
    )
    JUDGE_HTTP_EXECUTION_ENABLED: bool = Field(
        default=False,
        description="Allow direct HTTP execution outside Cloud Run. Keep disabled on the control API.",
    )
    JUDGE_HOST_EXECUTION_LOCK: str = Field(
        default="",
        description="Optional flock path shared by judge processes on one host; empty disables host-wide serialization.",
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
    JUDGE_DOCKER_IMAGE_GO: str = Field(
        default="golang:1.22-bookworm",
        description="Sandbox image for go compile+run.",
    )
    JUDGE_DOCKER_IMAGE_RUST: str = Field(
        default="rust:1.79-bookworm",
        description="Sandbox image for rust compile+run.",
    )
    JUDGE_DOCKER_IMAGE_NODE: str = Field(
        default="node:20-bookworm-slim",
        description="Sandbox image for javascript run.",
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
        description="Max concurrent direct HTTP judgements per API process. Saturated requests get 503 + Retry-After.",
    )
    DATABASE_TLS_VERIFY: bool = Field(
        default=True,
        description="Require Postgres certificate and hostname verification; disable only for local development.",
    )
    API_EXPOSE_DOCS: bool = Field(
        default=False,
        description="Enable FastAPI documentation endpoints for local development only.",
    )
    JUDGE_LEASE_SECONDS: int = Field(
        default=120,
        ge=30,
        le=1800,
        description="Worker lease duration; active jobs heartbeat before expiration.",
    )
    JUDGE_WORKER_POLL_SECONDS: float = Field(
        default=1.0,
        ge=0.2,
        le=30,
        description="Idle Postgres queue polling interval in worker mode.",
    )
    JUDGE_SECCOMP_PROFILE: str = Field(
        default="/etc/koj/seccomp-koj.json",
        description="Docker daemon host path to the repo-managed seccomp profile (api/seccomp-koj.json provisioned to this path). Always passed as --security-opt seccomp=...; missing/invalid profile fails closed.",
    )

    JUDGE_SANDBOX_MODE: Literal["auto", "docker", "cloudrun", "rlimit"] = Field(
        default="auto",
        description=(
            "Sandbox backend. 'docker' = container backend only (fails closed without "
            "a Docker daemon, see api/DEPLOYMENT_CONTRACT.md). 'rlimit' = host-toolchain "
            "backend with resource.setrlimit CPU/AS/NPROC/FSIZE limits (development only). "
            "'cloudrun' = Cloud Run sandbox launcher. 'auto' = Docker or Cloud Run "
            "when available, otherwise fail closed."
        ),
    )

    @property
    def FASTAPI_URL(self) -> str:
        """Legacy convenience origin. NOT used for CORS (allow-list is localhost + FRONTEND_URL)."""
        return f"http://{self.FASTAPI_HOST}:{self.FASTAPI_PORT}"


settings = Settings()
