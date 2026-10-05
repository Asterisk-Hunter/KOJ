from __future__ import annotations

import json

import pytest

from app import cloudrun_jobs
from app.queue import ClaimedJob


def test_metadata_token_request_is_internal_and_uses_google_header(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def __enter__(self) -> Response:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read(self) -> bytes:
            return b'{"access_token":"test-token"}'

    seen: list[object] = []

    def open_request(request: object, timeout: float) -> Response:
        seen.extend([request, timeout])
        return Response()

    monkeypatch.setattr(cloudrun_jobs, "urlopen", open_request)
    assert cloudrun_jobs._access_token() == "test-token"
    request = seen[0]
    assert getattr(request, "full_url") == cloudrun_jobs._METADATA_TOKEN_URL
    assert getattr(request, "get_header")("Metadata-flavor") == "Google"
    assert seen[1] == 3


def test_job_config_requires_fixed_resource_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JUDGE_CLOUD_RUN_JOB", "projects/demo/locations/us-central1/jobs/judge")
    monkeypatch.setenv("JUDGE_JOB_TIMEOUT_SECONDS", "300")
    assert cloudrun_jobs.JobConfig.from_environment() == cloudrun_jobs.JobConfig(
        "projects/demo/locations/us-central1/jobs/judge", 300
    )

    monkeypatch.setenv("JUDGE_CLOUD_RUN_JOB", "https://example.test/run")
    with pytest.raises(ValueError):
        cloudrun_jobs.JobConfig.from_environment()


def test_run_job_uses_exact_attempt_arguments_and_no_retry_override(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, dict[str, object] | None]] = []
    execution_name = "projects/demo/locations/us-central1/jobs/judge/executions/judge-abc"

    def request(method: str, resource: str, body: dict[str, object] | None = None) -> dict[str, object]:
        calls.append((method, resource, body))
        if method == "POST":
            return {"name": "projects/demo/locations/us-central1/operations/op-123"}
        if resource.endswith("operations/op-123"):
            return {"done": True, "response": {"name": execution_name}}
        return {"completionTime": "2026-01-01T00:00:00Z", "succeededCount": 1}

    monkeypatch.setattr(cloudrun_jobs, "_request_json", request)
    monkeypatch.setattr(cloudrun_jobs.time, "sleep", lambda _delay: None)
    outcome = cloudrun_jobs.run_job(
        cloudrun_jobs.JobConfig("projects/demo/locations/us-central1/jobs/judge", 30),
        "worker-1",
        ClaimedJob(11, 22, 3, 5),
        poll_seconds=0,
        startup_grace_seconds=1,
    )

    assert outcome == cloudrun_jobs.JobOutcome.SUCCEEDED
    assert calls[0][0:2] == ("POST", "projects/demo/locations/us-central1/jobs/judge:run")
    body = calls[0][2]
    assert body is not None
    overrides = body["overrides"]
    assert isinstance(overrides, dict)
    assert overrides == {
        "containerOverrides": [{"args": ["11", "22", "3", "5", "worker-1"]}],
        "taskCount": 1,
        "timeout": "30s",
    }
    assert all("maxRetries" not in json.dumps(call[2]) for call in calls if call[2] is not None)


def test_ambiguous_launch_waits_entire_timeout_before_return(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [0.0]
    waited: list[float] = []
    heartbeat_count = [0]

    def sleep(delay: float) -> None:
        waited.append(delay)
        now[0] += delay

    monkeypatch.setattr(cloudrun_jobs, "_request_json", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(cloudrun_jobs.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(cloudrun_jobs.time, "sleep", sleep)
    outcome = cloudrun_jobs.run_job(
        cloudrun_jobs.JobConfig("projects/demo/locations/us-central1/jobs/judge", 30),
        "worker-1",
        ClaimedJob(1, 2, 1, 3),
        heartbeat=lambda: heartbeat_count.__setitem__(0, heartbeat_count[0] + 1) or True,
        poll_seconds=10,
        startup_grace_seconds=20,
    )

    assert outcome == cloudrun_jobs.JobOutcome.AMBIGUOUS
    assert sum(waited) == 50
    assert heartbeat_count[0] == 5


def test_attempt_arguments_reject_injection() -> None:
    with pytest.raises(ValueError):
        cloudrun_jobs._validate_arguments("worker;evil", ClaimedJob(1, 2, 1, 3))
