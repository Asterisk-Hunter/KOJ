"""Hermetic coverage for the Cloud Run sandbox deployment probes."""

from __future__ import annotations

import subprocess

import pytest

from app import sandbox_probe
from app.judge import JudgeResponse, ProcessResult


class _Recorder:
    def __init__(self, value=True):
        self.calls = []
        self.value = value

    def __call__(self, *args):
        self.calls.append(args)
        return self.value


def _accepted():
    return JudgeResponse(
        status="accepted", passed_tests=1, total_tests=1, execution_time_ms=5, cases=[]
    )


def _probe_runner(*, timeout_raises=True, flood_exceeded=True, fork_output="fork-blocked\n"):
    def run(_image, _workdir, command, _memory_mb, _timeout_s, *_args, **_kwargs):
        code = command[-1]
        if "time.sleep(5)" in code:
            if timeout_raises:
                raise subprocess.TimeoutExpired(command, 0.5)
            return ProcessResult(0, "", "", False)
        if "2097152" in code:
            return ProcessResult(0, "", "", flood_exceeded)
        if "subprocess.Popen" in code:
            return ProcessResult(0, fork_output, "", False)
        raise AssertionError(f"unexpected probe command: {command}")

    return run


def test_boundary_probe_requires_the_cloudrun_backend(monkeypatch):
    monkeypatch.setattr(sandbox_probe, "resolve_sandbox_backend", lambda: "rlimit")
    with pytest.raises(RuntimeError, match="Cloud Run sandbox backend is not selected"):
        sandbox_probe.run_boundary_probe()


def test_boundary_probe_passes_on_the_boundary_ok_marker(monkeypatch):
    monkeypatch.setattr(sandbox_probe, "resolve_sandbox_backend", lambda: "cloudrun")
    run = _Recorder(value=ProcessResult(0, "boundary-ok\n", "", False))
    monkeypatch.setattr(sandbox_probe, "_run_cloudrun", run)

    sandbox_probe.run_boundary_probe()

    command = run.calls[0][2]
    assert command[:2] == ["python3", "-c"]
    assert "'sudo', '-n', 'id', '-u'" in command[2]


@pytest.mark.parametrize(
    "result",
    [
        ProcessResult(1, "boundary-ok\n", "boom", False),
        ProcessResult(0, "boundary-bad\n", "", False),
    ],
)
def test_boundary_probe_rejects_a_failed_container(monkeypatch, result):
    monkeypatch.setattr(sandbox_probe, "resolve_sandbox_backend", lambda: "cloudrun")
    monkeypatch.setattr(sandbox_probe, "_run_cloudrun", lambda *_args, **_kwargs: result)
    with pytest.raises(RuntimeError, match="boundary probe failed"):
        sandbox_probe.run_boundary_probe()


def test_deployment_probe_smokes_every_language_and_limit(monkeypatch):
    monkeypatch.setattr(sandbox_probe, "run_boundary_probe", lambda: None)
    executed = _Recorder(value=_accepted())
    monkeypatch.setattr(sandbox_probe, "execute_judge", executed)
    monkeypatch.setattr(sandbox_probe, "_run_cloudrun", _probe_runner())

    sandbox_probe.run_deployment_probe()

    assert [call[0].language for call in executed.calls] == list(sandbox_probe._SMOKE_CODE)


def test_deployment_probe_rejects_a_failing_language(monkeypatch):
    monkeypatch.setattr(sandbox_probe, "run_boundary_probe", lambda: None)
    monkeypatch.setattr(
        sandbox_probe,
        "execute_judge",
        lambda request: JudgeResponse(
            status="runtime_error",
            passed_tests=0,
            total_tests=1,
            execution_time_ms=1,
            error_message=f"{request.language} failed",
            cases=[],
        ),
    )
    monkeypatch.setattr(sandbox_probe, "_run_cloudrun", _probe_runner())

    with pytest.raises(RuntimeError, match="smoke probe failed"):
        sandbox_probe.run_deployment_probe()


@pytest.mark.parametrize(
    ("runner", "message"),
    [
        (_probe_runner(timeout_raises=False), "timeout probe failed"),
        (_probe_runner(flood_exceeded=False), "output probe failed"),
        (_probe_runner(fork_output="fork-unbounded\n"), "process probe failed"),
    ],
)
def test_deployment_probe_rejects_a_container_without_limits(monkeypatch, runner, message):
    monkeypatch.setattr(sandbox_probe, "run_boundary_probe", lambda: None)
    monkeypatch.setattr(sandbox_probe, "execute_judge", _Recorder(value=_accepted()))
    monkeypatch.setattr(sandbox_probe, "_run_cloudrun", runner)

    with pytest.raises(RuntimeError, match=message):
        sandbox_probe.run_deployment_probe()
