"""FastAPI entrypoint for the KOJ API service."""

from __future__ import annotations

import hmac
import logging
import os
import threading
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import db
from .config import settings
from .judge import (
    SUPPORTED_LANGUAGES,
    JudgeCase,
    JudgeRequest,
    JudgeResponse,
    execute_judge,
    resolve_sandbox_backend,
    warm_go_cache,
)
from .upstream import JudgeUpstream, JudgeUpstreamUnavailable

# Never log request bodies or case stdin/expected/stdout. Uvicorn access
# logging records method/path/status only (no bodies) by default — keep
# it that way (see api/DEPLOYMENT_CONTRACT.md).

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("koj.api")

_JUDGE_UPSTREAM = (
    JudgeUpstream(settings.JUDGE_UPSTREAM_URL, settings.JUDGE_INTERNAL_SECRET)
    if settings.JUDGE_UPSTREAM_URL
    else None
)

# Settings-driven CORS allow list. Tight: localhost dev + FRONTEND_URL only.
# Never ["*"], never the service's own FASTAPI origin (server-to-server
# judge calls don't need browser CORS).
_base_origins: list[str] = [
    "http://localhost:3000",
]
if settings.FRONTEND_URL:
    _base_origins.append(settings.FRONTEND_URL)
# Deduplicate while preserving order
ALLOW_ORIGINS: list[str] = list(dict.fromkeys(_base_origins))

_JUDGE_BODY_PATHS: tuple[str, ...] = ("/judge", "/judge-async")
_GLOBAL_ACTIVE_JOB_LIMIT = 500

# Bounded concurrency for direct /judge requests. Sync endpoints run in
# FastAPI's threadpool; queue workers process one job per instance.
_JUDGE_SEMAPHORE = threading.BoundedSemaphore(
    1 if settings.JUDGE_SANDBOX_MODE == "cloudrun" else settings.JUDGE_MAX_CONCURRENT
)
_ENQUEUE_SEMAPHORE = threading.BoundedSemaphore(1)
_JUDGE_SATURATED_RETRY_AFTER_S = 5


def _try_acquire_judge_slot() -> bool:
    try:
        return _JUDGE_SEMAPHORE.acquire(blocking=False)
    except Exception:  # noqa: BLE001 — treat semaphore errors as saturated
        return False


def _release_judge_slot() -> None:
    try:
        _JUDGE_SEMAPHORE.release()
    except ValueError:
        # Over-release would raise; saturation accounting stays bounded.
        logger.warning("judge semaphore over-release ignored")
    except Exception:  # noqa: BLE001 — release must never raise
        logger.exception("judge semaphore release failed")


def _saturated(detail: str = "judge saturated") -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=detail,
        headers={"Retry-After": str(_JUDGE_SATURATED_RETRY_AFTER_S)},
    )


def _judge_authorized(provided: str | None) -> bool:
    """Constant-time check of the X-Judge-Secret header."""
    expected = settings.JUDGE_INTERNAL_SECRET
    if not expected or not provided:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


class _BodySizeLimitMiddleware:
    """Raw ASGI middleware: 413 JSON when a judge body exceeds the cap.

    Reads the full body (bounded: judge cap is small) before the handler
    so oversized payloads never reach judging/DB. Other paths pass through.
    """

    def __init__(self, app: Callable, max_bytes: int, paths: tuple[str, ...]) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.paths = paths

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http" or scope.get("path") not in self.paths:
            await self.app(scope, receive, send)
            return None
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        if not _judge_authorized(headers.get("x-judge-secret")):
            response = JSONResponse(status_code=401, content={"detail": "unauthorized"})
            await response(scope, receive, send)
            return None
        try:
            content_length = int(headers.get("content-length", "0") or "0")
        except ValueError:
            content_length = 0
        if content_length > self.max_bytes:
            response = JSONResponse(status_code=413, content={"detail": "request body too large"})
            await response(scope, receive, send)
            return None
        body = b""
        more = True
        while more:
            message = await receive()
            if message.get("type") == "http.disconnect":
                return None
            if message.get("type") != "http.request":
                continue
            chunk: bytes = message.get("body", b"")
            body += chunk
            if len(body) > self.max_bytes:
                response = JSONResponse(status_code=413, content={"detail": "request body too large"})
                await response(scope, receive, send)
                return None
            more = message.get("more_body", False)

        async def _replay():
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, _replay, send)
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast: judging without a secret would silently accept/reject.
    if not settings.JUDGE_INTERNAL_SECRET:
        raise RuntimeError("JUDGE_INTERNAL_SECRET is not configured")
    try:
        db.init_pool()
        logger.info("psycopg pool ready")
    except Exception:
        # Health degrades (db=false) instead of crashing the service.
        logger.exception("psycopg pool init failed; /health will report degraded")
    # Warm the Go build cache off the critical path: a cold cache makes the
    # first Go submission pay a full standard-library build.
    threading.Thread(target=warm_go_cache, name="go-cache-warm", daemon=True).start()
    logger.info("KOJ API starting on %s:%s", settings.FASTAPI_HOST, settings.FASTAPI_PORT)
    yield
    db.close_pool()


