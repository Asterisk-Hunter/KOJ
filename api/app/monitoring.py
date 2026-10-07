"""Database-backed health checks used by external monitoring probes."""

from __future__ import annotations

import logging

from . import db

logger = logging.getLogger("koj.monitoring")
WORKER_STALE_SECONDS = 180
QUEUE_STALE_SECONDS = 300


def judge_health() -> bool:
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT "
                    "EXISTS (SELECT 1 FROM judge_workers "
                    "WHERE status IN ('idle', 'busy') "
                    "AND last_seen_at >= NOW() - (%s * INTERVAL '1 second')), "
                    "NOT EXISTS (SELECT 1 FROM judge_jobs "
                    "WHERE status = 'queued' AND available_at <= NOW() "
                    "AND available_at < NOW() - (%s * INTERVAL '1 second'))",
                    (WORKER_STALE_SECONDS, QUEUE_STALE_SECONDS),
                )
                row = cur.fetchone()
                return row is not None and bool(row[0]) and bool(row[1])
    except Exception:
        logger.exception("judge health probe failed")
        return False
