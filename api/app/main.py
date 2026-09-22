"""FastAPI entrypoint for the KOJ API service."""

from __future__ import annotations

import hmac
import logging
import threading
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import db
from .config import settings
from .judge import SUPPORTED_LANGUAGES, JudgeCase, JudgeRequest, JudgeResponse, execute_judge

# Never log request bodies or case stdin/expected/stdout. Uvicorn access
# logging records method/path/status only (no bodies) by default — keep
# it that way (see api/DEPLOYMENT_CONTRACT.md).

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("koj.api")

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

# Bounded concurrency: one slot per concurrent judgement. Sync
# endpoints run in FastAPI's threadpool (event loop never blocked by
# CPU-bound judging); saturated callers get 503 + Retry-After instead
# of queueing indefinitely. Single uvicorn worker is intentional
# (Docker daemon contention); scale via host sizing, not workers.
_JUDGE_SEMAPHORE = threading.BoundedSemaphore(settings.JUDGE_MAX_CONCURRENT)
_JUDGE_SATURATED_RETRY_AFTER_S = 5
# Advisory-lock namespace for serializing duplicate /judge-async
# dispatches of the same submission (DB session locks, not a new table).
_JUDGE_ASYNC_LOCK_KEY = "koj-judge-async"


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
    logger.info("KOJ API starting on %s:%s", settings.FASTAPI_HOST, settings.FASTAPI_PORT)
    yield
    db.close_pool()


