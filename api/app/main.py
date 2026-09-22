"""FastAPI entrypoint for the KOJ API service."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import cache, db
from .config import settings
from .judge import SUPPORTED_LANGUAGES, JudgeCase, JudgeRequest, JudgeResponse, execute_judge

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("koj.api")

_start_time = time.monotonic()

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
    result: dict[str, object] = {
        "status": "ok" if db_ok else "degraded",
        "service": "koj-judge",
        "uptime_s": int(time.monotonic() - _start_time),
        "supported_languages": list(SUPPORTED_LANGUAGES),
        "db": db_ok,
    }
    if db_ok:
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    since = datetime.now(timezone.utc).timestamp() - 86400
                    cur.execute(
                        "SELECT status, count(*)::int AS cnt "
                        "FROM submissions WHERE submitted_at >= to_timestamp(%s) "
                        "GROUP BY status",
                        (since,),
                    )
                    result["verdicts_24h"] = {row[0]: row[1] for row in cur.fetchall()}
                    cur.execute(
                        "SELECT COALESCE(AVG(execution_time_ms), 0)::int "
                        "FROM submissions "
                        "WHERE status NOT IN ('pending','running') "
                        "AND submitted_at >= to_timestamp(%s)",
                        (since,),
                    )
                    avg_row = cur.fetchone()
                    result["avg_latency_ms_24h"] = avg_row[0] if avg_row else 0
        except Exception:  # noqa: BLE001
            logger.debug("metrics query failed", exc_info=True)
    return result


class JudgeAsyncRequest(BaseModel):
    submission_id: int
    sample_only: bool = False


def _process_async_judge(submission_id: int, sample_only: bool) -> None:
    """Background worker task to execute judging and persist verdict."""
    now = datetime.now(timezone.utc)
    total_tests = 0

    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                # 3. Load submission row
                cur.execute(
                    "SELECT id, problem_id, language, code FROM submissions "
                    "WHERE id = %s AND status = 'running'",
                    (submission_id,),
                )
                sub = cur.fetchone()
                if sub is None:
                    return

                _, problem_id, language, code = sub

                # 5. Load problem metadata
                cur.execute(
                    "SELECT time_limit_ms, memory_limit_mb FROM problems WHERE id = %s",
                    (problem_id,),
                )
                problem = cur.fetchone()
                if problem is None:
                    _update_submission_status(
                        submission_id, "runtime_error", 0, 0,
                        0, 0, "problem not found", now,
                    )
                    return

                time_limit_ms, memory_limit_mb = problem

                # 6. Load test cases (support sample_only for fast sample runs)
                test_sql = (
                    "SELECT input, expected_output FROM problem_test_cases "
                    "WHERE problem_id = %s AND is_sample = true ORDER BY position"
                    if sample_only
                    else
                    "SELECT input, expected_output FROM problem_test_cases "
                    "WHERE problem_id = %s ORDER BY position"
                )
                cur.execute(test_sql, (problem_id,))
                rows = cur.fetchall()
                if sample_only and len(rows) == 0:
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

        # 8. Update submission with verdict
        case_results = [
            {
                "index": c.index,
                "passed": c.passed,
                "verdict": c.verdict,
                "runtime_ms": c.runtime_ms,
                "stdout": c.stdout[:2048],
                "stderr": c.stderr[:2048],
            }
            for c in result.cases[:100]
        ]

        _update_submission_status(
            submission_id,
            result.status,
            result.passed_tests,
            result.total_tests,
            result.execution_time_ms,
            result.memory_used_mb,
            result.error_message,
            now,
            case_results=case_results,
        )

        # 9. Structured JSON log line (one per execution)
        logger.info(
            json.dumps({
                "event": "judge_complete",
                "submission_id": submission_id,
                "language": language,
                "verdict": result.status,
                "passed": result.passed_tests,
                "total": result.total_tests,
                "execution_time_ms": result.execution_time_ms,
                "memory_used_mb": result.memory_used_mb,
            })
        )

        # 10. Publish verdict to Redis for SSE endpoints (best-effort)
        cache.publish_verdict(submission_id, {
            "status": result.status,
            "passed_tests": result.passed_tests,
            "total_tests": result.total_tests,
            "execution_time_ms": result.execution_time_ms,
            "memory_used_mb": result.memory_used_mb,
            "error_message": result.error_message,
        })

    except Exception as exc:
        logger.exception("judge-async error for submission %s", submission_id)
        logger.info(
            json.dumps({
                "event": "judge_error",
                "submission_id": submission_id,
                "error": str(exc)[:500],
            })
        )
        _update_submission_status(
            submission_id, "runtime_error", 0, total_tests,
            0, 0, str(exc), now,
        )


@app.post("/judge-async")
def judge_async_endpoint(
    req: JudgeAsyncRequest,
    background_tasks: BackgroundTasks,
    x_judge_secret: str | None = Header(default=None, alias="X-Judge-Secret"),
) -> JSONResponse:
    """Async judge: dispatch background evaluation, return 202 immediately."""
    if not settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="judge secret not configured")
    if x_judge_secret != settings.JUDGE_INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")

    background_tasks.add_task(_process_async_judge, req.submission_id, req.sample_only)
    return JSONResponse(status_code=202, content={"status": "running", "queued": True})


def _update_submission_status(
    submission_id: int,
    status: str,
    passed_tests: int,
    total_tests: int,
    execution_time_ms: int,
    memory_used_mb: int,
    error_message: str | None,
    completed_at: datetime,
    case_results: list[dict] | None = None,
) -> None:
    """Best-effort update of submission verdict."""
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE submissions SET status = %s, passed_tests = %s, "
                    "total_tests = %s, execution_time_ms = %s, memory_used_mb = %s, "
                    "error_message = %s, completed_at = %s, case_results = %s WHERE id = %s",
                    (status, passed_tests, total_tests, execution_time_ms, memory_used_mb, error_message, completed_at, json.dumps(case_results) if case_results is not None else None, submission_id),
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
