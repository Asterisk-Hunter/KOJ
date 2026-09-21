"""FastAPI entrypoint for the KOJ API service."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import db
from .config import settings
from .judge import SUPPORTED_LANGUAGES, JudgeCase, JudgeRequest, JudgeResponse, execute_judge

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


@app.get("/metrics")
def metrics() -> dict[str, object]:
    """Judge service liveness and runtime metrics."""
    db_ok = db.ping()
    return {
        "status": "ok" if db_ok else "degraded",
        "service": "koj-judge",
        "supported_languages": list(SUPPORTED_LANGUAGES),
        "db": db_ok,
    }


class JudgeAsyncRequest(BaseModel):
    submission_id: int
    sample_only: bool = False


@app.post("/judge-async")
def judge_async_endpoint(
    req: JudgeAsyncRequest,
    x_judge_secret: str | None = Header(default=None, alias="X-Judge-Secret"),
) -> JSONResponse:
    """Async judge: fetch submission from DB, judge, write verdict back."""
    if not settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="judge secret not configured")
    if x_judge_secret != settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")

    now = datetime.now(timezone.utc)
    total_tests = 0

    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                # 3. Load submission row
                cur.execute(
                    "SELECT id, problem_id, language, code FROM submissions "
                    "WHERE id = %s AND status = 'running'",
                    (req.submission_id,),
                )
                sub = cur.fetchone()
                if sub is None:
                    raise HTTPException(status_code=404, detail="submission not found or not in running state")

                submission_id, problem_id, language, code = sub

                # 5. Load problem metadata
                cur.execute(
                    "SELECT time_limit_ms, memory_limit_mb FROM problems WHERE id = %s",
                    (problem_id,),
                )
                problem = cur.fetchone()
                if problem is None:
                    raise HTTPException(status_code=404, detail="problem not found")

                time_limit_ms, memory_limit_mb = problem

                # 6. Load test cases (support sample_only for fast sample runs)
                test_sql = (
                    "SELECT input, expected_output FROM problem_test_cases "
                    "WHERE problem_id = %s AND is_sample = true ORDER BY position"
                    if req.sample_only
                    else
                    "SELECT input, expected_output FROM problem_test_cases "
                    "WHERE problem_id = %s ORDER BY position"
                )
                cur.execute(test_sql, (problem_id,))
                rows = cur.fetchall()
                if req.sample_only and len(rows) == 0:
                    cur.execute(
                        "SELECT input, expected_output FROM problem_test_cases "
                        "WHERE problem_id = %s ORDER BY position",
                        (problem_id,),
                    )
                    rows = cur.fetchall()
                total_tests = len(rows)

        # 7. Build JudgeRequest and execute
        cases = [JudgeCase(stdin=r[0], expected_stdout=r[1]) for r in rows]
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
        logger.exception("judge-async error for submission %s", req.submission_id)
        _update_submission_status(
            req.submission_id, "runtime_error", 0, total_tests,
            0, 0, str(exc), now,
        )
        return JSONResponse(status_code=502, content={"status": "runtime_error"})

    # 8. Update submission with verdict
    _update_submission_status(
        req.submission_id,
        result.status,
        result.passed_tests,
        result.total_tests,
        result.execution_time_ms,
        result.memory_used_mb,
        result.error_message,
        now,
    )

    # 9. Return 202
    return JSONResponse(status_code=202, content={"status": result.status})


def _update_submission_status(
    submission_id: int,
    status: str,
    passed_tests: int,
    total_tests: int,
    execution_time_ms: int,
    memory_used_mb: int,
    error_message: str | None,
    completed_at: datetime,
) -> None:
    """Best-effort update of submission verdict."""
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE submissions SET status = %s, passed_tests = %s, "
                    "total_tests = %s, execution_time_ms = %s, memory_used_mb = %s, "
                    "error_message = %s, completed_at = %s WHERE id = %s",
                    (status, passed_tests, total_tests, execution_time_ms, memory_used_mb, error_message, completed_at, submission_id),
                )
    except Exception:
        logger.exception("Failed to update submission %s status to %s", submission_id, status)



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
    if req.language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=422,
            detail=f"supported languages: {', '.join(SUPPORTED_LANGUAGES)}",
        )
    return execute_judge(req)
