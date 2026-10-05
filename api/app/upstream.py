"""Trusted HTTP forwarding to the isolated judge host."""

from __future__ import annotations

import ipaddress
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .judge import JudgeRequest, JudgeResponse

_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_UPSTREAM_TIMEOUT_SECONDS = 40
_PRIVATE_JUDGE_NETWORK = ipaddress.ip_network("10.32.0.0/24")
_SECRET_PATTERN = re.compile(r"[0-9a-fA-F]{64}\Z")


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _validated_origin(url: str) -> str:
    parts = urlsplit(url)
    if (
        parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
        or "?" in url
        or "#" in url
        or not parts.hostname
    ):
        raise ValueError("invalid judge upstream origin")

    try:
        address = ipaddress.ip_address(parts.hostname)
    except ValueError:
        address = None

    if parts.scheme == "http":
        if address is None or address not in _PRIVATE_JUDGE_NETWORK:
            raise ValueError("plain HTTP is allowed only for the private judge subnet")
    elif parts.scheme != "https":
        raise ValueError("judge upstream must use HTTPS")

    try:
        port = parts.port
    except ValueError as exc:
        raise ValueError("invalid judge upstream port") from exc
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("invalid judge upstream port")

    return urlunsplit((parts.scheme, parts.netloc, "", "", "")).rstrip("/")


class JudgeUpstream:
    def __init__(self, url: str, secret: str) -> None:
        self.origin = _validated_origin(url)
        if not _SECRET_PATTERN.fullmatch(secret):
            raise ValueError("judge upstream secret must be 32-byte hex")
        self.secret = secret
        self._opener = build_opener(_NoRedirectHandler())

    def judge(self, request: JudgeRequest) -> JudgeResponse:
        body = request.model_dump_json().encode("utf-8")
        http_request = Request(
            f"{self.origin}/judge",
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Judge-Secret": self.secret,
            },
            method="POST",
        )
        try:
            with self._opener.open(http_request, timeout=_UPSTREAM_TIMEOUT_SECONDS) as response:
                payload = response.read(_MAX_RESPONSE_BYTES + 1)
            if len(payload) > _MAX_RESPONSE_BYTES:
                raise ValueError("judge response exceeds limit")
            return JudgeResponse.model_validate(json.loads(payload))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
            raise JudgeUpstreamUnavailable from None

    def ready(self) -> bool:
        request = Request(
            f"{self.origin}/ready",
            headers={"Accept": "application/json", "X-Judge-Secret": self.secret},
            method="GET",
        )
        try:
            with self._opener.open(request, timeout=5) as response:
                payload = response.read(65_537)
            if len(payload) > 65_536:
                return False
            data = json.loads(payload)
            return response.status == 200 and data.get("status") == "ok"
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError, AttributeError):
            return False


class JudgeUpstreamUnavailable(Exception):
    """The trusted judge host did not return a valid response."""
