"""Hermetic coverage for the FastAPI entrypoint guards and endpoints."""

from __future__ import annotations

import asyncio
import types

import pytest
from fastapi import HTTPException

from app import main, research
from app.config import settings
from app.judge import JudgeCase, JudgeRequest, JudgeResponse
from app.upstream import JudgeUpstreamUnavailable


class _Cursor:
    def __init__(self, fetchone_rows=()):
        self.fetchone_rows = list(fetchone_rows)
        self.queries = []

    def execute(self, query, params=()):
        self.queries.append((query, params))

    def fetchone(self):
        assert self.fetchone_rows, "unexpected extra fetchone"
        return self.fetchone_rows.pop(0)

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


class _Semaphore:
    def __init__(self, allow=True):
        self.allow = allow
        self.released = 0

    def acquire(self, blocking=False):
        return self.allow

    def release(self):
        self.released += 1


class _Recorder:
    def __init__(self, value=True):
        self.calls = []
        self.value = value

    def __call__(self, *args):
        self.calls.append(args)
        return self.value


def _judge_request(language="python"):
    return JudgeRequest(
        language=language,
        code="print(1)",
        cases=[JudgeCase(stdin="", expected_stdout="1\n", is_sample=True)],
        time_limit_ms=1000,
        memory_mb=64,
    )


def _judge_response():
    return JudgeResponse(status="accepted", passed_tests=1, total_tests=1, execution_time_ms=3, cases=[])


def test_judge_authorized_requires_matching_secrets(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    assert main._judge_authorized("s3cret") is True
    assert main._judge_authorized("other") is False
    assert main._judge_authorized(None) is False
    assert main._judge_authorized("") is False

    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "")
    assert main._judge_authorized("s3cret") is False


def test_saturated_carries_a_retry_after_header():
    error = main._saturated()
    assert error.status_code == 503
    assert error.headers == {"Retry-After": str(main._JUDGE_SATURATED_RETRY_AFTER_S)}


def test_judge_slot_helpers_survive_broken_semaphores(monkeypatch):
    monkeypatch.setattr(main, "_JUDGE_SEMAPHORE", _Semaphore(allow=True))
    assert main._try_acquire_judge_slot() is True
    main._release_judge_slot()
    assert main._JUDGE_SEMAPHORE.released == 1

    def broken_acquire(blocking=False):
        raise RuntimeError("semaphore destroyed")

    class BrokenRelease:
        def release(self):
            raise RuntimeError("semaphore destroyed")

    monkeypatch.setattr(main, "_JUDGE_SEMAPHORE", types.SimpleNamespace(acquire=broken_acquire))
    assert main._try_acquire_judge_slot() is False

    monkeypatch.setattr(main, "_JUDGE_SEMAPHORE", BrokenRelease())
    main._release_judge_slot()

    class OverReleased:
        def release(self):
            raise ValueError("semaphore released too many times")

    monkeypatch.setattr(main, "_JUDGE_SEMAPHORE", OverReleased())
    main._release_judge_slot()

    monkeypatch.setattr(main, "_JUDGE_SEMAPHORE", _Semaphore(allow=False))
    main._release_judge_slot()


def test_root_and_health_do_not_touch_dependencies(monkeypatch):
    monkeypatch.setattr(main.db, "ping", _Recorder(value=False))
    assert main.root() == {"service": "koj-api"}
    assert main.health().body == b'{"status":"ok"}'


@pytest.mark.parametrize(
    ("db_ok", "upstream", "local_execution", "expected_status"),
    [
        (True, _Recorder(value=False), True, 200),
        (False, _Recorder(value=False), True, 503),
        (True, _Recorder(value=False), False, 503),
    ],
)
def test_ready_reports_database_and_execution_state(
    monkeypatch, db_ok, upstream, local_execution, expected_status
):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(settings, "JUDGE_HTTP_EXECUTION_ENABLED", local_execution)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.setattr(main.db, "ping", lambda: db_ok)
    monkeypatch.setattr(main, "_JUDGE_UPSTREAM", None)
    monkeypatch.setattr(main, "resolve_sandbox_backend", lambda: "rlimit")

    response = main.ready(x_judge_secret="s3cret")

    assert response.status_code == expected_status
    assert b'"db":' in response.body