app = FastAPI(
    title="KOJ API",
    version="0.1.0",
    description="Minimal FastAPI service backing the KOJ Next.js app.",
    lifespan=lifespan,
    docs_url="/docs" if settings.API_EXPOSE_DOCS else None,
    redoc_url="/redoc" if settings.API_EXPOSE_DOCS else None,
    openapi_url="/openapi.json" if settings.API_EXPOSE_DOCS else None,
)

app.add_middleware(_BodySizeLimitMiddleware, max_bytes=settings.MAX_JUDGE_BODY_BYTES, paths=_JUDGE_BODY_PATHS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Judge-Secret", "Authorization", "Idempotency-Key"],
)


@app.get("/")
def root() -> dict[str, str]:
    """Tiny index for sanity-checking the service is up."""
    return {"service": "koj-api"}


@app.get("/health")
def health() -> JSONResponse:
    """Cheap public liveness check without database or configuration details."""
    return JSONResponse(content={"status": "ok"}, status_code=200)


@app.get("/ready")
def ready(x_judge_secret: str | None = Header(default=None, alias="X-Judge-Secret")) -> JSONResponse:
    if not _judge_authorized(x_judge_secret):
        raise HTTPException(status_code=401, detail="unauthorized")
    db_ok = db.ping()
    upstream_ok = _JUDGE_UPSTREAM.ready() if _JUDGE_UPSTREAM is not None else False
    local_execution = settings.JUDGE_HTTP_EXECUTION_ENABLED and not os.environ.get("K_SERVICE")
    execution_available = upstream_ok or local_execution
    ready_ok = db_ok and execution_available
    return JSONResponse(
        content={
            "status": "ok" if ready_ok else "degraded",
            "db": db_ok,
            "execution_available": execution_available,
            "sandbox": resolve_sandbox_backend(),
        },
        status_code=200 if ready_ok else 503,
    )


class JudgeAsyncRequest(BaseModel):
    submission_id: int = Field(ge=1)


@app.post("/judge-async")
def judge_async_endpoint(
    req: JudgeAsyncRequest,
    x_judge_secret: str | None = Header(default=None, alias="X-Judge-Secret"),
) -> JSONResponse:
    """Idempotently enqueue a submission for a pull worker."""
    if not settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="judge secret not configured")
    if not _judge_authorized(x_judge_secret):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not _ENQUEUE_SEMAPHORE.acquire(blocking=False):
        raise _saturated("judge enqueue saturated")

    try:
        with db.get_connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_xact_lock(hashtext('koj:queue-admission'), 0)")
                    cur.execute(
                        "SELECT status FROM submissions WHERE id = %s",
                        (req.submission_id,),
                    )
                    row = cur.fetchone()
                    if row is None:
                        raise HTTPException(status_code=404, detail="submission not found")
                    if row[0] not in ("pending", "running"):
                        return JSONResponse(
                            status_code=200,
                            content={"status": row[0], "deduped": True},
                        )
                    cur.execute(
                        "SELECT status FROM judge_jobs WHERE submission_id = %s",
                        (req.submission_id,),
                    )
                    existing_job = cur.fetchone()
                    if existing_job is not None:
                        return JSONResponse(
                            status_code=200,
                            content={"status": existing_job[0], "deduped": True},
                        )
                    cur.execute(
                        "SELECT count(*) FROM judge_jobs WHERE status IN ('queued', 'leased')"
                    )
                    active_job_count = cur.fetchone()[0]
                    if active_job_count >= _GLOBAL_ACTIVE_JOB_LIMIT:
                        raise _saturated("judge queue saturated")
                    cur.execute(
                        "INSERT INTO judge_jobs (submission_id) VALUES (%s) "
                        "ON CONFLICT (submission_id) DO NOTHING",
                        (req.submission_id,),
                    )
    finally:
        _ENQUEUE_SEMAPHORE.release()

    return JSONResponse(status_code=202, content={"status": "pending", "queued": True})


@app.post("/judge", response_model=JudgeResponse)
def judge_endpoint(
    req: JudgeRequest,
    x_judge_secret: str | None = Header(default=None, alias="X-Judge-Secret"),
) -> JudgeResponse:
    """Internal judge endpoint — requires X-Judge-Secret header.

    Bounded by a per-process semaphore (503 + Retry-After when saturated).
    Hidden cases (is_sample=false, the default) get
    redacted stdout/stderr; check `infra_error` before blaming the
    submission.
    """
    if not settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="judge secret not configured")
    if not _judge_authorized(x_judge_secret):
        raise HTTPException(status_code=401, detail="unauthorized")
    if req.language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=422,
            detail=f"supported languages: {', '.join(SUPPORTED_LANGUAGES)}",
        )
    if not _try_acquire_judge_slot():
        raise _saturated()
    try:
        if _JUDGE_UPSTREAM is not None:
            try:
                return _JUDGE_UPSTREAM.judge(req)
            except JudgeUpstreamUnavailable:
                raise HTTPException(status_code=503, detail="judge execution unavailable") from None
        if os.environ.get("K_SERVICE") or not settings.JUDGE_HTTP_EXECUTION_ENABLED:
            raise HTTPException(status_code=503, detail="judge execution unavailable")
        return execute_judge(req)
    finally:
        _release_judge_slot()
