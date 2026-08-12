"""Postgres connection helpers built on psycopg 3."""

from __future__ import annotations

import logging
from collections.abc import Generator
from contextlib import contextmanager

import psycopg

from .config import settings

logger = logging.getLogger(__name__)


@contextmanager
def get_connection() -> Generator[psycopg.Connection, None, None]:
    """Yield a short-lived psycopg connection and always close it.

    The DSN comes from `settings.DATABASE_URL` and is handed to psycopg
    as a plain string. We `autocommit` so callers don't need to remember
    to commit short read-only queries, and we `close()` in `finally`
    so a failed query still returns the connection to the pool/closes
    the socket.
    """
    dsn: str = str(settings.DATABASE_URL)
    conn = psycopg.connect(dsn, autocommit=True)
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001 — best-effort close, never raise
            logger.exception("Failed to close psycopg connection cleanly")


def ping() -> bool:
    """Open a connection, run `SELECT 1`, and report success.

    Designed for `/health`: it MUST swallow all exceptions so a
    database outage degrades the endpoint instead of 500-ing.
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                row = cur.fetchone()
                return row is not None and row[0] == 1
    except Exception:  # noqa: BLE001 — health probe must never raise
        logger.exception("Database ping failed")
        return False