def test_ready_uses_the_upstream_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(main.db, "ping", lambda: True)
    monkeypatch.setattr(main, "_JUDGE_UPSTREAM", types.SimpleNamespace(ready=lambda: True))
    monkeypatch.setattr(main, "resolve_sandbox_backend", lambda: "cloudrun")

    assert main.ready(x_judge_secret="s3cret").status_code == 200


def test_ready_rejects_unauthenticated_probes(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    with pytest.raises(HTTPException) as error:
        main.ready(x_judge_secret="wrong")
    assert error.value.status_code == 401


def test_judge_endpoint_rejects_missing_configuration(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "")
    with pytest.raises(HTTPException) as error:
        main.judge_endpoint(_judge_request(), x_judge_secret=None)
    assert error.value.status_code == 500

    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    with pytest.raises(HTTPException) as error:
        main.judge_endpoint(_judge_request(), x_judge_secret="wrong")
    assert error.value.status_code == 401


def test_judge_endpoint_rejects_unsupported_languages(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    with pytest.raises(HTTPException) as error:
        main.judge_endpoint(_judge_request(language="brainfuck"), x_judge_secret="s3cret")
    assert error.value.status_code == 422
    assert "supported languages" in error.value.detail


def test_judge_endpoint_reports_saturation(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(main, "_try_acquire_judge_slot", lambda: False)
    with pytest.raises(HTTPException) as error:
        main.judge_endpoint(_judge_request(), x_judge_secret="s3cret")
    assert error.value.status_code == 503


def test_judge_endpoint_runs_locally_when_execution_is_enabled(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(settings, "JUDGE_HTTP_EXECUTION_ENABLED", True)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.setattr(main, "_JUDGE_UPSTREAM", None)
    monkeypatch.setattr(main, "execute_judge", lambda _req: _judge_response())

    assert main.judge_endpoint(_judge_request(), x_judge_secret="s3cret").status == "accepted"


def test_judge_endpoint_refuses_to_execute_on_cloud_run(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(settings, "JUDGE_HTTP_EXECUTION_ENABLED", True)
    monkeypatch.setenv("K_SERVICE", "koj-api")
    monkeypatch.setattr(main, "_JUDGE_UPSTREAM", None)

    with pytest.raises(HTTPException) as error:
        main.judge_endpoint(_judge_request(), x_judge_secret="s3cret")
    assert error.value.status_code == 503


def test_judge_endpoint_delegates_to_the_upstream(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(
        main, "_JUDGE_UPSTREAM", types.SimpleNamespace(judge=lambda _req: _judge_response())
    )
    assert main.judge_endpoint(_judge_request(), x_judge_secret="s3cret").status == "accepted"

    def unavailable(_req):
        raise JudgeUpstreamUnavailable("no executor")

    monkeypatch.setattr(main, "_JUDGE_UPSTREAM", types.SimpleNamespace(judge=unavailable))
    with pytest.raises(HTTPException) as error:
        main.judge_endpoint(_judge_request(), x_judge_secret="s3cret")
    assert error.value.status_code == 503


def _enqueue(monkeypatch, fetchone_rows):
    cursor = _Cursor(fetchone_rows)
    monkeypatch.setattr(main.db, "get_connection", lambda: _Connection(cursor))
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    semaphore = _Semaphore()
    monkeypatch.setattr(main, "_ENQUEUE_SEMAPHORE", semaphore)
    return cursor, semaphore


def test_judge_async_guards(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "")
    with pytest.raises(HTTPException) as error:
        main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=5), x_judge_secret=None)
    assert error.value.status_code == 500

    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    with pytest.raises(HTTPException) as error:
        main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=5), x_judge_secret="wrong")
    assert error.value.status_code == 401

    semaphore = _Semaphore(allow=False)
    monkeypatch.setattr(main, "_ENQUEUE_SEMAPHORE", semaphore)
    with pytest.raises(HTTPException) as error:
        main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=5), x_judge_secret="s3cret")
    assert error.value.status_code == 503
    assert semaphore.released == 0


