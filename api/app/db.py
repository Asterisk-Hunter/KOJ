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
        # Neon free tier suspends/kills idle connections (~500 s).
        # Recycle well inside that window.
        max_lifetime=300,  # 5 min — close & replace before Neon's idle-kill
        max_idle=120,  # 2 min — reap idle pool conns before Neon can kill them
        # Validate on checkout: pool discards dead sockets and retries
        # automatically via _getconn_with_check_loop.
        check=ConnectionPool.check_connection,
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


def _acquire_conn() -> psycopg.Connection:
    """Get a pool connection, retrying once if the first is dead.

    The pool's ``check`` callback (set in init_pool) already validates each
    connection on checkout via ``ConnectionPool.check_connection``.  This
    extra probe catches the narrow race where the socket dies *between*
    the pool checkout and the caller's first real query (e.g. Neon kills
    the connection at the exact moment the pool hands it out).
    """
    assert _pool is not None
    conn = _pool.getconn()
    try:
        conn.execute("")  # lightweight liveness probe (empty query)
    except psycopg.OperationalError:
        logger.warning("Dead connection on checkout; retrying once")
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
        conn = _pool.getconn()
    return conn


def _release_conn(conn: psycopg.Connection) -> None:
    """Return a connection to the pool, falling back to close on error."""
    if _pool is None:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
        return
    try:
        _pool.putconn(conn)
    except Exception:  # noqa: BLE001
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


@contextmanager
def get_connection() -> Generator[psycopg.Connection, None, None]:
    """Yield a pooled connection (lazily initing the pool if needed).

    Lifespan normally inits the pool; the lazy path preserves old
    behavior for scripts that import db without running the app.
    Connections are autocommit; the pool reclaims them on exit.

    Acquisition validates the connection with a liveness probe and
    retries once with a fresh connection on OperationalError (Neon
    idle-kill).
    """
    global _pool
    if _pool is None:
        try:
            init_pool()
        except Exception:
            logger.exception("Pool init failed; falling back to short-lived connection")
            _pool = None
    if _pool is not None:
        conn = _acquire_conn()
        try:
            yield conn
        finally:
            _release_conn(conn)
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
