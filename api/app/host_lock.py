"""Optional cross-process serialization for host-wide judge execution."""

from __future__ import annotations

from contextlib import contextmanager
import time
from typing import Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover - non-POSIX hosts
    fcntl = None


class HostExecutionLockError(RuntimeError):
    """The configured host execution lock could not be acquired."""


@contextmanager
def host_execution_lock(path: str, wait_seconds: float = 0.0) -> Iterator[None]:
    if not path.strip():
        yield
        return
    if fcntl is None:
        raise HostExecutionLockError("flock is unavailable on this host")

    try:
        lock_file = open(path, "a+")
    except OSError as error:
        raise HostExecutionLockError("cannot open host execution lock") from error

    with lock_file:
        deadline = time.monotonic() + max(0.0, wait_seconds)
        try:
            while True:
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError as error:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise HostExecutionLockError("host execution lock is unavailable") from error
                    time.sleep(min(0.1, remaining))
        except OSError as error:
            raise HostExecutionLockError("host execution lock is unavailable") from error
        yield