def test_judge_async_queues_a_pending_submission(monkeypatch):
    cursor, semaphore = _enqueue(monkeypatch, [("pending",), None, (3,)])

    response = main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=5), x_judge_secret="s3cret")

    assert response.status_code == 202
    assert b'"queued":true' in response.body
    assert semaphore.released == 1
    assert "SELECT pg_advisory_xact_lock" in cursor.queries[0][0]
    assert "INSERT INTO judge_jobs" in cursor.queries[-1][0]


def test_judge_async_reports_missing_submissions(monkeypatch):
    _cursor, semaphore = _enqueue(monkeypatch, [None])

    with pytest.raises(HTTPException) as error:
        main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=5), x_judge_secret="s3cret")
    assert error.value.status_code == 404
    assert semaphore.released == 1


@pytest.mark.parametrize("status", ["accepted", "wrong_answer"])
def test_judge_async_dedupes_terminal_submissions(monkeypatch, status):
    _enqueue(monkeypatch, [(status,)])

    response = main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=5), x_judge_secret="s3cret")

    assert response.status_code == 200
    assert b'"deduped":true' in response.body


def test_judge_async_dedupes_existing_jobs(monkeypatch):
    _enqueue(monkeypatch, [("pending",), ("leased",)])

    response = main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=5), x_judge_secret="s3cret")

    assert response.status_code == 200
    assert b'"leased"' in response.body


def test_judge_async_backs_off_when_the_queue_is_full(monkeypatch):
    _cursor, semaphore = _enqueue(monkeypatch, [("pending",), None, (main._GLOBAL_ACTIVE_JOB_LIMIT,)])

    with pytest.raises(HTTPException) as error:
        main.judge_async_endpoint(main.JudgeAsyncRequest(submission_id=5), x_judge_secret="s3cret")
    assert error.value.status_code == 503
    assert semaphore.released == 1


class _Send:
    def __init__(self):
        self.messages = []

    async def __call__(self, message):
        self.messages.append(message)

    @property
    def status(self):
        return next(m["status"] for m in self.messages if m["type"] == "http.response.start")


class _BodyApp:
    def __init__(self):
        self.scopes = []
        self.bodies = []

    async def __call__(self, scope, receive, send):
        self.scopes.append(scope)
        message = await receive()
        self.bodies.append(message.get("body", b""))
        await send({"type": "http.response.start", "status": 204, "headers": []})


def _call_middleware(middleware, scope, messages):
    sent = _Send()
    pending = list(messages)

    async def receive():
        return pending.pop(0)

    asyncio.run(middleware(scope, receive, sent))
    return sent


def _judge_scope(path="/judge", secret=b"s3cret"):
    headers = [(b"x-judge-secret", secret)] if secret is not None else []
    return {"type": "http", "path": path, "headers": headers}


def _research_scope(secret=b"train", authorization=b"Bearer token"):
    headers = []
    if secret is not None:
        headers.append((b"x-training-secret", secret))
    if authorization is not None:
        headers.append((b"authorization", authorization))
    return {"type": "http", "path": "/v1/research/runs", "headers": headers}


def _body(body, more_body=False):
    return {"type": "http.request", "body": body, "more_body": more_body}


