"""FastAPI entrypoint for the KOJ API service."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("koj.api")

# Settings-driven CORS allow list. Next.js dev server is always permitted;
# the FastAPI service's own origin is included so the browser can call it
# during local development.
ALLOW_ORIGINS: list[str] = [
    "http://localhost:3000",
    settings.FASTAPI_URL,
]

app = FastAPI(
    title="KOJ API",
    version="0.1.0",
    description="Minimal FastAPI service backing the KOJ Next.js app.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _on_startup() -> None:
    # Never log the DSN — only the bind address.
    logger.info("KOJ API starting on %s:%s", settings.FASTAPI_HOST, settings.FASTAPI_PORT)


@app.get("/")
def root() -> dict[str, str]:
    """Tiny index for sanity-checking the service is up."""
    return {"service": "koj-api", "docs": "/docs"}


@app.get("/health")
def health() -> JSONResponse:
    """Liveness + DB readiness.

    Always returns HTTP 200 so a transient DB blip doesn't take the
    service out of the load balancer — we surface the degradation in
    the payload instead.
    """
    db_ok: bool = db.ping()
    payload: dict[str, object] = {
        "status": "ok" if db_ok else "degraded",
        "db": db_ok,
    }
    return JSONResponse(content=payload, status_code=200)
