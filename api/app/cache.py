"""Optional Redis cache for the FastAPI judge service.

Provides best-effort caching for verdict events and contest standings.
When REDIS_URL is unset, every function is a no-op — the service works
exactly as before (DB-only path).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .config import settings

logger = logging.getLogger(__name__)

_redis_client: Any = None
_initialised = False


def _get_client() -> Any:
    """Lazy-initialise a Redis connection from REDIS_URL.

    Returns None when REDIS_URL is unset or the redis package is missing.
    """
    global _redis_client, _initialised  # noqa: PLW0603
    if _initialised:
        return _redis_client
    _initialised = True
    url = settings.REDIS_URL
    if not url:
        return None
    try:
        import redis as redis_lib

        _redis_client = redis_lib.from_url(
            str(url),
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
        )
        _redis_client.ping()
        logger.info("Redis connected (%s)", url.split("@")[-1] if "@" in url else url)
        return _redis_client
    except Exception:  # noqa: BLE001
        logger.warning("Redis unavailable — falling back to DB-only path", exc_info=True)
        _redis_client = None
        return None


def publish_verdict(submission_id: int, payload: dict[str, Any]) -> None:
    """Publish a verdict event to Redis (best-effort, fire-and-forget).

    The key ``verdict:{submission_id}`` is set with a 60-second TTL so the
    Next.js SSE endpoint can pick it up without a DB round-trip.
    """
    client = _get_client()
    if client is None:
        return
    try:
        client.setex(f"verdict:{submission_id}", 60, json.dumps(payload))
    except Exception:  # noqa: BLE001
        logger.debug("Redis publish_verdict failed for %s", submission_id, exc_info=True)
