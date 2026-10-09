"""Run exactly one fenced queue attempt inside a Cloud Run Job task."""

from __future__ import annotations

import logging
import re
import sys
import threading

from . import db, queue
from .config import settings
from .sandbox_probe import run_boundary_probe
from .worker import _execute_local_submission

logger = logging.getLogger("koj.onejobrunner")
_WORKER_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


def _keep_lease_alive(worker_id: str, job: queue.ClaimedJob, stop: threading.Event, lost: threading.Event) -> None:
    interval = max(5, settings.JUDGE_LEASE_SECONDS // 3)
    while not stop.wait(interval):
        try:
            if not queue.heartbeat_worker(worker_id, job, settings.JUDGE_LEASE_SECONDS):
                lost.set()
                return
        except Exception:
            logger.exception("Cloud Run task lease heartbeat failed job=%s attempt=%s", job.id, job.attempt)


def _is_current_lease(worker_id: str, job: queue.ClaimedJob) -> bool:
    with db.get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM judge_jobs WHERE id = %s AND submission_id = %s "
                "AND status = 'leased' AND leased_by = %s AND attempts = %s "
                "AND max_attempts = %s AND lease_expires_at > NOW()",
                (job.id, job.submission_id, worker_id, job.attempt, job.max_attempts),
            )
            return cursor.fetchone() is not None


def run(arguments: list[str]) -> int:
    if len(arguments) != 5:
        return 2
    try:
        job_id, submission_id, attempt, max_attempts = (int(value) for value in arguments[:4])
        worker_id = arguments[4]
        if min(job_id, submission_id, attempt) <= 0 or max_attempts < attempt or not _WORKER_ID_RE.fullmatch(worker_id):
            return 2
    except ValueError:
        return 2
    if not settings.DATABASE_URL or settings.JUDGE_SANDBOX_MODE != "cloudrun":
        return 2

    job = queue.ClaimedJob(job_id, submission_id, attempt, max_attempts)
    db.init_pool()
    heartbeat_stop = threading.Event()
    lease_lost = threading.Event()
    heartbeat = threading.Thread(
        target=_keep_lease_alive,
        args=(worker_id, job, heartbeat_stop, lease_lost),
        name=f"task-lease-{job.id}",
        daemon=True,
    )
    heartbeat.start()
    try:
        run_boundary_probe()
        if lease_lost.is_set() or not _is_current_lease(worker_id, job):
            logger.info("stale Cloud Run task ignored job=%s attempt=%s", job.id, job.attempt)
            return 0
        submission = queue.load_submission(job.submission_id)
        if submission is None:
            queue.mark_job_unavailable(worker_id, job)
            return 0
        result = _execute_local_submission(submission)
        heartbeat_stop.set()
        heartbeat.join(timeout=2)
        if lease_lost.is_set():
            return 1
        if result.infra_error:
            logger.error("Cloud Run judge infrastructure failure job=%s attempt=%s", job.id, job.attempt)
            return 1
        if not queue.complete_job(worker_id, job, result):
            logger.warning("stale Cloud Run result discarded job=%s attempt=%s", job.id, job.attempt)
            return 1
        logger.info("Cloud Run judge task completed job=%s attempt=%s verdict=%s", job.id, job.attempt, result.status)
        return 0
    except Exception:
        logger.exception("one-job Cloud Run task failed job=%s attempt=%s", job.id, job.attempt)
        return 1
    finally:
        heartbeat_stop.set()
        heartbeat.join(timeout=2)
        db.close_pool()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    raise SystemExit(run(sys.argv[1:]))
