from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import main, monitoring


class _Cursor:
    def __init__(self, row):
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
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


@pytest.mark.parametrize(
    ("row", "expected"),
    [((True, True), True), ((False, True), False), ((True, False), False)],
)
def test_judge_health_checks_worker_freshness_and_old_due_queue_age(monkeypatch, row, expected):
    cursor = _Cursor(row)
    monkeypatch.setattr(monitoring.db, "get_connection", lambda: _Connection(cursor))

    assert monitoring.judge_health() is expected

    query, params = cursor.queries[0]
    assert "judge_workers" in query
    assert "judge_jobs" in query
    assert params == (monitoring.WORKER_STALE_SECONDS, monitoring.QUEUE_STALE_SECONDS)


def test_judge_readiness_requires_internal_secret(monkeypatch):
    monkeypatch.setattr(main.settings, "JUDGE_INTERNAL_SECRET", "s3cret")

    with pytest.raises(HTTPException) as error:
        main.judge_readiness(x_judge_secret="wrong")

    assert error.value.status_code == 401


def test_judge_readiness_returns_degraded_when_database_probe_fails(monkeypatch):
    monkeypatch.setattr(main.settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(main.monitoring, "judge_health", lambda: False)

    response = main.judge_readiness(x_judge_secret="s3cret")

    assert response.status_code == 503
    assert response.body == b'{"status":"degraded"}'


@pytest.mark.parametrize(("healthy", "status_code"), [(True, 200), (False, 503)])
def test_judge_readiness_returns_minimal_status(monkeypatch, healthy, status_code):
    monkeypatch.setattr(main.settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(main.monitoring, "judge_health", lambda: healthy)

    response = main.judge_readiness(x_judge_secret="s3cret")

    assert response.status_code == status_code
    assert response.body in (b'{"status":"ok"}', b'{"status":"degraded"}')
