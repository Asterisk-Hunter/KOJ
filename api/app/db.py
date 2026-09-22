"""Postgres connection helpers built on psycopg 3 + shared pool."""

from __future__ import annotations

import logging
from collections.abc import Generator
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool

from .config import settings

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None


def init_pool() -> None:
    """Create the shared pool and verify readiness with `SELECT 1`.

    Called once from the FastAPI lifespan. Raises if the DSN is bad or
    the database is unreachable so deploy misconfiguration surfaces fast.
    """
    global _pool
    if _pool is not None:
        return
    dsn: str = str(settings.DATABASE_URL)
    pool = ConnectionPool(
        conninfo=dsn,
        min_size=1,
        max_size=10,
        kwargs={"autocommit": True},
        timeout=5.0,
        open=True,
    )
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
    _pool = pool


def close_pool() -> None:
    """Close the shared pool. Called once from the FastAPI lifespan."""
    global _pool
    if _pool is not None:
        try:
            _pool.close()
        except Exception:  # noqa: BLE001 — best-effort close on shutdown
            logger.exception("Failed to close psycopg pool cleanly")
        finally:
            _pool = None


@contextmanager
def get_connection() -> Generator[psycopg.Connection, None, None]:
    """Yield a pooled connection (lazily initing the pool if needed).

    Lifespan normally inits the pool; the lazy path preserves old
    behavior for scripts that import db without running the app.
    Connections are autocommit; the pool reclaims them on exit.
    """
    global _pool
    if _pool is None:
        try:
            init_pool()
        except Exception:
            logger.exception("Pool init failed; falling back to short-lived connection")
            _pool = None
    if _pool is not None:
        with _pool.connection() as conn:
            yield conn
        return
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
