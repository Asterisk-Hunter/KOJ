"""Hermetic coverage for the Cloud Run one-job task runner."""

from __future__ import annotations

import threading
import types
from datetime import datetime, timezone

import pytest

from app import onejobrunner, queue
from app.config import settings
from app.judge import CaseResult, JudgeCase, JudgeResponse


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
    def __init__(self, row=None):
        self._cursor = _Cursor(row)

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Stop:
    def __init__(self, results):
        self.results = list(results)

    def wait(self, _timeout=None):
        return self.results.pop(0) if self.results else True


class _Recorder:
    def __init__(self, value=True):
        self.calls = []
        self.value = value

    def __call__(self, *args):
        self.calls.append(args)
        return self.value


def _args(**overrides):
    values = {"job_id": "11", "submission_id": "22", "attempt": "2", "max_attempts": "5", "worker_id": "worker-1"}
    values.update(overrides)
    return [
        values["job_id"],
        values["submission_id"],
        values["attempt"],
        values["max_attempts"],
        values["worker_id"],
    ]


def _job():
    return queue.ClaimedJob(id=11, submission_id=22, attempt=2, max_attempts=5)


def _submission():
    return queue.SubmissionInput(
        submission_id=22,
        problem_id=3,
        language="python",
        code="print(1)",
        mode="submit",
        time_limit_ms=1000,
        memory_limit_mb=256,
        output_comparator="exact",
        absolute_tolerance=1e-6,
        relative_tolerance=1e-6,
        checker_code=None,
        submitted_at=datetime.now(timezone.utc),
        cases=(JudgeCase(stdin="", expected_stdout="1\n", is_sample=True),),
    )


def _judge_response(status="accepted", infra_error=False):
    return JudgeResponse(
        status=status,
        passed_tests=1,
        total_tests=1,
        execution_time_ms=4,
        infra_error=infra_error,
        cases=[
            CaseResult(
                index=0,
                passed=status == "accepted",
                verdict=status,
                runtime_ms=4,
                stdout="1\n",
                stderr="",
            )
        ],
    )


