"""Hermetic coverage for the psycopg pool wrappers in `app.db`."""

from __future__ import annotations

import psycopg
import pytest

from app import db
from app.config import settings


class _Cursor:
    def __init__(self, row=None):
        self.row = row
        self.queries = []

    def execute(self, query, params=()):
        self.queries.append((query, params))

    def fetchone(self):
        return self.row

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Connection:
    def __init__(self, row=None, probe_failures=0):
        self.cursor_obj = _Cursor(row)
        self.probe_failures = probe_failures
        self.probes = 0
        self.closed = False

    def execute(self, _query):
        self.probes += 1
        if self.probes <= self.probe_failures:
            raise psycopg.OperationalError("dead socket")

    def cursor(self):
        return self.cursor_obj

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Pool:
    def __init__(self, connections=(), putconn_error=None):
        self.connections = list(connections)
        self.putconn_error = putconn_error
        self.checkouts = []
        self.returned = []

    def getconn(self):
        conn = self.connections.pop(0)
        self.checkouts.append(conn)
        return conn

    def putconn(self, conn):
        if self.putconn_error is not None:
            raise self.putconn_error
        self.returned.append(conn)


def test_tls_kwargs_switches_between_verify_full_and_plain(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_TLS_VERIFY", True)
    assert db._tls_kwargs() == {
        "sslmode": "verify-full",
        "sslrootcert": "/etc/ssl/certs/ca-certificates.crt",
    }

    monkeypatch.setattr(settings, "DATABASE_TLS_VERIFY", False)
    assert db._tls_kwargs() == {}


def test_init_pool_probes_readiness_and_reuses_the_pool(monkeypatch):
    conn = _Connection()
    captured = {}

    class Pool:
        check_connection = staticmethod(lambda _conn: True)

        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.conn = conn

        def connection(self):
            return conn

    monkeypatch.setattr(db, "ConnectionPool", Pool)
    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(settings, "DATABASE_TLS_VERIFY", False)
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://user:pw@db/koj")

    db.init_pool()
    assert db._pool is not None
    assert conn.cursor_obj.queries == [("SELECT 1", ())]
    assert captured["min_size"] == 1 and captured["max_size"] == 10
    assert captured["check"] is Pool.check_connection

    db.init_pool()
    assert db._pool is not None


def test_init_pool_does_not_cache_a_pool_that_fails_readiness(monkeypatch):
    class Pool:
        check_connection = staticmethod(lambda _conn: True)

        def __init__(self, **_kwargs):
            pass

        def connection(self):
            raise psycopg.OperationalError("no route to host")

    monkeypatch.setattr(db, "ConnectionPool", Pool)
    monkeypatch.setattr(db, "_pool", None)

    with pytest.raises(psycopg.OperationalError):
        db.init_pool()
    assert db._pool is None


def test_close_pool_is_best_effort(monkeypatch):
    class Pool:
        def close(self):
            raise RuntimeError("pool already gone")

    monkeypatch.setattr(db, "_pool", Pool())
    db.close_pool()
    assert db._pool is None

    db.close_pool()
    assert db._pool is None


def test_acquire_conn_retries_once_when_the_socket_died(monkeypatch):
    dead = _Connection(probe_failures=1)
    healthy = _Connection()
    monkeypatch.setattr(db, "_pool", _Pool([dead, healthy]))

    assert db._acquire_conn() is healthy
    assert dead.closed is True
    assert db._pool.checkouts == [dead, healthy]


def test_release_conn_returns_to_pool_and_closes_on_failure(monkeypatch):
    pool = _Pool()
    monkeypatch.setattr(db, "_pool", pool)
    conn = _Connection()
    db._release_conn(conn)
    assert pool.returned == [conn]

    monkeypatch.setattr(db, "_pool", _Pool(putconn_error=RuntimeError("pool closed")))
    fallback = _Connection()
    db._release_conn(fallback)
    assert fallback.closed is True

    monkeypatch.setattr(db, "_pool", None)
    orphan = _Connection()
    db._release_conn(orphan)
    assert orphan.closed is True


def test_get_connection_uses_the_pool_and_releases_it(monkeypatch):
    conn = _Connection()
    pool = _Pool()
    monkeypatch.setattr(db, "_pool", pool)
    monkeypatch.setattr(pool, "getconn", lambda: conn)

    with db.get_connection() as yielded:
        assert yielded is conn
    assert pool.returned == [conn]


def test_get_connection_falls_back_to_a_short_lived_connection(monkeypatch):
    conn = _Connection()
    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(db, "init_pool", lambda: (_ for _ in ()).throw(RuntimeError("dsn rejected")))
    monkeypatch.setattr(db.psycopg, "connect", lambda *_args, **_kwargs: conn)

    with db.get_connection() as yielded:
        assert yielded is conn
    assert conn.closed is True


def test_get_connection_swallows_a_failing_close_on_the_fallback_path(monkeypatch):
    class BadClose(_Connection):
        def close(self):
            raise RuntimeError("socket already dead")

    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(db, "init_pool", lambda: None)
    monkeypatch.setattr(db.psycopg, "connect", lambda *_args, **_kwargs: BadClose())

    with db.get_connection() as yielded:
        assert isinstance(yielded, BadClose)
    assert db._pool is None


@pytest.mark.parametrize(
    ("row", "expected"),
    [((1,), True), (None, False), ((0,), False)],
)
def test_ping_reports_the_select_one_result(monkeypatch, row, expected):
    monkeypatch.setattr(db, "get_connection", lambda: _Connection(row=row))
    assert db.ping() is expected


def test_ping_degrades_instead_of_raising(monkeypatch):
    def unavailable():
        raise psycopg.OperationalError("database is down")

    monkeypatch.setattr(db, "get_connection", unavailable)
    assert db.ping() is False
