"""Dispatch one leased judge attempt to an isolated Cloud Run Job task."""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .queue import ClaimedJob

_JOB_RE = re.compile(r"projects/[A-Za-z0-9-]+/locations/[a-z0-9-]+/jobs/[a-z0-9-]+\Z")
_OPERATION_RE = re.compile(r"projects/[A-Za-z0-9-]+/locations/[a-z0-9-]+/operations/[A-Za-z0-9-]+\Z")
_EXECUTION_RE = re.compile(
    r"projects/[A-Za-z0-9-]+/locations/[a-z0-9-]+/jobs/[a-z0-9-]+/executions/[a-z0-9-]+\Z"
)
_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
_API_ROOT = "https://run.googleapis.com/v2/"
_STARTUP_GRACE_SECONDS = 90


class JobOutcome(str, Enum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    AMBIGUOUS = "ambiguous"


@dataclass(frozen=True)
class JobConfig:
    name: str
    timeout_seconds: int = 300

    @classmethod
    def from_environment(cls) -> JobConfig:
        name = os.environ.get("JUDGE_CLOUD_RUN_JOB", "")
        if not _JOB_RE.fullmatch(name):
            raise ValueError("JUDGE_CLOUD_RUN_JOB must be a full Cloud Run Job resource name")
        raw_timeout = os.environ.get("JUDGE_JOB_TIMEOUT_SECONDS", "300")
        if not raw_timeout.isdecimal():
            raise ValueError("JUDGE_JOB_TIMEOUT_SECONDS must be an integer")
        timeout_seconds = int(raw_timeout)
        if not 30 <= timeout_seconds <= 900:
            raise ValueError("JUDGE_JOB_TIMEOUT_SECONDS must be between 30 and 900")
        return cls(name=name, timeout_seconds=timeout_seconds)


def _validate_arguments(worker_id: str, job: ClaimedJob) -> list[str]:
    if not _ID_RE.fullmatch(worker_id):
        raise ValueError("invalid worker id")
    if job.id <= 0 or job.submission_id <= 0:
        raise ValueError("invalid job identifier")
    if job.attempt <= 0 or job.max_attempts < job.attempt:
        raise ValueError("invalid job attempt")
    return [str(job.id), str(job.submission_id), str(job.attempt), str(job.max_attempts), worker_id]


def _access_token() -> str:
    request = Request(_METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"})
    with urlopen(request, timeout=3) as response:
        token = json.loads(response.read()).get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("metadata server returned no access token")
    return token


def _request_json(method: str, resource: str, body: dict[str, object] | None = None) -> dict[str, object]:
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    request = Request(
        _API_ROOT + quote(resource, safe="/:"),
        data=payload,
        headers={"Authorization": f"Bearer {_access_token()}", "Content-Type": "application/json"},
        method=method,
    )
    with urlopen(request, timeout=10) as response:
        parsed = json.loads(response.read())
    if not isinstance(parsed, dict):
        raise RuntimeError("Cloud Run API returned an invalid response")
    return parsed


def _heartbeat(callback: Callable[[], bool] | None) -> None:
    if callback is not None:
        callback()


def _execution_finished(operation: dict[str, object]) -> tuple[str | None, JobOutcome | None]:
    if operation.get("error"):
        return None, JobOutcome.FAILED
    response = operation.get("response")
    if not isinstance(response, dict):
        return None, None
    execution = response.get("name")
    if not isinstance(execution, str) or not _EXECUTION_RE.fullmatch(execution):
        return None, None
    return execution, None


def _execution_outcome(execution: dict[str, object]) -> JobOutcome | None:
    if execution.get("completionTime"):
        conditions = execution.get("conditions")
        if isinstance(conditions, list):
            for condition in conditions:
                if isinstance(condition, dict) and condition.get("type") == "Completed":
                    return JobOutcome.SUCCEEDED if condition.get("state") == "CONDITION_SUCCEEDED" else JobOutcome.FAILED
        return JobOutcome.SUCCEEDED if int(execution.get("succeededCount", 0) or 0) > 0 else JobOutcome.FAILED
    return None


def run_job(
    config: JobConfig,
    worker_id: str,
    job: ClaimedJob,
    heartbeat: Callable[[], bool] | None = None,
    *,
    poll_seconds: float = 5,
    startup_grace_seconds: int = _STARTUP_GRACE_SECONDS,
) -> JobOutcome:
    """Start one task and wait for terminal state before permitting a retry."""
    arguments = _validate_arguments(worker_id, job)
    deadline = time.monotonic() + config.timeout_seconds + startup_grace_seconds
    body = {
        "overrides": {
            "containerOverrides": [{"args": arguments}],
            "taskCount": 1,
            "timeout": f"{config.timeout_seconds}s",
        }
    }
    try:
        operation = _request_json("POST", f"{config.name}:run", body)
    except HTTPError as error:
        if 400 <= error.code < 500:
            return JobOutcome.FAILED
        operation = {}
    except (URLError, TimeoutError, OSError, RuntimeError, ValueError):
        operation = {}

    operation_name = operation.get("name")
    if not isinstance(operation_name, str) or not _OPERATION_RE.fullmatch(operation_name):
        while time.monotonic() < deadline:
            _heartbeat(heartbeat)
            time.sleep(min(poll_seconds, max(0, deadline - time.monotonic())))
        return JobOutcome.AMBIGUOUS

    execution_name: str | None = None
    while time.monotonic() < deadline:
        _heartbeat(heartbeat)
        if execution_name is None:
            try:
                operation = _request_json("GET", operation_name)
                if operation.get("done") is True:
                    execution_name, result = _execution_finished(operation)
                    if result is not None:
                        return result
            except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError):
                pass
        else:
            try:
                execution = _request_json("GET", execution_name)
                result = _execution_outcome(execution)
                if result is not None:
                    return result
            except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError):
                pass
        time.sleep(min(poll_seconds, max(0, deadline - time.monotonic())))
    return JobOutcome.AMBIGUOUS
