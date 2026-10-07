"""Safe, bounded probes for the guarantees and limits of rlimit mode."""

import json
import os
import sys
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

from app.judge import _LOCAL_FSIZE_BYTES, _local_run

pytestmark = pytest.mark.integration


def test_wall_timeout_kills_a_sleeping_process():
    with tempfile.TemporaryDirectory() as directory:
        started = time.monotonic()
        with pytest.raises(subprocess.TimeoutExpired):
            _local_run(
                None,
                Path(directory),
                [sys.executable, "-c", "import time; time.sleep(10)"],
                128,
                0.2,
            )

    assert time.monotonic() - started < 3


def test_file_growth_is_capped_in_the_temporary_workdir():
    with tempfile.TemporaryDirectory() as directory:
        result = _local_run(
            None,
            Path(directory),
            [
                sys.executable,
                "-c",
                "with open('flood.bin', 'wb') as f:\n while True: f.write(b'x' * 65536)",
            ],
            128,
            3,
        )
        file_size = (Path(directory) / "flood.bin").stat().st_size

    assert result.returncode != 0
    assert file_size <= _LOCAL_FSIZE_BYTES


def test_exited_leader_descendants_are_killed_and_reaped():
    # Children hold the output pipes open after their parent exits. A Python
    # worker running as PID 1 must reap them, not just send a group SIGKILL.
    code = (
        "import json, subprocess, sys\n"
        "children = [subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)']) for _ in range(3)]\n"
        "print(json.dumps([child.pid for child in children]), flush=True)\n"
    )
    with tempfile.TemporaryDirectory() as directory:
        for _ in range(4):
            result = _local_run(None, Path(directory), [sys.executable, "-c", code], 128, 3)
            assert result.returncode == 0
            for pid in json.loads(result.stdout):
                with pytest.raises(ChildProcessError):
                    os.waitpid(pid, os.WNOHANG)
                with pytest.raises(ProcessLookupError):
                    os.kill(pid, 0)
