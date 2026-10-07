"""Hermetic coverage for worker dispatch, persistence, and lease decisions."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app import queue, worker
from app.cloudrun_jobs import JobOutcome
from app.config import settings
from app.judge import CaseResult, JudgeCase, JudgeResponse


class _Stop:
    """Stand-in for threading.Event that returns scripted wait results."""

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


def _job(attempt=2, max_attempts=5):
    return queue.ClaimedJob(id=11, submission_id=22, attempt=attempt, max_attempts=max_attempts)


def _submission():
    return queue.SubmissionInput(
        submission_id=22,
        problem_id=3,
        language="python",
        code="print(1)",
        mode="submit",
        time_limit_ms=1000,
        memory_limit_mb=256,
        output_comparator="float",
        absolute_tolerance=0.5,
        relative_tolerance=0.25,
        checker_code="print('check')",
        submitted_at=datetime.now(timezone.utc),
        cases=(JudgeCase(stdin="", expected_stdout="1\n", is_sample=True),),
    )


def _judge_response(status="accepted", infra_error=False, error_message=None):
    return JudgeResponse(
        status=status,
        passed_tests=1,
        total_tests=1,
        execution_time_ms=4,
        error_message=error_message,
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


def test_execute_local_submission_maps_every_judge_field(monkeypatch):
    seen = {}

    def fake_execute(request, *, lock_wait_seconds=0.0):
        seen["request"] = request
        seen["lock"] = lock_wait_seconds
        return _judge_response()

    monkeypatch.setattr(worker, "execute_judge", fake_execute)
    result = worker._execute_local_submission(_submission())

    assert result.status == "accepted"
    assert seen["lock"] == 65
    request = seen["request"]
    assert request.language == "python"
    assert request.code == "print(1)"
    assert request.time_limit_ms == 1000
    assert request.memory_mb == 256
    assert request.absolute_tolerance == 0.5
    assert request.relative_tolerance == 0.25
    assert request.checker_code == "print('check')"
    assert list(request.cases)[0].expected_stdout == "1\n"


@pytest.mark.parametrize(
    ("mode", "backend", "expected"),
    [
        ("cloudrun", "cloudrun", True),
        ("auto", "cloudrun", True),
        ("auto", "rlimit", False),
        ("docker", "docker", False),
    ],
)
def test_cloudrun_dispatch_selection(monkeypatch, mode, backend, expected):
    monkeypatch.setattr(settings, "JUDGE_SANDBOX_MODE", mode)
    monkeypatch.setattr(worker, "resolve_sandbox_backend", lambda: backend)
    assert worker._uses_cloudrun_job_dispatch() is expected


def test_process_job_persists_a_completed_verdict(monkeypatch):
    monkeypatch.setattr(worker, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: False)
    monkeypatch.setattr(queue, "load_submission", lambda _id: _submission())
    monkeypatch.setattr(worker, "_execute_local_submission", lambda _sub: _judge_response())
    complete = _Recorder()
    retry = _Recorder()
    monkeypatch.setattr(queue, "complete_job", complete)
    monkeypatch.setattr(queue, "retry_job", retry)

    worker._process_job("worker-1", _job())

    assert len(complete.calls) == 1
    assert complete.calls[0][0] == "worker-1"
    assert complete.calls[0][1] == _job()
    assert complete.calls[0][2].status == "accepted"
    assert retry.calls == []


def test_process_job_dispatches_cloudrun_jobs_without_local_load(monkeypatch):
    monkeypatch.setattr(worker, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: True)
    dispatched = _Recorder()
    monkeypatch.setattr(worker, "_process_cloudrun_job", dispatched)
    monkeypatch.setattr(queue, "load_submission", _Recorder())

    worker._process_job("worker-1", _job())

    assert len(dispatched.calls) == 1
    assert dispatched.calls[0][0] == "worker-1"


def test_process_job_marks_unavailable_submissions(monkeypatch):
    monkeypatch.setattr(worker, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: False)
    monkeypatch.setattr(queue, "load_submission", lambda _id: None)
    unavailable = _Recorder()
    monkeypatch.setattr(queue, "mark_job_unavailable", unavailable)
    monkeypatch.setattr(queue, "complete_job", _Recorder())

    worker._process_job("worker-1", _job())

    assert unavailable.calls == [("worker-1", _job())]


def test_process_job_retries_infrastructure_failures(monkeypatch):
    monkeypatch.setattr(worker, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: False)
    monkeypatch.setattr(queue, "load_submission", lambda _id: _submission())
    monkeypatch.setattr(
        worker,
        "_execute_local_submission",
        lambda _sub: _judge_response(status="runtime_error", infra_error=True, error_message="sandbox down"),
    )
    retry = _Recorder()
    monkeypatch.setattr(queue, "retry_job", retry)
    monkeypatch.setattr(queue, "complete_job", _Recorder())

    worker._process_job("worker-1", _job())

    assert retry.calls[0][0] == "worker-1"
    assert retry.calls[0][2] == "sandbox down"
    assert retry.calls[0][3] == 1


def test_process_job_discards_results_after_losing_the_lease(monkeypatch):
    def lose_lease(_worker_id, _job, _stop, lost):
        lost.set()

    monkeypatch.setattr(worker, "_keep_lease_alive", lose_lease)
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: False)
    monkeypatch.setattr(queue, "load_submission", lambda _id: _submission())
    monkeypatch.setattr(worker, "_execute_local_submission", lambda _sub: _judge_response())
    complete = _Recorder()
    retry = _Recorder()
    monkeypatch.setattr(queue, "complete_job", complete)
    monkeypatch.setattr(queue, "retry_job", retry)

    worker._process_job("worker-1", _job())

    assert complete.calls == []
    assert retry.calls == []


def test_process_job_retries_after_an_execution_exception(monkeypatch):
    monkeypatch.setattr(worker, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: False)

    def explode(_id):
        raise RuntimeError("statement timeout")

    monkeypatch.setattr(queue, "load_submission", explode)
    retry = _Recorder()
    monkeypatch.setattr(queue, "retry_job", retry)

    worker._process_job("worker-1", _job())

    assert retry.calls == [("worker-1", _job(), "judge worker execution failed")]


def test_process_job_swallows_a_failing_retry_write(monkeypatch):
    monkeypatch.setattr(worker, "_keep_lease_alive", lambda *_args: None)
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: False)

    def explode(_id):
        raise RuntimeError("statement timeout")

    def failing_retry(*_args):
        raise RuntimeError("database gone")

    monkeypatch.setattr(queue, "load_submission", explode)
    monkeypatch.setattr(queue, "retry_job", failing_retry)

    worker._process_job("worker-1", _job())


@pytest.mark.parametrize("outcome", [JobOutcome.FAILED, JobOutcome.AMBIGUOUS])
def test_cloudrun_job_failures_retry_the_job(monkeypatch, outcome):
    monkeypatch.setattr(worker.JobConfig, "from_environment", staticmethod(lambda: object()))
    monkeypatch.setattr(worker, "run_job", lambda *_args: outcome)
    retry = _Recorder()
    heartbeat = _Recorder()
    monkeypatch.setattr(queue, "retry_job", retry)
    monkeypatch.setattr(queue, "heartbeat_worker", heartbeat)

    worker._process_cloudrun_job("worker-1", _job(), __import__("threading").Event())

    assert len(retry.calls) == 1
    assert heartbeat.calls == []


def test_cloudrun_job_success_refreshes_the_heartbeat(monkeypatch):
    monkeypatch.setattr(worker.JobConfig, "from_environment", staticmethod(lambda: object()))
    monkeypatch.setattr(worker, "run_job", lambda *_args: JobOutcome.SUCCEEDED)
    retry = _Recorder()
    heartbeat = _Recorder()
    monkeypatch.setattr(queue, "retry_job", retry)
    monkeypatch.setattr(queue, "heartbeat_worker", heartbeat)

    worker._process_cloudrun_job("worker-1", _job(), __import__("threading").Event())

    assert retry.calls == []
    assert heartbeat.calls == [("worker-1", None, settings.JUDGE_LEASE_SECONDS)]


def test_cloudrun_dispatch_exception_retries_unless_the_lease_is_gone(monkeypatch):
    monkeypatch.setattr(worker.JobConfig, "from_environment", staticmethod(lambda: object()))
    monkeypatch.setattr(
        worker,
        "run_job",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("job api unavailable")),
    )
    retry = _Recorder()
    monkeypatch.setattr(queue, "retry_job", retry)

    lost = __import__("threading").Event()
    worker._process_cloudrun_job("worker-1", _job(), lost)
    assert len(retry.calls) == 1

    retry.calls.clear()
    lost.set()
    worker._process_cloudrun_job("worker-1", _job(), lost)
    assert retry.calls == []


def test_cloudrun_dispatch_swallows_a_failing_retry_write(monkeypatch):
    monkeypatch.setattr(worker.JobConfig, "from_environment", staticmethod(lambda: object()))
    monkeypatch.setattr(worker, "run_job", lambda *_args: JobOutcome.FAILED)

    def failing_retry(*_args):
        raise RuntimeError("database gone")

    monkeypatch.setattr(queue, "retry_job", failing_retry)

    worker._process_cloudrun_job("worker-1", _job(), __import__("threading").Event())


def test_keep_lease_alive_flags_a_lost_lease(monkeypatch):
    monkeypatch.setattr(queue, "heartbeat_worker", lambda *_args: False)
    lost = __import__("threading").Event()
    worker._keep_lease_alive("worker-1", _job(), _Stop([False, True]), lost)
    assert lost.is_set() is True


def test_keep_lease_alive_survives_heartbeat_errors(monkeypatch):
    calls = []

    def flaky(*_args):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("connection reset")
        return True

    monkeypatch.setattr(queue, "heartbeat_worker", flaky)
    lost = __import__("threading").Event()
    worker._keep_lease_alive("worker-1", _job(), _Stop([False, False, True]), lost)
    assert len(calls) == 2
    assert lost.is_set() is False


def test_run_requires_a_database_url(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", "")
    with pytest.raises(RuntimeError, match="DATABASE_URL is not configured"):
        worker.run()


def test_run_refuses_research_without_the_docker_sandbox(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://user:pw@db/koj")
    monkeypatch.setattr(settings, "TRAINING_WORKER_ENABLED", True)
    monkeypatch.setattr(settings, "JUDGE_SANDBOX_MODE", "rlimit")
    with pytest.raises(RuntimeError, match="research judging requires"):
        worker.run()


def test_run_registers_and_unregisters_around_the_poll_loop(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://user:pw@db/koj")
    monkeypatch.setattr(settings, "TRAINING_WORKER_ENABLED", False)
    monkeypatch.setattr(worker.db, "init_pool", lambda: None)
    monkeypatch.setattr(worker.db, "close_pool", _Recorder())
    monkeypatch.setattr(worker, "warm_go_cache", _Recorder())
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: False)
    registered = _Recorder()
    stopping = _Recorder()
    monkeypatch.setattr(queue, "register_worker", registered)
    monkeypatch.setattr(queue, "mark_worker_stopping", stopping)

    def signal_immediately(signum, handler):
        handler(signum, None)

    monkeypatch.setattr(worker.signal, "signal", signal_immediately)
    worker.run()

    assert len(registered.calls) == 1
    assert stopping.calls == [(registered.calls[0][0],)]
