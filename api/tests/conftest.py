"""Pytest configuration: seed dummy env BEFORE any app imports.

judge.py imports config.settings at module level via `from .config import settings`,
and pydantic-settings reads DATABASE_URL at import time. Setting dummy env vars here
(a conftest is loaded before test collection) ensures the import succeeds without
requiring a real Postgres instance.
"""

from __future__ import annotations

import os
import sys

# Required by pydantic-settings — judge.py imports config.settings at module level.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("JUDGE_INTERNAL_SECRET", "test")
os.environ.setdefault("JUDGE_SANDBOX_MODE", "rlimit")

# Ensure the api package is importable when running from the repo root or api/.
_api_dir = os.path.join(os.path.dirname(__file__), os.pardir)
if _api_dir not in sys.path:
    sys.path.insert(0, os.path.abspath(_api_dir))
