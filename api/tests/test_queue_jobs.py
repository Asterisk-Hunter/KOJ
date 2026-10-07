"""Hermetic coverage for the queue lease, completion, and retry SQL paths."""

from __future__ import annotations

import json

import pytest

from app import queue
from app.judge import CaseResult, JudgeResponse


class _Cursor:
    """Returns queued fetch results in call order and records every statement."""

    def __init__(self, fetchone_rows=(), fetchall_rows=()):
        self.fetchone_rows = list(fetchone_rows)
        self.fetchall_rows = list(fetchall_rows)
        self.queries: list[tuple[str, tuple]] = []

    def execute(self, query, params=()):
        self.queries.append((query, params))

    def fetchone(self):
        assert self.fetchone_rows, "unexpected extra fetchone"
        return self.fetchone_rows.pop(0)

    def fetchall(self):
        assert self.fetchall_rows, "unexpected extra fetchall"
        return self.fetchall_rows.pop(0)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def transaction(self):
        return self

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def _install(monkeypatch, cursor):
    monkeypatch.setattr(queue.db, "get_connection", lambda: _Connection(cursor))
    return cursor


def _result(*cases):
    return JudgeResponse(
        status="accepted",
        passed_tests=1,
        total_tests=1,
        execution_time_ms=7,
        error_message=None,
        cases=list(cases),
    )


def test_register_worker_upserts_identity(monkeypatch):
    cursor = _install(monkeypatch, _Cursor())
    queue.register_worker("worker-1", "host-1")

    query, params = cursor.queries[0]
    assert "INSERT INTO judge_workers" in query
    assert "ON CONFLICT (id) DO UPDATE" in query
    assert params == ("worker-1", "host-1")


def test_heartbeat_without_a_job_only_touches_the_worker_row(monkeypatch):
    cursor = _install(monkeypatch, _Cursor())
    assert queue.heartbeat_worker("worker-1", None, 30) is True

    assert len(cursor.queries) == 1
    assert "UPDATE judge_workers" in cursor.queries[0][0]
    assert cursor.queries[0][1] == ("idle", None, None, "worker-1")


def test_heartbeat_renews_a_live_lease(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[(4,)]))
    job = queue.ClaimedJob(id=4, submission_id=9, attempt=2, max_attempts=5)

    assert queue.heartbeat_worker("worker-1", job, 30) is True
    assert "RETURNING id" in cursor.queries[0][0]
    assert cursor.queries[0][1] == (30, 4, "worker-1", 2)
    assert cursor.queries[1][1] == ("busy", 4, 4, "worker-1")


def test_heartbeat_reports_a_lost_lease_without_touching_the_worker(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[None]))
    job = queue.ClaimedJob(id=4, submission_id=9, attempt=2, max_attempts=5)

    assert queue.heartbeat_worker("worker-1", job, 30) is False
    assert len(cursor.queries) == 1


def test_mark_worker_stopping_swallows_database_errors(monkeypatch):
    cursor = _install(monkeypatch, _Cursor())
    queue.mark_worker_stopping("worker-1")
    assert cursor.queries[0][1] == ("worker-1",)

    def unavailable():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(queue.db, "get_connection", unavailable)
    queue.mark_worker_stopping("worker-1")


def test_claim_job_leases_with_skip_locked_and_marks_the_submission_running(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[(11, 22, 2, 5)]))
    job = queue.claim_job("worker-1", 30)

    assert job == queue.ClaimedJob(id=11, submission_id=22, attempt=2, max_attempts=5)
    claim_query, claim_params = cursor.queries[0]
    assert "FOR UPDATE SKIP LOCKED" in claim_query
    assert "attempts < max_attempts" in claim_query
    assert claim_params == ("worker-1", 30)
    assert "status = 'running'" in cursor.queries[1][0]
    assert cursor.queries[1][1] == (22,)
    assert cursor.queries[2][1] == (11, 11, "worker-1")


def test_claim_job_parks_the_worker_when_nothing_is_due(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[None]))
    assert queue.claim_job("worker-1", 30) is None

    assert len(cursor.queries) == 2
    assert "status = 'idle'" in cursor.queries[1][0]
    assert cursor.queries[1][1] == ("worker-1",)