app = FastAPI(
    title="KOJ API",
    version="0.1.0",
    description="Minimal FastAPI service backing the KOJ Next.js app.",
    lifespan=lifespan,
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


class JudgeAsyncRequest(BaseModel):
    submission_id: int = Field(ge=1)


def _sanitized_idempotency_key(raw: str | None) -> str | None:
    """Validate the optional Idempotency-Key; None when absent/invalid.

    Invalid keys are ignored (compatibility: current Next dispatch
    sends no key) and never reject a valid retry. Logs carry only a
    truncated prefix, never case content.
    """
    if raw is None:
        return None
    key = raw.strip()
    if not key or len(key) > 128:
        return None
    if not all(c.isalnum() or c in "-_:.~" for c in key):
        return None
    return key


@app.post("/judge-async")
def judge_async_endpoint(
    req: JudgeAsyncRequest,
    x_judge_secret: str | None = Header(default=None, alias="X-Judge-Secret"),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> JSONResponse:
    """Async judge: fetch submission from DB, judge, write verdict back.

    Idempotency: dispatch dedupes by submission ID under a
    non-blocking advisory lock, preserving the running-status guard.
    A duplicate that arrives after completion replays the stored
    status (200, deduped) instead of re-judging. The optional
    Idempotency-Key header is accepted for Next retry wiring (current
    Next sends none; key is observed and logged, dedupe key remains
    the submission ID — no new table).
    """
    if not settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="judge secret not configured")
    if not _judge_authorized(x_judge_secret):
        raise HTTPException(status_code=401, detail="unauthorized")

    # Verify submission exists before acquiring a judge slot — prevents
    # non-existent IDs from consuming capacity or advisory locks.
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM submissions WHERE id = %s", (submission_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail="submission not found")
    except HTTPException:
        raise
    except Exception:
        logger.exception("submission existence check failed for %s", submission_id)
        raise HTTPException(status_code=500, detail="submission lookup failed")

    key = _sanitized_idempotency_key(idempotency_key)
    if idempotency_key is not None and key is None:
        logger.warning("judge-async ignoring malformed Idempotency-Key")

    if not _try_acquire_judge_slot():
        raise _saturated()

    now = datetime.now(timezone.utc)
    total_tests = 0
    submission_id = req.submission_id
    log_suffix = f" key={key[:32]}" if key else ""

    try:
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    # Serialize duplicate dispatches of the same
                    # submission without blocking: contended -> 503.
                    cur.execute(
                        "SELECT pg_try_advisory_lock(hashtext(%s), %s)",
                        (_JUDGE_ASYNC_LOCK_KEY, submission_id),
                    )
                    locked_row = cur.fetchone()
                    locked = bool(locked_row and locked_row[0])
                    if not locked:
                        raise _saturated("judge already running for submission")
                    try:
                        # 3. Load submission row (running guard preserved)
                        cur.execute(
                            "SELECT id, problem_id, language, code FROM submissions "
                            "WHERE id = %s AND status = 'running'",
                            (submission_id,),
                        )
                        sub = cur.fetchone()
                        if sub is None:
                            # Idempotent replay: already terminal -> stored status.
                            cur.execute(
                                "SELECT status FROM submissions WHERE id = %s",
                                (submission_id,),
                            )
                            done = cur.fetchone()
                            if done is None:
                                raise HTTPException(
                                    status_code=404,
                                    detail="submission not found or not in running state",
                                )
                            logger.info(
                                "judge-async dedupe submission %s replay %s%s",
                                submission_id,
                                done[0],
                                log_suffix,
                            )
                            return JSONResponse(
                                status_code=200,
                                content={"status": done[0], "deduped": True},
                            )

                        _, problem_id, language, code = sub

                        # 5. Load problem metadata
                        cur.execute(
                            "SELECT time_limit_ms, memory_limit_mb FROM problems WHERE id = %s",
                            (problem_id,),
                        )
                        problem = cur.fetchone()
                        if problem is None:
                            raise HTTPException(status_code=404, detail="problem not found")

                        time_limit_ms, memory_limit_mb = problem

                        # 6. Load test cases (is_sample preserved for redaction)
                        cur.execute(
                            "SELECT input, expected_output, is_sample FROM problem_test_cases "
                            "WHERE problem_id = %s ORDER BY position",
                            (problem_id,),
                        )
                        rows = cur.fetchall()
                        total_tests = len(rows)
                    finally:
                        try:
                            cur.execute(
                                "SELECT pg_advisory_unlock(hashtext(%s), %s)",
                                (_JUDGE_ASYNC_LOCK_KEY, submission_id),
                            )
                        except Exception:  # noqa: BLE001 — unlock best-effort
                            logger.exception(
                                "judge-async unlock failed for submission %s", submission_id
                            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("judge-async error for submission %s%s", submission_id, log_suffix)
            _mark_infra_pending(
                submission_id, f"judge infra error: {exc}", total_tests,
            )
            return JSONResponse(
                status_code=503,
                content={"status": "pending", "infra_error": True},
                headers={"Retry-After": str(_JUDGE_SATURATED_RETRY_AFTER_S)},
            )

        # 7. Build JudgeRequest and execute (slot held across execution)
        cases = [
            JudgeCase(stdin=r[0], expected_stdout=r[1], is_sample=bool(r[2]))
            for r in rows
        ]
        judge_req = JudgeRequest(
            language=language,
            code=code,
            cases=cases,
            time_limit_ms=time_limit_ms,
            memory_mb=memory_limit_mb,
        )
        result = execute_judge(judge_req)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("judge-async error for submission %s%s", submission_id, log_suffix)
        _mark_infra_pending(
            submission_id, f"judge infra error: {exc}", total_tests,
        )
        return JSONResponse(
            status_code=503,
            content={"status": "pending", "infra_error": True},
            headers={"Retry-After": str(_JUDGE_SATURATED_RETRY_AFTER_S)},
        )
    finally:
        _release_judge_slot()

    if result.infra_error:
        # Infra failure is NOT a contestant runtime_error: reset to
        # pending + flag so recovery/retry can re-dispatch (parent
        # integration: see api/DEPLOYMENT_CONTRACT.md).
        _mark_infra_pending(
            submission_id, result.error_message or "judge sandbox unavailable", result.total_tests,
        )
        return JSONResponse(
            status_code=503,
            content={"status": "pending", "infra_error": True},
            headers={"Retry-After": str(_JUDGE_SATURATED_RETRY_AFTER_S)},
        )

    # 8. Update submission with verdict
    _update_submission_status(
        submission_id,
        result.status,
        result.passed_tests,
        result.total_tests,
        result.execution_time_ms,
        result.error_message,
        now,
    )

    # 9. Return 202
    return JSONResponse(status_code=202, content={"status": result.status})


def _mark_infra_pending(submission_id: int, message: str, total_tests: int) -> None:
    """Persist infra failure as retryable pending + flag (never runtime_error)."""
    _update_submission_status(
        submission_id,
        "pending",
        0,
        total_tests,
        0,
        _truncate_infra_message(message),
        None,
        infra_error=True,
    )


def _truncate_infra_message(message: str, limit: int = 2048) -> str:
    truncated = message[:limit] if len(message) > limit else message
    if "judge infra error" in truncated.lower() or "judge sandbox unavailable" in truncated.lower():
        return truncated
    return f"judge infra error: {truncated} (retryable; not contestant fault)"


def _update_submission_status(
    submission_id: int,
    status: str,
    passed_tests: int,
    total_tests: int,
    execution_time_ms: int,
    error_message: str | None,
    completed_at: datetime | None,
    infra_error: bool = False,
) -> None:
    """Best-effort update of submission verdict.

    Infra failures persist as pending + judge_infra_error=true (never a
    false contestant runtime_error). Terminal verdicts clear the flag.
    Guarded to pending/running so late verdicts cannot overwrite
    recovery or completed rows.
    """
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE submissions SET status = %s, passed_tests = %s, "
                    "total_tests = %s, execution_time_ms = %s, "
                    "error_message = %s, completed_at = %s, "
                    "judge_infra_error = %s "
                    "WHERE id = %s AND status IN ('pending', 'running')",
                    (status, passed_tests, total_tests, execution_time_ms, error_message, completed_at, infra_error, submission_id),
                )
    except Exception:
        logger.exception("Failed to update submission %s status to %s", submission_id, status)


@app.post("/judge", response_model=JudgeResponse)
def judge_endpoint(
    req: JudgeRequest,
    x_judge_secret: str | None = Header(default=None, alias="X-Judge-Secret"),
) -> JudgeResponse:
    """Internal judge endpoint — requires X-Judge-Secret header.

    Bounded by the same semaphore as /judge-async (503 + Retry-After
    when saturated). Hidden cases (is_sample=false, the default) get
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
        return execute_judge(req)
    finally:
        _release_judge_slot()
