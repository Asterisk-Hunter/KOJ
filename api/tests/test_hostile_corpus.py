"""Adversarial corpus for the host-toolchain rlimit backend.

Each case runs a hostile program through `execute_judge` in rlimit mode and
pins the verdict the backend must produce. Non-Python cases skip when their
toolchain is absent; Python cases always run where the backend exists. No
containers, network egress, or database are involved.

rlimit mode does not isolate the filesystem or the network (docs/context.md),
so the escape cases below pin that documented limitation — they are expected
to succeed inside the sandbox. When a real isolation backend lands, they flip
to denial and this file is where that becomes visible.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass

import pytest

from app.config import settings
from app.judge import JudgeCase, JudgeRequest, JudgeResponse, execute_judge

try:
    import resource  # noqa: F401  # POSIX-only, like the rlimit backend itself
except ImportError:  # pragma: no cover - Windows dev hosts only
    _HAS_RLIMIT = False
else:
    _HAS_RLIMIT = True

pytestmark = pytest.mark.skipif(
    not _HAS_RLIMIT,
    reason="rlimit sandbox requires POSIX resource limits",
)

_TOOLCHAIN = {
    "c": "gcc",
    "c++": "g++",
    "java": "javac",
    "go": "go",
    "rust": "rustc",
    "javascript": "node",
}


@dataclass(frozen=True)
class HostileCase:
    name: str
    language: str
    code: str
    expected: str
    expected_stdout: str = ""
    memory_mb: int = 256
    time_limit_ms: int = 2000


_CASES = [
    # CPU burn: RLIMIT_CPU sends SIGXCPU at the soft limit.
    HostileCase(
        name="infinite_loop_python",
        language="python",
        code="while True:\n    pass\n",
        expected="time_limit_exceeded",
    ),
    # 1 MiB of combined output trips the reader and kills the process group.
    HostileCase(
        name="stdout_flood_python",
        language="python",
        code='while True:\n    print("x" * 1024)\n',
        expected="runtime_error",
    ),
    # RLIMIT_AS makes the allocation fail; CPython reports MemoryError.
    HostileCase(
        name="memory_bomb_python",
        language="python",
        code="blocks = []\nwhile True:\n    blocks.append(bytearray(8 * 1024 * 1024))\n",
        expected="memory_limit_exceeded",
    ),
    # RLIMIT_NPROC refuses further tasks; the parent must fail, not spin forever.
    HostileCase(
        name="fork_bomb_python",
        language="python",
        code="import os\n\ntry:\n    while True:\n        os.fork()\nexcept OSError:\n    raise SystemExit(42)\n",
        expected="runtime_error",
    ),
    # Documented gap: rlimit has no filesystem namespace.
    HostileCase(
        name="read_etc_passwd_python",
        language="python",
        code=(
            'try:\n'
            '    with open("/etc/passwd", encoding="utf-8") as handle:\n'
            '        print("read", bool(handle.read()))\n'
            'except OSError:\n'
            '    print("denied")\n'
        ),
        expected="accepted",
        expected_stdout="read True\n",
    ),
    # Documented gap: rlimit has no network namespace. Loopback keeps the case
    # hermetic while still exercising outbound connect/send/recv.
    HostileCase(
        name="loopback_egress_python",
        language="python",
        code=(
            "import socket\n\n"
            'with socket.socket() as server:\n'
            '    server.bind(("127.0.0.1", 0))\n'
            "    server.listen(1)\n"
            "    with socket.create_connection(server.getsockname()) as client:\n"
            "        connection, _ = server.accept()\n"
            '        connection.sendall(b"ok")\n'
            "        print(client.recv(2).decode())\n"
            "        connection.close()\n"
        ),
        expected="accepted",
        expected_stdout="ok\n",
    ),
    # Documented gap: rlimit caps a single file's growth, not its path.
    HostileCase(
        name="write_outside_workdir_python",
        language="python",
        code=(
            "from pathlib import Path\n\n"
            'target = Path("..") / "koj-rlimit-escape.txt"\n'
            'target.write_text("escaped", encoding="utf-8")\n'
            "target.unlink()\n"
            'print("escaped")\n'
        ),
        expected="accepted",
        expected_stdout="escaped\n",
    ),
    HostileCase(
        name="fork_bomb_c",
        language="c",
        code="#include <unistd.h>\nint main(void) { for (;;) { if (fork() < 0) return 42; } }\n",
        expected="runtime_error",
    ),
    HostileCase(
        name="infinite_loop_cpp",
        language="c++",
        code="int main() { for (;;) {} }\n",
        expected="time_limit_exceeded",
    ),
    HostileCase(
        name="stdout_flood_javascript",
        language="javascript",
        code='for (;;) { process.stdout.write("x".repeat(4096)); }\n',
        expected="runtime_error",
    ),
    HostileCase(
        name="infinite_loop_java",
        language="java",
        code="public class Solution { public static void main(String[] args) { while (true) {} } }\n",
        expected="time_limit_exceeded",
    ),
    HostileCase(
        name="infinite_loop_go",
        language="go",
        code="package main\n\nfunc main() { for {} }\n",
        expected="time_limit_exceeded",
    ),
    HostileCase(
        name="infinite_loop_rust",
        language="rust",
        code="fn main() { loop {} }\n",
        expected="time_limit_exceeded",
    ),
]


def _case_param(case: HostileCase) -> pytest.ParameterSet:
    binary = _TOOLCHAIN.get(case.language)
    marks = (
        pytest.mark.skipif(shutil.which(binary) is None, reason=f"{binary} toolchain not installed")
        if binary
        else []
    )
    return pytest.param(case, id=case.name, marks=marks)


@pytest.fixture(autouse=True)
def use_rlimit_backend(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_SANDBOX_MODE", "rlimit")


@pytest.mark.parametrize("case", [_case_param(case) for case in _CASES])
def test_hostile_case_matches_its_expected_verdict(case: HostileCase):
    response: JudgeResponse = execute_judge(
        JudgeRequest(
            language=case.language,
            code=case.code,
            cases=[JudgeCase(stdin="", expected_stdout=case.expected_stdout, is_sample=True)],
            time_limit_ms=case.time_limit_ms,
            memory_mb=case.memory_mb,
        )
    )

    assert response.infra_error is False, response.error_message
    assert response.status == case.expected, response.cases[0].stderr
    assert response.passed_tests == (1 if case.expected == "accepted" else 0)