def test_complete_job_fences_on_the_exact_lease(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[None]))
    job = queue.ClaimedJob(id=11, submission_id=22, attempt=2, max_attempts=5)

    assert queue.complete_job("worker-1", job, _result()) is False
    fence_query, fence_params = cursor.queries[0]
    assert "status = 'leased' AND leased_by = %s AND attempts = %s" in fence_query
    assert "lease_expires_at > NOW()" in fence_query
    assert fence_params == (11, "worker-1", 2)
    assert len(cursor.queries) == 1


def test_complete_job_writes_the_verdict_and_releases_the_worker(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[(22,)]))
    job = queue.ClaimedJob(id=11, submission_id=22, attempt=2, max_attempts=5)
    case = CaseResult(
        index=0,
        passed=True,
        verdict="accepted",
        runtime_ms=3,
        stdout="x" * 4000,
        stderr="",
    )

    assert queue.complete_job("worker-1", job, _result(case)) is True
    submission_params = cursor.queries[1][1]
    assert submission_params[:4] == ("accepted", 1, 1, 7)
    stored = json.loads(submission_params[6])
    assert stored[0]["stdout"] == "x" * 2048
    assert submission_params[7] == 22
    assert cursor.queries[2][1] == ("worker-1",)


def test_serialize_cases_caps_the_sample_at_one_hundred(monkeypatch):
    cases = [
        CaseResult(
            index=index,
            passed=True,
            verdict="accepted",
            runtime_ms=1,
            stdout="ok",
            stderr="",
        )
        for index in range(150)
    ]
    assert len(json.loads(queue._serialize_cases(cases))) == 100


def test_retry_job_requeues_with_backoff(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[(22,)]))
    job = queue.ClaimedJob(id=11, submission_id=22, attempt=2, max_attempts=5)

    assert queue.retry_job("worker-1", job, "sandbox down", total_tests=3) is True
    _, job_params = cursor.queries[0]
    assert job_params[0] == "queued"
    assert job_params[1] == queue.retry_delay_seconds(2)
    assert job_params[2] is None
    _, submission_params = cursor.queries[1]
    assert submission_params == ("pending", 3, queue._INFRASTRUCTURE_ERROR_MESSAGE, None, 22)
    assert cursor.queries[2][1] == ("worker-1",)


def test_retry_job_buries_the_final_attempt(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[(22,)]))
    job = queue.ClaimedJob(id=11, submission_id=22, attempt=5, max_attempts=5)

    assert queue.retry_job("worker-1", job, "sandbox down") is True
    _, job_params = cursor.queries[0]
    assert job_params[0] == "dead"
    assert job_params[2] is not None
    _, submission_params = cursor.queries[1]
    assert submission_params[0] == "runtime_error"
    assert submission_params[4] is not None


def test_retry_job_refuses_a_stale_lease(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[None]))
    job = queue.ClaimedJob(id=11, submission_id=22, attempt=1, max_attempts=5)

    assert queue.retry_job("worker-1", job, "sandbox down") is False
    assert len(cursor.queries) == 1


def test_mark_job_unavailable_buries_the_job_and_frees_the_worker(monkeypatch):
    cursor = _install(monkeypatch, _Cursor())
    job = queue.ClaimedJob(id=11, submission_id=22, attempt=1, max_attempts=5)

    assert queue.mark_job_unavailable("worker-1", job) is None
    assert "status = 'dead'" in cursor.queries[0][0]
    assert "'submission is no longer judgeable'" in cursor.queries[0][0]
    assert cursor.queries[1][1] == ("worker-1",)


def test_finalize_exhausted_jobs_counts_buried_submissions(monkeypatch):
    cursor = _install(monkeypatch, _Cursor(fetchall_rows=[[1, 2, 3]]))
    assert queue.finalize_exhausted_jobs() == 3

    query, params = cursor.queries[0]
    assert "attempts >= max_attempts" in query
    assert "judge_infra_error = true" in query
    assert params == ()


def test_retry_delay_is_capped_and_never_negative():
    assert queue.retry_delay_seconds(1) == 5
    assert queue.retry_delay_seconds(6) == 160
    assert queue.retry_delay_seconds(99) == 300
    assert queue.retry_delay_seconds(0) == 5