@pytest.fixture
def cloudrun_ready(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://user:pw@db/koj")
    monkeypatch.setattr(settings, "JUDGE_SANDBOX_MODE", "cloudrun")
    monkeypatch.setattr(onejobrunner.db, "init_pool", _Recorder())
    monkeypatch.setattr(onejobrunner.db, "close_pool", _Recorder())
    monkeypatch.setattr(onejobrunner, "run_boundary_probe", _Recorder())


@pytest.mark.parametrize(
    "arguments",
    [
        [],
        ["11", "22", "2", "5"],
        ["11", "22", "2", "5", "worker-1", "extra"],
        ["a", "22", "2", "5", "worker-1"],
        ["0", "22", "2", "5", "worker-1"],
        ["11", "22", "0", "5", "worker-1"],
        ["11", "22", "3", "2", "worker-1"],
        ["11", "22", "2", "5", "worker;rm -rf"],
        ["11", "22", "2", "5", "-leading-dash"],
    ],
)
def test_run_rejects_malformed_arguments(arguments):
    assert onejobrunner.run(arguments) == 2


def test_run_requires_a_dsn_and_the_cloudrun_mode(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", "")
    monkeypatch.setattr(settings, "JUDGE_SANDBOX_MODE", "cloudrun")
    assert onejobrunner.run(_args()) == 2

    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://user:pw@db/koj")
    monkeypatch.setattr(settings, "JUDGE_SANDBOX_MODE", "rlimit")
    assert onejobrunner.run(_args()) == 2


def test_run_completes_a_fenced_job(monkeypatch, cloudrun_ready):
    monkeypatch.setattr(onejobrunner, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(onejobrunner, "_is_current_lease", lambda *_args: True)
    monkeypatch.setattr(queue, "load_submission", lambda _id: _submission())
    monkeypatch.setattr(onejobrunner, "_execute_local_submission", lambda _sub: _judge_response())
    complete = _Recorder(value=True)
    monkeypatch.setattr(queue, "complete_job", complete)

    assert onejobrunner.run(_args()) == 0
    assert complete.calls[0][0] == "worker-1"
    assert complete.calls[0][2].status == "accepted"


def test_run_ignores_a_stale_task(monkeypatch, cloudrun_ready):
    monkeypatch.setattr(onejobrunner, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(onejobrunner, "_is_current_lease", lambda *_args: False)
    load = _Recorder()
    monkeypatch.setattr(queue, "load_submission", load)

    assert onejobrunner.run(_args()) == 0
    assert load.calls == []


def test_run_ignores_a_task_whose_lease_was_lost(monkeypatch, cloudrun_ready):
    def lose_lease(_worker_id, _job, _stop, lost):
        lost.set()

    monkeypatch.setattr(onejobrunner, "_keep_lease_alive", lose_lease)
    load = _Recorder()
    monkeypatch.setattr(queue, "load_submission", load)

    assert onejobrunner.run(_args()) == 0
    assert load.calls == []


def test_run_discards_a_result_whose_lease_died_mid_execution(monkeypatch, cloudrun_ready):
    events = []

    class Event:
        def __init__(self):
            self.flag = False

        def set(self):
            self.flag = True

        def is_set(self):
            return self.flag

        def wait(self, _timeout=None):
            return self.flag

    def make_event():
        event = Event()
        events.append(event)
        return event

    monkeypatch.setattr(
        onejobrunner, "threading", types.SimpleNamespace(Event=make_event, Thread=threading.Thread)
    )
    monkeypatch.setattr(onejobrunner, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(onejobrunner, "_is_current_lease", lambda *_args: True)
    monkeypatch.setattr(queue, "load_submission", lambda _id: _submission())

    def execute(_submission):
        events[1].set()  # lease_lost, created after heartbeat_stop
        return _judge_response()

    monkeypatch.setattr(onejobrunner, "_execute_local_submission", execute)
    complete = _Recorder()
    monkeypatch.setattr(queue, "complete_job", complete)

    assert onejobrunner.run(_args()) == 1
    assert complete.calls == []


def test_run_buries_an_unavailable_submission(monkeypatch, cloudrun_ready):
    monkeypatch.setattr(onejobrunner, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(onejobrunner, "_is_current_lease", lambda *_args: True)
    monkeypatch.setattr(queue, "load_submission", lambda _id: None)
    unavailable = _Recorder()
    monkeypatch.setattr(queue, "mark_job_unavailable", unavailable)

    assert onejobrunner.run(_args()) == 0
    assert unavailable.calls == [("worker-1", _job())]


def test_run_reports_infrastructure_failures_to_the_task_scheduler(monkeypatch, cloudrun_ready):
    monkeypatch.setattr(onejobrunner, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(onejobrunner, "_is_current_lease", lambda *_args: True)
    monkeypatch.setattr(queue, "load_submission", lambda _id: _submission())
    monkeypatch.setattr(
        onejobrunner,
        "_execute_local_submission",
        lambda _sub: _judge_response(status="runtime_error", infra_error=True),
    )

    assert onejobrunner.run(_args()) == 1


def test_run_reports_a_fenced_out_result(monkeypatch, cloudrun_ready):
    monkeypatch.setattr(onejobrunner, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(onejobrunner, "_is_current_lease", lambda *_args: True)
    monkeypatch.setattr(queue, "load_submission", lambda _id: _submission())
    monkeypatch.setattr(onejobrunner, "_execute_local_submission", lambda _sub: _judge_response())
    monkeypatch.setattr(queue, "complete_job", _Recorder(value=False))

    assert onejobrunner.run(_args()) == 1


def test_run_reports_boundary_probe_failures(monkeypatch, cloudrun_ready):
    monkeypatch.setattr(
        onejobrunner,
        "run_boundary_probe",
        lambda: (_ for _ in ()).throw(RuntimeError("boundary probe failed")),
    )

    assert onejobrunner.run(_args()) == 1


def test_run_closes_the_pool_even_when_the_probe_explodes(monkeypatch, cloudrun_ready):
    monkeypatch.setattr(
        onejobrunner,
        "run_boundary_probe",
        lambda: (_ for _ in ()).throw(RuntimeError("boundary probe failed")),
    )
    assert onejobrunner.run(_args()) == 1
    assert onejobrunner.db.close_pool.calls == [()]


@pytest.mark.parametrize(("row", "expected"), [((1,), True), (None, False)])
def test_is_current_lease_reads_the_fencing_row(monkeypatch, row, expected):
    connection = _Connection(row=row)
    monkeypatch.setattr(onejobrunner.db, "get_connection", lambda: connection)

    assert onejobrunner._is_current_lease("worker-1", _job()) is expected
    query, params = connection._cursor.queries[0]
    assert "attempts = %s" in query
    assert "max_attempts = %s" in query
    assert params == (11, 22, "worker-1", 2, 5)


def test_keep_lease_alive_marks_a_lost_lease(monkeypatch):
    monkeypatch.setattr(queue, "heartbeat_worker", lambda *_args: False)
    lost = threading.Event()
    onejobrunner._keep_lease_alive("worker-1", _job(), _Stop([False, True]), lost)
    assert lost.is_set() is True


def test_keep_lease_alive_survives_heartbeat_errors(monkeypatch):
    calls = []

    def flaky(*_args):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("connection reset")
        return True

    monkeypatch.setattr(queue, "heartbeat_worker", flaky)
    lost = threading.Event()
    onejobrunner._keep_lease_alive("worker-1", _job(), _Stop([False, False, True]), lost)
    assert len(calls) == 2
    assert lost.is_set() is False
