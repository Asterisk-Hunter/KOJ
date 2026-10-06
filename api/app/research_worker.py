"""Research-only queue consumer for the isolated Docker worker."""

from __future__ import annotations

import logging
import signal
import socket
import threading

from . import db, research
from .config import settings
from .judge import resolve_sandbox_backend
from .worker import _process_research_sample

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("koj.research-worker")


def run() -> None:
    if not settings.TRAINING_WORKER_ENABLED:
        raise RuntimeError("research worker is disabled")
    if settings.JUDGE_SANDBOX_MODE != "docker" or resolve_sandbox_backend() != "docker":
        raise RuntimeError("research judging requires the Docker sandbox")
    if not settings.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")

    db.init_pool()
    worker_id = f"{socket.gethostname()}-research"
    stop = threading.Event()

    def request_stop(signum: int, _frame: object) -> None:
        logger.info("research worker stopping signal=%s worker=%s", signum, worker_id)
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    logger.info("research worker ready id=%s sandbox=docker", worker_id)

    try:
        while not stop.is_set():
            try:
                sample = research.claim_sample(worker_id, settings.TRAINING_LEASE_SECONDS)
            except Exception:
                logger.exception("research queue poll failed worker=%s", worker_id)
                stop.wait(settings.JUDGE_WORKER_POLL_SECONDS)
                continue
            if sample is None:
                stop.wait(settings.JUDGE_WORKER_POLL_SECONDS)
                continue
            _process_research_sample(worker_id, sample)
    finally:
        db.close_pool()


if __name__ == "__main__":
    run()
