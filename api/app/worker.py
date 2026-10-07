"""Pull and execute judging jobs from the Postgres queue."""

from __future__ import annotations

import logging
import signal
import socket
import threading
import time
import uuid
from datetime import datetime, timezone

from . import db, queue
from .config import settings
from .judge import JudgeCase, JudgeRequest, JudgeResponse, execute_judge, resolve_sandbox_backend, warm_go_cache
from .cloudrun_jobs import JobConfig, JobOutcome, run_job

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("koj.worker")


def _keep_lease_alive(
    worker_id: str,
    job: queue.ClaimedJob,
    stop: threading.Event,
    lost: threading.Event,
) -> None:
    interval = max(5, settings.JUDGE_LEASE_SECONDS // 3)
    while not stop.wait(interval):
        try:
            if not queue.heartbeat_worker(worker_id, job, settings.JUDGE_LEASE_SECONDS):
                lost.set()
                logger.warning("job lease lost job=%s attempt=%s", job.id, job.attempt)
                return
        except Exception:
            logger.exception("job heartbeat failed job=%s attempt=%s", job.id, job.attempt)


def _execute_local_submission(submission: queue.SubmissionInput) -> JudgeResponse:
    return execute_judge(
        JudgeRequest(
            language=submission.language,
            code=submission.code,
            cases=list(submission.cases),
            time_limit_ms=submission.time_limit_ms,
            memory_mb=submission.memory_limit_mb,
            output_comparator=submission.output_comparator,
            absolute_tolerance=submission.absolute_tolerance,
            relative_tolerance=submission.relative_tolerance,
            checker_code=submission.checker_code,
        ),
        lock_wait_seconds=65,
    )


def _process_job(worker_id: str, job: queue.ClaimedJob) -> None:
    heartbeat_stop = threading.Event()
    lease_lost = threading.Event()
    heartbeat = threading.Thread(
        target=_keep_lease_alive,
        args=(worker_id, job, heartbeat_stop, lease_lost),
        name=f"lease-{job.id}",
        daemon=True,
    )
    heartbeat.start()
    started = time.monotonic()
    try:
        if _uses_cloudrun_job_dispatch():
            _process_cloudrun_job(worker_id, job, lease_lost)
            return
        submission = queue.load_submission(job.submission_id)
        if submission is None:
            queue.mark_job_unavailable(worker_id, job)
            logger.warning("job no longer judgeable job=%s submission=%s", job.id, job.submission_id)
            return
        queue_wait_ms = max(
            0,
            int((datetime.now(timezone.utc) - submission.submitted_at).total_seconds() * 1000),
        )
        result = _execute_local_submission(submission)
        if lease_lost.is_set():
            return
        if result.infra_error:
            persisted = queue.retry_job(
                worker_id,
                job,
                result.error_message or "judge sandbox unavailable",
                result.total_tests,
            )
            logger.warning(
                "infrastructure failure job=%s submission=%s attempt=%s retry=%s",
                job.id,
                job.submission_id,
                job.attempt,
                persisted and job.attempt < job.max_attempts,
            )
            return
        persisted = queue.complete_job(worker_id, job, result)
        logger.info(
            "job completed job=%s submission=%s attempt=%s verdict=%s queue_wait_ms=%s duration_ms=%s persisted=%s",
            job.id,
            job.submission_id,
            job.attempt,
            result.status,
            queue_wait_ms,
            int((time.monotonic() - started) * 1000),
            persisted,
        )
    except Exception as exc:
        logger.error("job execution failed job=%s submission=%s attempt=%s error_type=%s", job.id, job.submission_id, job.attempt, type(exc).__name__)
        if not lease_lost.is_set():
            try:
                queue.retry_job(worker_id, job, "judge worker execution failed")
            except Exception:
                logger.exception("job retry persistence failed job=%s attempt=%s", job.id, job.attempt)
    finally:
        heartbeat_stop.set()
        heartbeat.join(timeout=2)


def _uses_cloudrun_job_dispatch() -> bool:
    return settings.JUDGE_SANDBOX_MODE == "cloudrun" or (
        settings.JUDGE_SANDBOX_MODE == "auto" and resolve_sandbox_backend() == "cloudrun"
    )


def _process_cloudrun_job(
    worker_id: str,
    job: queue.ClaimedJob,
    lease_lost: threading.Event,
) -> None:
    try:
        config = JobConfig.from_environment()
        outcome = run_job(config, worker_id, job)
        if outcome == JobOutcome.FAILED and not lease_lost.is_set():
            queue.retry_job(worker_id, job, "isolated judge task failed")
        elif outcome == JobOutcome.AMBIGUOUS and not lease_lost.is_set():
            queue.retry_job(worker_id, job, "isolated judge task outcome was ambiguous")
        elif outcome == JobOutcome.SUCCEEDED:
            queue.heartbeat_worker(worker_id, None, settings.JUDGE_LEASE_SECONDS)
    except Exception:
        logger.exception("Cloud Run job dispatch failed job=%s attempt=%s", job.id, job.attempt)
        if not lease_lost.is_set():
            try:
                queue.retry_job(worker_id, job, "isolated judge task dispatch failed")
            except Exception:
                logger.exception("Cloud Run dispatch retry persistence failed job=%s", job.id)


def run() -> None:
    if not settings.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
    db.init_pool()
    worker_id = f"{socket.gethostname()}-{uuid.uuid4().hex[:12]}"
    stop = threading.Event()

    def request_stop(signum: int, _frame: object) -> None:
        logger.info("worker stopping signal=%s worker=%s", signum, worker_id)
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    queue.register_worker(worker_id, socket.gethostname())
    if not _uses_cloudrun_job_dispatch():
        warm_go_cache()
    logger.info("worker ready id=%s sandbox=%s", worker_id, settings.JUDGE_SANDBOX_MODE)

    try:
        while not stop.is_set():
            try:
                queue.finalize_exhausted_jobs()
                job = queue.claim_job(worker_id, settings.JUDGE_LEASE_SECONDS)
            except Exception:
                logger.exception("queue poll failed worker=%s", worker_id)
                stop.wait(settings.JUDGE_WORKER_POLL_SECONDS)
                continue
            if job is None:
                stop.wait(settings.JUDGE_WORKER_POLL_SECONDS)
                continue
            _process_job(worker_id, job)
    finally:
        queue.mark_worker_stopping(worker_id)
        db.close_pool()


if __name__ == "__main__":
    run()
