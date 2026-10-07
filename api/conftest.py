"""Synthetic settings and database guards shared by unit and integration tests."""

from __future__ import annotations

import os
from pathlib import Path
import sys
from unittest.mock import patch

import pytest

_api_dir = str(Path(__file__).parent)
if _api_dir not in sys.path:
    sys.path.insert(0, _api_dir)

# Collection must not read a developer's .env or inherit production credentials.
with (
    patch.dict(os.environ, {
        "DATABASE_URL": "postgresql://test:test@localhost/test",
        "JUDGE_INTERNAL_SECRET": "test",
        "JUDGE_SANDBOX_MODE": "rlimit",
    }, clear=True),
    patch("pydantic_settings.sources.DotEnvSettingsSource._read_env_files", return_value={}),
):
    from app.config import settings


@pytest.fixture(autouse=True)
def forbid_database_connections(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError("Tests must mock database access")

    monkeypatch.setattr("psycopg.connect", forbidden)
    monkeypatch.setattr("psycopg.Connection.connect", forbidden)


def pytest_collection_modifyitems(items):
    if sys.platform == "win32":
        marker = pytest.mark.skip(reason="Linux integration requires POSIX resource limits")
        for item in items:
            if item.get_closest_marker("integration") is not None:
                item.add_marker(marker)
