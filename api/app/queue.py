"""Postgres-backed judging queue with expiring worker leases."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from . import db
from .config import settings
from .judge import CaseResult, JudgeCase, JudgeResponse

logger = logging.getLogger("koj.queue")


@dataclass(frozen=True)
class ClaimedJob:
    id: int
    submission_id: int
    attempt: int
    max_attempts: int


@dataclass(frozen=True)
class SubmissionInput:
    submission_id: int
    problem_id: int
    language: str
    code: str
    mode: str
    time_limit_ms: int
    memory_limit_mb: int
    output_comparator: str
    absolute_tolerance: float
    relative_tolerance: float
    checker_code: str | None
    submitted_at: datetime
    cases: tuple[JudgeCase, ...]


def retry_delay_seconds(attempt: int) -> int:
    exponent = min(max(0, attempt - 1), 6)
    return min(5 * (2**exponent), 300)


def register_worker(worker_id: str, hostname: str) -> None:
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO judge_workers (id, hostname, status, started_at, last_seen_at, stopped_at) "
                "VALUES (%s, %s, 'idle', NOW(), NOW(), NULL) "
                "ON CONFLICT (id) DO UPDATE SET hostname = EXCLUDED.hostname, "
                "status = 'idle', active_job_id = NULL, started_at = NOW(), "
                "last_seen_at = NOW(), stopped_at = NULL",
                (worker_id, hostname),
            )


def heartbeat_worker(
    worker_id: str,
    job: ClaimedJob | None,
    lease_seconds: int,
) -> bool:
    with db.get_connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                if job is not None:
                    cur.execute(
                        "UPDATE judge_jobs SET lease_expires_at = NOW() + (%s * INTERVAL '1 second'), "
                        "heartbeat_at = NOW(), updated_at = NOW() "
                        "WHERE id = %s AND status = 'leased' AND leased_by = %s "
                        "AND attempts = %s AND lease_expires_at > NOW() RETURNING id",
                        (lease_seconds, job.id, worker_id, job.attempt),
                    )
                    if cur.fetchone() is None:
                        return False
                cur.execute(
                    "UPDATE judge_workers SET status = %s, active_job_id = %s, "
                    "last_job_id = COALESCE(%s, last_job_id), last_seen_at = NOW() "
                    "WHERE id = %s",
                    (
                        "busy" if job is not None else "idle",
                        job.id if job is not None else None,
                        job.id if job is not None else None,
                        worker_id,
                    ),
                )
    return True


def mark_worker_stopping(worker_id: str) -> None:
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE judge_workers SET status = 'stopping', active_job_id = NULL, "
                    "last_seen_at = NOW(), stopped_at = NOW() WHERE id = %s",
                    (worker_id,),
                )
    except Exception:
        logger.exception("worker shutdown update failed worker=%s", worker_id)


def claim_job(worker_id: str, lease_seconds: int) -> ClaimedJob | None:
    with db.get_connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "WITH candidate AS ("
                    "  SELECT id FROM judge_jobs "
                    "  WHERE attempts < max_attempts AND ("
                    "    (status = 'queued' AND available_at <= NOW()) OR "
                    "    (status = 'leased' AND lease_expires_at <= NOW())"
                    "  ) "
                    "  ORDER BY CASE WHEN status = 'queued' THEN available_at ELSE lease_expires_at END, created_at "
                    "  FOR UPDATE SKIP LOCKED LIMIT 1"
                    ") "
                    "UPDATE judge_jobs AS job SET status = 'leased', attempts = job.attempts + 1, "
                    "leased_by = %s, lease_expires_at = NOW() + (%s * INTERVAL '1 second'), "
                    "heartbeat_at = NOW(), updated_at = NOW() "
                    "FROM candidate WHERE job.id = candidate.id "
                    "RETURNING job.id, job.submission_id, job.attempts, job.max_attempts",
                    (worker_id, lease_seconds),
                )
                row = cur.fetchone()
                if row is None:
                    cur.execute(
                        "UPDATE judge_workers SET status = 'idle', active_job_id = NULL, "
                        "last_seen_at = NOW() WHERE id = %s",
                        (worker_id,),
                    )
                    return None
                job = ClaimedJob(id=row[0], submission_id=row[1], attempt=row[2], max_attempts=row[3])
                cur.execute(
                    "UPDATE submissions SET status = 'running', started_at = COALESCE(started_at, NOW()), "
                    "judge_infra_error = false, error_message = NULL "
                    "WHERE id = %s AND status = 'pending'",
                    (job.submission_id,),
                )
                cur.execute(
                    "UPDATE judge_workers SET status = 'busy', active_job_id = %s, "
                    "last_job_id = %s, last_seen_at = NOW() WHERE id = %s",
                    (job.id, job.id, worker_id),
                )
                return job


def load_submission(submission_id: int) -> SubmissionInput | None:
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT s.problem_id, s.language, s.code, s.mode, p.time_limit_ms, "
                "p.memory_limit_mb, p.output_comparator, p.absolute_tolerance, "
                "p.relative_tolerance, p.checker_code, s.submitted_at "
                "FROM submissions AS s JOIN problems AS p ON p.id = s.problem_id "
                "WHERE s.id = %s AND s.status IN ('pending', 'running')",
                (submission_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            (
                problem_id,
                language,
                code,
                mode,
                time_limit_ms,
                memory_limit_mb,
                output_comparator,
                absolute_tolerance,
                relative_tolerance,
                checker_code,
                submitted_at,
            ) = row
            cur.execute(
                "SELECT input, expected_output, is_sample FROM problem_test_cases "
                "WHERE problem_id = %s AND (%s = 'submit' OR is_sample = true) "
                "ORDER BY position",
                (problem_id, mode),
            )
            cases = tuple(
                JudgeCase(stdin=case[0], expected_stdout=case[1], is_sample=bool(case[2]))
                for case in cur.fetchall()
            )
    return SubmissionInput(
        submission_id=submission_id,
        problem_id=problem_id,
        language=language,
        code=code,
        mode=mode,
        time_limit_ms=time_limit_ms,
        memory_limit_mb=memory_limit_mb,
        output_comparator=output_comparator,
        absolute_tolerance=absolute_tolerance,
        relative_tolerance=relative_tolerance,
        checker_code=checker_code,
        submitted_at=submitted_at,
        cases=cases,
    )


def _serialize_cases(cases: list[CaseResult]) -> str:
    return json.dumps(
        [
            {
                "index": case.index,
                "passed": case.passed,
                "verdict": case.verdict,
                "runtime_ms": case.runtime_ms,
                "stdout": case.stdout[:2048],
                "stderr": case.stderr[:2048],
            }
            for case in cases[:100]
        ]
    )


def complete_job(worker_id: str, job: ClaimedJob, result: JudgeResponse) -> bool:
    now = datetime.now(timezone.utc)
    cases = _serialize_cases(result.cases or [])
    with db.get_connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE judge_jobs SET status = 'completed', leased_by = NULL, "
                    "lease_expires_at = NULL, completed_at = NOW(), updated_at = NOW(), last_error = NULL "
                    "WHERE id = %s AND status = 'leased' AND leased_by = %s AND attempts = %s "
                    "AND lease_expires_at > NOW() RETURNING submission_id",
                    (job.id, worker_id, job.attempt),
                )
                row = cur.fetchone()
                if row is None:
                    return False
                cur.execute(
                    "UPDATE submissions SET status = %s, passed_tests = %s, total_tests = %s, "
                    "execution_time_ms = %s, error_message = %s, completed_at = %s, "
                    "judge_infra_error = false, case_results = %s::jsonb "
                    "WHERE id = %s AND status IN ('pending', 'running')",
                    (
                        result.status,
                        result.passed_tests,
                        result.total_tests,
                        result.execution_time_ms,
                        result.error_message,
                        now,
                        cases,
                        job.submission_id,
                    ),
                )
                cur.execute(
                    "UPDATE judge_workers SET status = 'idle', active_job_id = NULL, "
                    "last_seen_at = NOW() WHERE id = %s",
                    (worker_id,),
                )
    return True


def retry_job(worker_id: str, job: ClaimedJob, message: str, total_tests: int = 0) -> bool:
    safe_message = message[:2048]
    should_retry = job.attempt < job.max_attempts
    delay_seconds = retry_delay_seconds(job.attempt)
    next_status = "queued" if should_retry else "dead"
    with db.get_connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE judge_jobs SET status = %s, available_at = NOW() + (%s * INTERVAL '1 second'), "
                    "leased_by = NULL, lease_expires_at = NULL, completed_at = %s, last_error = %s, "
                    "updated_at = NOW() WHERE id = %s AND status = 'leased' AND leased_by = %s "
                    "AND attempts = %s AND lease_expires_at > NOW() RETURNING submission_id",
                    (
                        next_status,
                        delay_seconds,
                        None if should_retry else datetime.now(timezone.utc),
                        safe_message,
                        job.id,
                        worker_id,
                        job.attempt,
                    ),
                )
                row = cur.fetchone()
                if row is None:
                    return False
                submission_status = "pending" if should_retry else "runtime_error"
                cur.execute(
                    "UPDATE submissions SET status = %s, passed_tests = 0, total_tests = %s, "
                    "execution_time_ms = 0, error_message = %s, completed_at = %s, "
                    "judge_infra_error = true "
                    "WHERE id = %s AND status IN ('pending', 'running')",
                    (
                        submission_status,
                        total_tests,
                        safe_message,
                        None if should_retry else datetime.now(timezone.utc),
                        job.submission_id,
                    ),
                )
                cur.execute(
                    "UPDATE judge_workers SET status = 'idle', active_job_id = NULL, "
                    "last_seen_at = NOW() WHERE id = %s",
                    (worker_id,),
                )
    return True


def mark_job_unavailable(worker_id: str, job: ClaimedJob) -> None:
    with db.get_connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE judge_jobs SET status = 'dead', leased_by = NULL, lease_expires_at = NULL, "
                    "completed_at = NOW(), updated_at = NOW(), last_error = 'submission is no longer judgeable' "
                    "WHERE id = %s AND status = 'leased' AND leased_by = %s AND attempts = %s "
                    "AND lease_expires_at > NOW()",
                    (job.id, worker_id, job.attempt),
                )
                cur.execute(
                    "UPDATE judge_workers SET status = 'idle', active_job_id = NULL, "
                    "last_seen_at = NOW() WHERE id = %s",
                    (worker_id,),
                )


def finalize_exhausted_jobs() -> int:
    with db.get_connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "WITH exhausted AS ("
                    "  UPDATE judge_jobs SET status = 'dead', leased_by = NULL, lease_expires_at = NULL, "
                    "  completed_at = NOW(), updated_at = NOW(), "
                    "  last_error = COALESCE(last_error, 'judge worker lease expired after final attempt') "
                    "  WHERE attempts >= max_attempts AND ("
                    "    (status = 'queued' AND available_at <= NOW()) OR "
                    "    (status = 'leased' AND lease_expires_at <= NOW())"
                    "  ) RETURNING submission_id, last_error"
                    ") "
                    "UPDATE submissions AS submission SET status = 'runtime_error', "
                    "error_message = exhausted.last_error, judge_infra_error = true, completed_at = NOW() "
                    "FROM exhausted WHERE submission.id = exhausted.submission_id "
                    "AND submission.status IN ('pending', 'running') RETURNING submission.id"
                )
                return len(cur.fetchall())
