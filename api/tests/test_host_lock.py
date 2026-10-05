from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import host_lock
from app.host_lock import HostExecutionLockError, host_execution_lock


class FakeLockFile:
    def __init__(self):
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.closed = True

    def fileno(self):
        return 123


def test_empty_lock_path_does_not_open_a_file(monkeypatch):
    def unexpected_open(*_args):
        raise AssertionError("empty lock path must not open a file")

    monkeypatch.setattr(host_lock, "open", unexpected_open, raising=False)
    with host_execution_lock(""):
        pass


def test_configured_lock_uses_nonblocking_exclusive_flock(monkeypatch):
    lock_file = FakeLockFile()
    calls = []
    monkeypatch.setattr(host_lock, "open", lambda *_args: lock_file, raising=False)
    monkeypatch.setattr(
        host_lock,
        "fcntl",
        SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *args: calls.append(args)),
    )

    with host_execution_lock("/configured/lock"):
        assert not lock_file.closed

    assert calls == [(123, 3)]
    assert lock_file.closed


def test_contention_fails_closed_and_closes_lock_file(monkeypatch):
    lock_file = FakeLockFile()

    def contended(*_args):
        raise BlockingIOError("busy")

    monkeypatch.setattr(host_lock, "open", lambda *_args: lock_file, raising=False)
    monkeypatch.setattr(
        host_lock,
        "fcntl",
        SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=contended),
    )

    with pytest.raises(HostExecutionLockError, match="unavailable"):
        with host_execution_lock("/configured/lock"):
            pass

    assert lock_file.closed


def test_wait_retries_nonblocking_lock_without_real_sleep(monkeypatch):
    lock_file = FakeLockFile()
    attempts = []
    sleeps = []

    def flock(*_args):
        attempts.append(True)
        if len(attempts) == 1:
            raise BlockingIOError("busy")

    monotonic_values = iter([10.0, 10.05])
    monkeypatch.setattr(host_lock, "open", lambda *_args: lock_file, raising=False)
    monkeypatch.setattr(
        host_lock,
        "fcntl",
        SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=flock),
    )
    monkeypatch.setattr(host_lock.time, "monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(host_lock.time, "sleep", sleeps.append)

    with host_execution_lock("/configured/lock", wait_seconds=0.3):
        pass

    assert len(attempts) == 2
    assert sleeps == [0.1]
    assert lock_file.closed


def test_wait_stops_at_deadline_and_closes_lock_file(monkeypatch):
    lock_file = FakeLockFile()
    monkeypatch.setattr(host_lock, "open", lambda *_args: lock_file, raising=False)
    monkeypatch.setattr(
        host_lock,
        "fcntl",
        SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *_args: (_ for _ in ()).throw(BlockingIOError("busy"))),
    )
    monotonic_values = iter([10.0, 10.2])
    monkeypatch.setattr(host_lock.time, "monotonic", lambda: next(monotonic_values))

    with pytest.raises(HostExecutionLockError, match="unavailable"):
        with host_execution_lock("/configured/lock", wait_seconds=0.1):
            pass

    assert lock_file.closed


def test_missing_lock_file_fails_closed_without_creating_directories(monkeypatch):
    def unavailable(*_args):
        raise FileNotFoundError("missing parent")

    monkeypatch.setattr(host_lock, "open", unavailable, raising=False)
    monkeypatch.setattr(
        host_lock,
        "fcntl",
        SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *_args: None),
    )

    with pytest.raises(HostExecutionLockError, match="cannot open"):
        with host_execution_lock("/missing/parent/execution.lock"):
            pass
