"""Judge HTTP boundary rejects unauthenticated bodies before reading them."""

from __future__ import annotations

import asyncio

from app import main
from app.config import settings


def test_unauthorized_judge_body_is_not_read():
    received = []
    sent = []

    async def app(_scope, _receive, _send):
        raise AssertionError("handler should not run")

    async def receive():
        received.append(True)
        raise AssertionError("body should not be read")

    async def send(message):
        sent.append(message)

    middleware = main._BodySizeLimitMiddleware(app, 1024, ("/judge",))
    scope = {"type": "http", "path": "/judge", "headers": []}
    asyncio.run(middleware(scope, receive, send))

    assert not received
    assert sent[0]["status"] == 401


def test_disconnected_judge_request_stops_receiving():
    sent = []

    async def app(_scope, _receive, _send):
        raise AssertionError("handler should not run")

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    middleware = main._BodySizeLimitMiddleware(app, 1024, ("/judge",))
    scope = {"type": "http", "path": "/judge", "headers": [(b"x-judge-secret", b"test")]}
    asyncio.run(middleware(scope, receive, send))

    assert not sent


def test_unauthorized_research_body_is_rejected_before_reading(monkeypatch):
    received = []
    sent = []

    async def app(_scope, _receive, _send):
        raise AssertionError("handler should not run")

    async def receive():
        received.append(True)
        raise AssertionError("body should not be read")

    async def send(message):
        sent.append(message)

    monkeypatch.setattr(settings, "TRAINING_API_SECRET", "a" * 40)
    middleware = main._BodySizeLimitMiddleware(app, 1024, ("/v1/research/runs",))
    scope = {"type": "http", "path": "/v1/research/runs", "headers": []}
    asyncio.run(middleware(scope, receive, send))

    assert not received
    assert sent[0]["status"] == 401


def test_authorized_research_body_does_not_require_judge_secret(monkeypatch):
    received = []
    sent = []

    async def app(_scope, receive, send):
        message = await receive()
        received.append(message["body"])
        await send({"type": "http.response.start", "status": 202, "headers": []})

    async def receive():
        return {"type": "http.request", "body": b'{"ok":true}', "more_body": False}

    async def send(message):
        sent.append(message)

    monkeypatch.setattr(settings, "TRAINING_API_SECRET", "a" * 40)
    monkeypatch.setattr(settings, "TRAINING_OIDC_AUDIENCE", "https://research.example.test")
    monkeypatch.setattr(settings, "TRAINING_OIDC_PRINCIPAL", "gpu@example.iam.gserviceaccount.com")
    from app import research

    monkeypatch.setattr(research, "_verify_oidc_token", lambda authorization: authorization == "Bearer token")
    middleware = main._BodySizeLimitMiddleware(app, 1024, ("/v1/research/runs",))
    scope = {
        "type": "http",
        "path": "/v1/research/runs",
        "headers": [(b"x-training-secret", b"a" * 40), (b"authorization", b"Bearer token")],
    }
    asyncio.run(middleware(scope, receive, send))

    assert received == [b'{"ok":true}']
    assert sent[0]["status"] == 202


def test_public_health_does_not_query_database(monkeypatch):
    monkeypatch.setattr(main.db, "ping", lambda: (_ for _ in ()).throw(AssertionError("database access")))
    response = main.health()
    assert response.status_code == 200
    assert main.app.openapi_url is None
