"""Trusted judge forwarding stays on a validated origin and fails closed."""

from __future__ import annotations

import io

import pytest
from fastapi import HTTPException

from app import main
from app.judge import JudgeCase, JudgeRequest, JudgeResponse
from app.upstream import JudgeUpstream, JudgeUpstreamUnavailable

_SECRET = "a" * 64


class _Response(io.BytesIO):
    status = 200


def _judge_request() -> JudgeRequest:
    return JudgeRequest(
        language="python",
        code="print('ok')",
        cases=[JudgeCase(stdin="", expected_stdout="ok")],
        time_limit_ms=1000,
        memory_mb=128,
    )


def test_http_origin_is_limited_to_private_judge_subnet():
    assert JudgeUpstream("http://10.32.0.2:8000", _SECRET).origin == "http://10.32.0.2:8000"
    with pytest.raises(ValueError):
        JudgeUpstream("http://example.com", _SECRET)
    with pytest.raises(ValueError):
        JudgeUpstream("http://10.32.1.2:8000", _SECRET)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/judge",
        "https://user:pass@example.com",
        "https://example.com?next=evil",
        "https://example.com#fragment",
    ],
)
def test_upstream_rejects_non_origin_urls(url):
    with pytest.raises(ValueError):
        JudgeUpstream(url, _SECRET)


def test_forwarding_uses_fixed_path_and_secret(monkeypatch):
    response_data = JudgeResponse(
        status="accepted",
        passed_tests=1,
        total_tests=1,
        execution_time_ms=2,
        cases=[],
    ).model_dump_json().encode()
    upstream = JudgeUpstream("http://10.32.0.2:8000", _SECRET)
    seen = {}

    def open_request(request, timeout):
        seen["url"] = request.full_url
        seen["secret"] = request.get_header("X-judge-secret")
        seen["timeout"] = timeout
        seen["body"] = request.data
        return _Response(response_data)

    monkeypatch.setattr(upstream._opener, "open", open_request)
    result = upstream.judge(_judge_request())

    assert result.status == "accepted"
    assert seen["url"] == "http://10.32.0.2:8000/judge"
    assert seen["secret"] == _SECRET
    assert seen["timeout"] == 40
    assert b"print('ok')" in seen["body"]


def test_invalid_upstream_response_is_generic_failure(monkeypatch):
    upstream = JudgeUpstream("http://10.32.0.2:8000", _SECRET)
    monkeypatch.setattr(upstream._opener, "open", lambda *_args, **_kwargs: _Response(b"not json"))
    with pytest.raises(JudgeUpstreamUnavailable):
        upstream.judge(_judge_request())


def test_cloud_run_never_executes_locally(monkeypatch):
    monkeypatch.setattr(main, "_JUDGE_UPSTREAM", None)
    monkeypatch.setattr(main.settings, "JUDGE_HTTP_EXECUTION_ENABLED", True)
    monkeypatch.setenv("K_SERVICE", "koj-control-api")
    monkeypatch.setattr(main, "_judge_authorized", lambda _secret: True)
    monkeypatch.setattr(main, "_try_acquire_judge_slot", lambda: True)
    monkeypatch.setattr(main, "_release_judge_slot", lambda: None)
    monkeypatch.setattr(main, "execute_judge", lambda _request: pytest.fail("local execution called"))

    with pytest.raises(HTTPException) as exc_info:
        main.judge_endpoint(_judge_request(), "secret")

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "judge execution unavailable"


def test_async_enqueue_uses_shared_lock_and_global_cap(monkeypatch):
    executed = []

    class Cursor:
        def execute(self, query, params=()):
            executed.append((query, params))

        def fetchone(self):
            if len(executed) == 2:
                return ("pending",)
            if len(executed) == 3:
                return None
            if len(executed) == 4:
                return (500,)
            raise AssertionError("unexpected database read")

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Transaction:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Connection:
        def transaction(self):
            return Transaction()

        def cursor(self):
            return Cursor()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(main.db, "get_connection", Connection)
    monkeypatch.setattr(main, "_judge_authorized", lambda _secret: True)

    with pytest.raises(HTTPException) as exc_info:
        main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=7), "secret")

    assert exc_info.value.status_code == 503
    assert exc_info.value.headers == {"Retry-After": "5"}
    assert "pg_advisory_xact_lock(hashtext('koj:queue-admission'), 0)" in executed[0][0]
    assert "count(*) FROM judge_jobs WHERE status IN ('queued', 'leased')" in executed[3][0]
    assert not any("INSERT INTO judge_jobs" in query for query, _ in executed)
