"""Hermetic bounds for test-case loading in queue workers."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app import queue


def _submission_row():
    return (
        9,
        "python",
        "print('ok')",
        "submit",
        1000,
        256,
        "exact",
        0.000001,
        0.000001,
        None,
        datetime.now(timezone.utc),
    )


class _Cursor:
    def __init__(self, case_count: int, case_bytes: int, case_rows=()):
        self.case_count = case_count
        self.case_bytes = case_bytes
        self.case_rows = list(case_rows)
        self.queries = []
        self.current_query = ""

    def execute(self, query, params=()):
        self.current_query = query
        self.queries.append((query, params))

    def fetchone(self):
        if "SELECT s.problem_id" in self.current_query:
            return _submission_row()
        if "SELECT count(*)" in self.current_query:
            return (self.case_count, self.case_bytes)
        raise AssertionError("unexpected database read")

    def fetchall(self):
        if "SELECT input, expected_output" not in self.current_query:
            raise AssertionError("test content was fetched before the bounds query")
        return self.case_rows

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Transaction:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def transaction(self):
        return _Transaction()

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


@pytest.mark.parametrize(
    ("case_count", "case_bytes"),
    [
        (101, 0),
        (1, 16 * 1024 * 1024 + 1),
    ],
)
def test_load_submission_rejects_oversized_dataset_before_fetching_contents(
    monkeypatch,
    case_count,
    case_bytes,
):
    cursor = _Cursor(case_count, case_bytes)
    monkeypatch.setattr(queue.db, "get_connection", lambda: _Connection(cursor))

    with pytest.raises(queue.SubmissionConfigurationError, match="problem test set exceeds judge limits"):
        queue.load_submission(12)

    assert any("SELECT count(*)" in query for query, _ in cursor.queries)
    assert not any("SELECT input, expected_output" in query for query, _ in cursor.queries)


def test_load_submission_fetches_bounded_case_rows_after_preflight(monkeypatch):
    cursor = _Cursor(1, 3, [("a", "b", True)])
    monkeypatch.setattr(queue.db, "get_connection", lambda: _Connection(cursor))

    loaded = queue.load_submission(12)

    assert loaded is not None
    assert loaded.cases[0].stdin == "a"
    assert loaded.cases[0].expected_stdout == "b"
    case_query = next(query for query, _ in cursor.queries if "SELECT input, expected_output" in query)
    assert "LIMIT 101" in case_query
    assert cursor.queries.index(next(item for item in cursor.queries if "SELECT count(*)" in item[0])) < cursor.queries.index(
        next(item for item in cursor.queries if "SELECT input, expected_output" in item[0])
    )


def test_load_submission_rechecks_actual_rows_with_generic_error(monkeypatch):
    cursor = _Cursor(1, 1, [("x" * (16 * 1024 * 1024 + 1), "", False)])
    monkeypatch.setattr(queue.db, "get_connection", lambda: _Connection(cursor))

    with pytest.raises(queue.SubmissionConfigurationError, match="problem test set exceeds judge limits"):
        queue.load_submission(12)
