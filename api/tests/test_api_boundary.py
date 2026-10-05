"""Judge HTTP boundary rejects unauthenticated bodies before reading them."""

from __future__ import annotations

import asyncio

from app import main


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


def test_public_health_does_not_query_database(monkeypatch):
    monkeypatch.setattr(main.db, "ping", lambda: (_ for _ in ()).throw(AssertionError("database access")))
    response = main.health()
    assert response.status_code == 200
    assert main.app.openapi_url is None
