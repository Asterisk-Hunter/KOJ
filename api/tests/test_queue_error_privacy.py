"""Infrastructure failures never persist raw worker exception text."""

from __future__ import annotations

from app import queue


class _Cursor:
    def __init__(self):
        self.queries = []

    def execute(self, query, params=()):
        self.queries.append((query, params))

    def fetchone(self):
        return (7,)

    def fetchall(self):
        return [(7,)]

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Transaction:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def transaction(self):
        return _Transaction()

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def test_retry_job_persists_only_generic_infrastructure_error(monkeypatch):
    cursor = _Cursor()
    monkeypatch.setattr(queue.db, "get_connection", lambda: _Connection(cursor))
    marker = "hidden-input-and-dsn-marker"
    job = queue.ClaimedJob(id=3, submission_id=7, attempt=3, max_attempts=3)

    assert queue.retry_job("worker", job, f"database error: {marker}")

    assert marker not in repr(cursor.queries)
    assert cursor.queries[1][1][3] == queue._INFRASTRUCTURE_ERROR_MESSAGE
    assert cursor.queries[2][1][2] == queue._INFRASTRUCTURE_ERROR_MESSAGE


def test_finalizing_exhausted_job_does_not_copy_historical_error(monkeypatch):
    cursor = _Cursor()
    monkeypatch.setattr(queue.db, "get_connection", lambda: _Connection(cursor))

    assert queue.finalize_exhausted_jobs() == 1

    query = cursor.queries[0][0]
    assert "exhausted.last_error" not in query
    assert query.count(queue._INFRASTRUCTURE_ERROR_MESSAGE) == 2
