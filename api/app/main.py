"""FastAPI entrypoint for the KOJ API service."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .config import settings
from .judge import JudgeRequest, JudgeResponse, execute_judge

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("koj.api")

# Settings-driven CORS allow list. Tight — never ["*"].
# Next.js dev server is always permitted; the FastAPI service's own origin
# is included for local development. Set FRONTEND_URL (e.g.
# https://koj.vercel.app) in production to allow the deployed Next.js app.
_base_origins: list[str] = [
    "http://localhost:3000",
    settings.FASTAPI_URL,
]
if settings.FRONTEND_URL:
    _base_origins.append(settings.FRONTEND_URL)
# Deduplicate while preserving order
ALLOW_ORIGINS: list[str] = list(dict.fromkeys(_base_origins))

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


@app.post("/judge", response_model=JudgeResponse)
def judge_endpoint(
    req: JudgeRequest,
    x_judge_secret: str | None = Header(default=None, alias="X-Judge-Secret"),
) -> JudgeResponse:
    """Internal judge endpoint — requires X-Judge-Secret header."""
    if not settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="judge secret not configured")
    if x_judge_secret != settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")
    if req.language != "python":
        raise HTTPException(status_code=422, detail="only python is supported")
    return execute_judge(req)