def test_body_limit_passes_through_other_requests(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    app = _BodyApp()
    middleware = main._BodySizeLimitMiddleware(app, max_bytes=8, paths=main._JUDGE_BODY_PATHS)

    _call_middleware(middleware, {"type": "lifespan"}, [_body(b"ignored")])
    _call_middleware(middleware, _judge_scope(path="/health"), [_body(b"ignored")])

    assert len(app.scopes) == 2


def test_body_limit_requires_the_judge_secret(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    app = _BodyApp()
    middleware = main._BodySizeLimitMiddleware(app, max_bytes=64, paths=main._JUDGE_BODY_PATHS)

    assert _call_middleware(middleware, _judge_scope(secret=None), [_body(b"{}")]).status == 401
    assert app.scopes == []


def test_body_limit_rejects_oversized_declared_and_streamed_bodies(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    app = _BodyApp()
    middleware = main._BodySizeLimitMiddleware(app, max_bytes=3, paths=main._JUDGE_BODY_PATHS)
    declared = _judge_scope()
    declared["headers"].append((b"content-length", b"99"))
    assert _call_middleware(middleware, declared, [_body(b"x")]).status == 413

    streamed = _call_middleware(middleware, _judge_scope(), [_body(b"xx", more_body=True), _body(b"yy")])
    assert streamed.status == 413
    assert app.scopes == []


def test_body_limit_abandons_disconnected_requests(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    app = _BodyApp()
    middleware = main._BodySizeLimitMiddleware(app, max_bytes=64, paths=main._JUDGE_BODY_PATHS)

    sent = _call_middleware(middleware, _judge_scope(), [{"type": "http.disconnect"}])

    assert sent.messages == []
    assert app.scopes == []


def test_body_limit_replays_the_buffered_body_and_tolerates_bad_headers(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    app = _BodyApp()
    middleware = main._BodySizeLimitMiddleware(app, max_bytes=64, paths=main._JUDGE_BODY_PATHS)
    scope = _judge_scope()
    scope["headers"].append((b"content-length", b"not-a-number"))

    sent = _call_middleware(middleware, scope, [{"type": "http.nonsense"}, _body(b"{}")])

    assert sent.status == 204
    assert app.bodies == [b"{}"]


def test_research_body_limit_enforces_secret_and_oidc(monkeypatch):
    app = _BodyApp()
    middleware = main._BodySizeLimitMiddleware(app, max_bytes=64, paths=("/v1/research/runs",))

    monkeypatch.setattr(settings, "TRAINING_API_SECRET", "")
    assert _call_middleware(middleware, _research_scope(), [_body(b"{}")]).status == 503

    monkeypatch.setattr(settings, "TRAINING_API_SECRET", "train")
    assert _call_middleware(middleware, _research_scope(secret=None), [_body(b"{}")]).status == 401

    monkeypatch.setattr(research, "_verify_oidc_token", lambda _header: False)
    assert _call_middleware(middleware, _research_scope(), [_body(b"{}")]).status == 401

    monkeypatch.setattr(research, "_verify_oidc_token", lambda _header: True)
    assert _call_middleware(middleware, _research_scope(), [_body(b"{}")]).status == 204


class _Thread:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.started = False

    def start(self):
        self.started = True


def test_lifespan_requires_the_judge_secret(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "")

    async def enter():
        async with main.lifespan(None):
            pass

    with pytest.raises(RuntimeError, match="JUDGE_INTERNAL_SECRET is not configured"):
        asyncio.run(enter())


def test_lifespan_degrades_and_closes_the_pool(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(main.db, "init_pool", lambda: (_ for _ in ()).throw(RuntimeError("dsn rejected")))
    closed = _Recorder()
    monkeypatch.setattr(main.db, "close_pool", closed)
    monkeypatch.setattr(main, "warm_go_cache", lambda: None)
    threads = []
    monkeypatch.setattr(
        main, "threading", types.SimpleNamespace(Thread=lambda **kwargs: _spawn(threads, kwargs))
    )

    async def enter():
        async with main.lifespan(None):
            pass

    asyncio.run(enter())

    assert closed.calls == [()]
    assert threads[0].started is True


def _spawn(threads, kwargs):
    thread = _Thread(**kwargs)
    threads.append(thread)
    return thread
