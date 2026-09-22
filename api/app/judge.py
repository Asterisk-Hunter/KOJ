"""Multi-language judge: sandboxed compile + per-case execution.

Supported v1 languages: python, c, c++, java (SRS REQ-JUDGE-02).

Two backends, selected by JUDGE_SANDBOX_MODE (see api/DEPLOYMENT_CONTRACT.md):

* `docker` — container sandbox. Requires a Docker daemon on the judge host;
  without it judging fails closed with `runtime_error` + `infra_error=True`
  so callers never blame the contestant.
* `rlimit` — host-toolchain sandbox using `resource.setrlimit` CPU/AS/NPROC/
  FSIZE caps, a wall-clock timeout, and a fresh process session per run. This
  is the isolation level the SRS sanctions (§2.5 constraint 3) and the only
  backend available on serverless hosts, which cannot run containers.
* `auto` (default) — docker when the CLI is present, otherwise rlimit.

Sandbox (fixed server-side flags, never user-controlled):
network none, read-only root, non-root user, cap-drop ALL,
no-new-privileges, repo-managed seccomp profile
(`api/seccomp-koj.json` provisioned to the daemon host path in
`JUDGE_SECCOMP_PROFILE`), pids/memory/swap/cpu limits, read-only
source mount at /sandbox plus a writable exec tmpfs at /scratch for
build artifacts, tmpfs /tmp (noexec), per-run timeout, --rm plus
forced `docker rm -f` cleanup on every timeout/exception path,
--pull never, and bounded stdout/stderr.
Images come only from env allow-list (see api/.env.example).

Logging: never log case stdin/expected/stdout/stderr. Uvicorn access
logging records method/path/status only (no request bodies); no code
here prints request bodies.
"""

from __future__ import annotations

import logging
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from .config import settings

try:
    import resource  # POSIX only; the rlimit backend is unavailable without it
except ImportError:  # pragma: no cover - Windows dev hosts only
    resource = None

logger = logging.getLogger("koj.judge")

SUPPORTED_LANGUAGES: tuple[str, ...] = (
    "python",
    "c",
    "c++",
    "java",
    "go",
    "rust",
    "javascript",
)
# Languages whose runtime reserves a large virtual address space (JVM, Go arena,
# V8 heap). RLIMIT_AS cannot express a memory limit for these: it would stop the
# process before the program starts, so their memory is bounded by a runtime flag
# instead (see _local_run_memory_mb and the run commands).
_LARGE_ADDRESS_SPACE_LANGUAGES: tuple[str, ...] = ("java", "go", "javascript")

COMPILE_TIMEOUT_S = 30.0

# Hardening constants (fixed, not user-controlled).
_DOCKER_TMPFS_TMP = "rw,noexec,nosuid,size=64m"
# Writable exec scratch for build artifacts and execution. Exec is
# required here (compiled binaries cannot run from noexec /tmp);
# size-bounded and cleared with the container (--rm).
_DOCKER_TMPFS_SCRATCH = "rw,nosuid,exec,size=256m"
_DOCKER_FSIZE_ULIMIT = "fsize=1048576:1048576"  # 1 MiB file writes: bounds runaway stdout
_DOCKER_NPROC_ULIMIT = "nproc=64:64"
_DOCKER_KILL_TIMEOUT_S = 5.0
# Compile gets a safe floor so small problem limits cannot OOM the
# toolchain; verdict timing/memory still use the request limits.
_COMPILE_MIN_CONTAINER_MB = 256
# Go and Rust compile trees (stdlib cache, codegen) need more container memory
# than the compile floor above; the container limit is their real ceiling.
_GO_RUST_COMPILE_MIN_CONTAINER_MB = 512
# Java floor: JVM needs headroom above the heap (Metaspace, code
# cache, stacks). Below this even hello-world OOMs and masks the
# real verdict.
_JAVA_MIN_CONTAINER_MB = 256
# C/C++ hardening that never rejects valid programs (no -Werror).
_C_HARDEN_FLAGS = [
    "-O2",
    "-std=c11",
    "-Wall",
    "-Wextra",
    "-fstack-protector-strong",
    "-D_FORTIFY_SOURCE=2",
    "-Wformat",
    "-Wformat-security",
]
_CXX_HARDEN_FLAGS = [
    "-O2",
    "-std=c++17",
    "-Wall",
    "-Wextra",
    "-fstack-protector-strong",
    "-D_FORTIFY_SOURCE=2",
    "-Wformat",
    "-Wformat-security",
]
# Robust Solution-class check (word-boundary; comment/string stripped
# in _java_has_solution_class so `// class Solution` cannot spoof it).
_JAVA_SOLUTION_CLASS_RE = re.compile(r"\bclass\s+Solution\b")

Verdict = Literal[
    "accepted",
    "wrong_answer",
    "time_limit_exceeded",
    "memory_limit_exceeded",
    "runtime_error",
    "compilation_error",
    "presentation_error",
]


class JudgeCase(BaseModel):
    stdin: str
    expected_stdout: str
    # True for sample cases (diagnostics preserved). Hidden cases
    # default False: stdout/stderr redacted in the response and never
    # logged. Callers may omit the field (backwards compatible).
    is_sample: bool = False


class JudgeRequest(BaseModel):
    language: str
    code: str
    cases: list[JudgeCase]
    time_limit_ms: int = Field(ge=1)
    memory_mb: int = Field(ge=1)


class CaseResult(BaseModel):
    index: int
    passed: bool
    verdict: Verdict
    runtime_ms: int
    stdout: str
    stderr: str


class JudgeResponse(BaseModel):
    status: Verdict
    passed_tests: int
    total_tests: int
    execution_time_ms: int
    error_message: str | None = None
    cases: list[CaseResult]
    # True when the verdict reflects judge infrastructure failure
    # (sandbox unavailable), NOT contestant code. Callers must check
    # this before blaming the submission.
    infra_error: bool = False


class SandboxUnavailable(RuntimeError):
    """Raised when the Docker sandbox cannot run. Maps to runtime_error."""


def _truncate(s: str, limit: int) -> str:
    if len(s) <= limit:
        return s
    return s[:limit]


def _normalize_output(s: str) -> list[str]:
    # Split into lines, rstrip each line, drop trailing empty lines
    lines = s.splitlines()
    stripped = [line.rstrip() for line in lines]
    # Drop trailing empty lines
    while stripped and stripped[-1] == "":
        stripped.pop()
    return stripped


def _outputs_equal(actual: str, expected: str) -> bool:
    return _normalize_output(actual) == _normalize_output(expected)


def _whitespace_only_diff(actual: str, expected: str) -> bool:
    # True when outputs match after removing ALL whitespace: the program is
    # logically correct but formatted wrong -> presentation_error (REQ-JUDGE-11)
    strip = lambda s: "".join(s.split())
    return strip(actual) == strip(expected) and not _outputs_equal(actual, expected)


def _ce_response(message: str, total: int, is_sample_list: list[bool] | None = None) -> JudgeResponse:
    msg = _truncate(message, 2048)
    cases = [
        _visible_case(
            index=idx,
            passed=False,
            verdict="compilation_error",
            runtime_ms=0,
            stdout="",
            # Compile diagnostics are identical for every case (never
            # test-specific), so samples keep them while hidden cases
            # redact per the hidden-test policy.
            stderr=msg,
            is_sample=(is_sample_list[idx] if is_sample_list and idx < len(is_sample_list) else False),
        )
        for idx in range(total)
    ]
    return JudgeResponse(
        status="compilation_error",
        passed_tests=0,
        total_tests=total,
        execution_time_ms=0,
        error_message=msg,
        cases=cases,
    )


def _sandbox_unavailable_response(message: str, total: int) -> JudgeResponse:
    """Fail-closed verdict when Docker cannot run. Always runtime_error + infra_error."""
    msg = _truncate(f"judge sandbox unavailable: {message}", 2048)
    cases = [
        CaseResult(
            index=idx,
            passed=False,
            verdict="runtime_error",
            runtime_ms=0,
            stdout="",
            stderr=_truncate(msg, 4096),
        )
        for idx in range(total)
    ]
    return JudgeResponse(
        status="runtime_error",
        passed_tests=0,
        total_tests=total,
        execution_time_ms=0,
        error_message=msg,
        cases=cases,
        infra_error=True,
    )


def _visible_case(
    index: int,
    passed: bool,
    verdict: Verdict,
    runtime_ms: int,
    stdout: str,
    stderr: str,
    is_sample: bool,
) -> CaseResult:
    """Build a CaseResult with hidden-test redaction.

    Sample cases keep truncated diagnostics; hidden cases redact
    stdout/stderr (never leak program output tied to secret inputs).
    Verdict/passed/runtime are always preserved for scoring.
    """
    if is_sample:
        return CaseResult(
            index=index,
            passed=passed,
            verdict=verdict,
            runtime_ms=runtime_ms,
            stdout=_truncate(stdout, 4096),
            stderr=_truncate(stderr, 4096),
        )
    return CaseResult(
        index=index,
        passed=passed,
        verdict=verdict,
        runtime_ms=runtime_ms,
        stdout="",
        stderr="",
    )


def _cleanup_container(container_name: str) -> None:
    """Best-effort `docker rm -f`. Never raises; logs failures only."""
    try:
        proc = subprocess.run(
            ["docker", "rm", "-f", container_name],
            capture_output=True,
            text=True,
            timeout=_DOCKER_KILL_TIMEOUT_S,
        )
        if proc.returncode != 0:
            logger.warning(
                "judge cleanup rm -f %s failed: %s",
                container_name,
                _truncate((proc.stderr or "").strip(), 500),
            )
    except Exception as e:  # noqa: BLE001 — cleanup must never mask the original error
        logger.warning("judge cleanup rm -f %s error: %s", container_name, _truncate(str(e), 500))


def _image_for(language: str) -> str:
    if language == "python":
        return settings.JUDGE_DOCKER_IMAGE_PYTHON
    if language in ("c", "c++"):
        return settings.JUDGE_DOCKER_IMAGE_GCC
    if language == "java":
        return settings.JUDGE_DOCKER_IMAGE_JAVA
    if language == "go":
        return settings.JUDGE_DOCKER_IMAGE_GO
    if language == "rust":
        return settings.JUDGE_DOCKER_IMAGE_RUST
    if language == "javascript":
        return settings.JUDGE_DOCKER_IMAGE_NODE
    raise ValueError("Unsupported language")


def _clamp_memory_mb(requested: int) -> int:
    # Clamp container memory so a tiny problem limit can't OOM the toolchain
    # and a huge one can't exhaust the host. Verdict timing still uses req.
    return max(64, min(requested, 1024))


def _compile_memory_mb(requested: int) -> int:
    """Compile-time container memory: safe floor for toolchains."""
    return max(_COMPILE_MIN_CONTAINER_MB, _clamp_memory_mb(requested))


def _run_memory_mb(language: str, requested: int) -> int:
    """Run-time container memory. Runtimes with fixed startup overhead get a floor."""
    mem = _clamp_memory_mb(requested)
    if language == "java":
        mem = max(_JAVA_MIN_CONTAINER_MB, mem)
    elif language in ("go", "javascript"):
        mem = max(_COMPILE_MIN_CONTAINER_MB, mem)
    return mem


def _compile_container_memory_mb(language: str, requested: int) -> int:
    """Compile-time container memory, language aware."""
    mem = _compile_memory_mb(requested)
    if language in ("go", "rust"):
        mem = max(_GO_RUST_COMPILE_MIN_CONTAINER_MB, mem)
    return mem


def _docker_base_argv(
    image: str, host_workdir: Path, container_name: str, memory_mb: int
) -> list[str]:
    """Fixed sandbox flags. No caller/user input beyond image/workdir/limits.

    Sources mount read-only at /sandbox; build artifacts and execution
    use the writable exec tmpfs at /scratch. The seccomp profile path
    is the daemon-host path from JUDGE_SECCOMP_PROFILE (repo file
    api/seccomp-koj.json provisioned there); a missing profile fails
    closed via Docker and maps to SandboxUnavailable.
    """
    return [
        "docker",
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--user",
        settings.JUDGE_DOCKER_USER,
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--security-opt",
        f"seccomp={settings.JUDGE_SECCOMP_PROFILE}",
        "--pids-limit",
        str(settings.JUDGE_DOCKER_PIDS_LIMIT),
        "--memory",
        f"{memory_mb}m",
        "--memory-swap",
        f"{memory_mb}m",
        "--cpus",
        str(settings.JUDGE_DOCKER_CPUS),
        "--ulimit",
        _DOCKER_FSIZE_ULIMIT,
        "--ulimit",
        _DOCKER_NPROC_ULIMIT,
        "--tmpfs",
        f"/tmp:{_DOCKER_TMPFS_TMP}",
        "--tmpfs",
        f"/scratch:{_DOCKER_TMPFS_SCRATCH}",
        "--env",
        "PYTHONUNBUFFERED=1",
        "--env",
        "PYTHONDONTWRITEBYTECODE=1",
        "--env",
        "PYTHONPYCACHEPREFIX=/tmp",
        "-v",
        f"{host_workdir}:/sandbox:ro",
        "-w",
        "/sandbox",
        "--name",
        container_name,
        image,
    ]


def _run_docker(
    image: str,
    host_workdir: Path,
    inner_cmd: list[str],
    memory_mb: int,
    timeout_s: float,
    stdin_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run one sandboxed command. Raises SandboxUnavailable on infra failure."""
    if shutil.which("docker") is None:
        raise SandboxUnavailable("docker binary not found on judge host")
    # Full UUID: unique container names for reliable timeout cleanup.
    container_name = f"koj-judge-{uuid.uuid4().hex}"
    argv = _docker_base_argv(image, host_workdir, container_name, memory_mb) + inner_cmd
    try:
        proc = subprocess.run(
            argv,
            input=stdin_text,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except FileNotFoundError as e:
        raise SandboxUnavailable(f"docker binary not found: {e}") from e
    except subprocess.TimeoutExpired:
        # Forced cleanup: the timed-out container may linger despite --rm.
        # `rm -f` both kills and removes; never masks the timeout.
        _cleanup_container(container_name)
        raise
    except Exception as e:  # noqa: BLE001 — docker infra failure fails closed
        _cleanup_container(container_name)
        raise SandboxUnavailable(str(e)) from e
    stderr = proc.stderr or ""
    if "Cannot connect to the Docker daemon" in stderr:
        _cleanup_container(container_name)
        raise SandboxUnavailable("docker daemon unreachable")
    if "seccomp" in stderr.lower() and proc.returncode != 0 and (
        "no such file" in stderr.lower()
        or "not found" in stderr.lower()
        or "invalid" in stderr.lower()
        or "permission denied" in stderr.lower()
    ):
        _cleanup_container(container_name)
        raise SandboxUnavailable(f"seccomp profile unavailable: {_truncate(stderr.strip(), 300)}")
    return proc


# ---------------------------------------------------------------------------
# rlimit backend (host toolchain)
#
# SRS §2.5 constraint 3: process-level isolation via resource.setrlimit instead
# of containers, sufficient for a trusted college user base. Used when
# JUDGE_SANDBOX_MODE=auto and no Docker CLI is present (Cloud Run cannot run
# containers) or when forced with JUDGE_SANDBOX_MODE=rlimit.
#
# Enforced per run: RLIMIT_CPU (soft = wall budget, hard = soft + 1s so a CPU
# hog receives SIGXCPU and reports as TLE instead of a generic exit), RLIMIT_AS,
# RLIMIT_NPROC (fork bombs), RLIMIT_FSIZE (runaway output/files), RLIMIT_CORE
# off, a wall-clock timeout, and a new process session per run so a timeout
# kills the whole group.
#
# Not provided: filesystem and network namespaces (see DEPLOYMENT_CONTRACT.md
# §11). Contestant code sees the service user's filesystem and can reach the
# network, so the docker backend remains the hardened path where a Docker host
# exists.
# ---------------------------------------------------------------------------

_LOCAL_FSIZE_BYTES = 1024 * 1024
# Output bound for parity with the docker backend's fsize ulimit.
_LOCAL_STDOUT_LIMIT = 1024 * 1024
# Compilers need more headroom than the problem's judge limit.
_LOCAL_COMPILE_MIN_MB = 512
# Binaries a host toolchain must be able to invoke. A missing entry is judge
# infrastructure failure, never the contestant's compilation error.
_LOCAL_TOOLCHAIN: dict[str, tuple[str, ...]] = {
    "python": (),
    "c": ("gcc",),
    "c++": ("g++",),
    "java": ("javac", "java"),
    "go": ("go",),
    # rustc shells out to a system linker, so `cc` is part of the toolchain.
    "rust": ("rustc", "cc"),
    "javascript": ("node",),
}
# RLIMIT_NPROC counts every task of the real UID on the host — threads
# included — so the ceiling must clear the host's live task count or legitimate
# forks (g++ -> cc1plus, JVM threads) die with EAGAIN. This headroom is what
# actually bounds a fork bomb, so there is deliberately no absolute cap.
_LOCAL_NPROC_HEADROOM = 64
_NPROC_CACHE_TTL_S = 5.0
# preexec_fn forks in the calling thread; FastAPI runs sync endpoints in a
# threadpool, so serialize the fork window.
_FORK_LOCK = threading.Lock()
_nproc_cache: tuple[float, int] | None = None


def resolve_sandbox_backend() -> str:
    """Return the active sandbox backend: `docker` or `rlimit`."""
    mode = settings.JUDGE_SANDBOX_MODE
    if mode == "docker":
        return "docker"
    if mode == "rlimit":
        return "rlimit"
    return "docker" if shutil.which("docker") else "rlimit"


def _host_task_count() -> int:
    """Live task count for the host; 0 when it cannot be read.

    `/proc/loadavg`'s fourth field is the number of existing scheduling
    entities, which is exactly the unit RLIMIT_NPROC counts (tasks, not
    processes). It over-counts other users' tasks, which only raises the
    ceiling — the alternative, a false EAGAIN, breaks valid compilations.
    """
    try:
        raw = Path("/proc/loadavg").read_text(encoding="utf-8").split()
        # Fourth field is "running/total" scheduling entities.
        return int(raw[3].rsplit("/", 1)[-1])
    except (OSError, IndexError, ValueError):
        return 0


_GO_CACHE_DIRNAME = "koj-go-build-cache"
_go_cache_dir: Path | None = None


def _shared_go_cache() -> Path:
    """Process-wide GOCACHE for the rlimit backend's Go builds.

    A per-submission cache would make every Go build recompile the standard
    library (10s+). The cache holds content-addressed build artefacts only —
    never submission sources — and is reused across runs. Falls back to the
    system temp dir if the dedicated directory cannot be created.
    """
    global _go_cache_dir
    if _go_cache_dir is None:
        candidate = Path(tempfile.gettempdir()) / _GO_CACHE_DIRNAME
        try:
            candidate.mkdir(mode=0o700, exist_ok=True)
            _go_cache_dir = candidate
        except OSError:
            logger.warning("go build cache dir unavailable; using the temp root")
            _go_cache_dir = Path(tempfile.gettempdir())
    return _go_cache_dir


def warm_go_cache() -> None:
    """Compile a throwaway program so Go's standard library is cached once.

    Runs in a background thread at service start; without it the first Go
    submission of a cold instance pays the whole stdlib build.
    """
    if resolve_sandbox_backend() != "rlimit" or shutil.which("go") is None:
        return
    with tempfile.TemporaryDirectory(prefix="koj-go-warm-") as tmp:
        workdir = Path(tmp)
        (workdir / "warm.go").write_text("package main\n\nfunc main() {}\n", encoding="utf-8")
        try:
            _local_run(
                None,
                workdir,
                [
                    "env",
                    f"GOCACHE={_shared_go_cache()}",
                    f"GOTMPDIR={workdir}",
                    "go",
                    "build",
                    "-o",
                    "warm",
                    "warm.go",
                ],
                _LOCAL_COMPILE_MIN_MB,
                COMPILE_TIMEOUT_S,
                fsize_bytes=0,
            )
            logger.info("go build cache warmed at %s", _shared_go_cache())
        except Exception:  # noqa: BLE001 - warm-up is best effort
            logger.warning("go build cache warm-up failed", exc_info=True)


def _uid_process_allowance() -> int:
    """Task ceiling for RLIMIT_NPROC; 0 leaves the limit unset.

    Cached briefly: only needs to stay above the host's live task count.
    """
    global _nproc_cache
    now = time.monotonic()
    cached = _nproc_cache
    if cached is not None and now - cached[0] < _NPROC_CACHE_TTL_S:
        return cached[1]
    base = _host_task_count()
    if base <= 0:
        return 0
    allowance = base + _LOCAL_NPROC_HEADROOM
    _nproc_cache = (now, allowance)
    return allowance


def _local_run_memory_mb(language: str, requested: int) -> int:
    """Address-space cap (MB) for one rlimit-backend run; 0 = no RLIMIT_AS.

    Returns 0 for runtimes that reserve far more virtual address space than the
    data they touch (JVM, Go arena, V8): RLIMIT_AS would stop them before the
    program starts. Their memory is bounded by a runtime flag instead — -Xmx for
    Java, GOMEMLIMIT for Go, --max-old-space-size for Node (see the run commands
    in _local_compile).
    """
    if language in _LARGE_ADDRESS_SPACE_LANGUAGES:
        return 0
    return _clamp_memory_mb(requested)


def _limit_preexec(cpu_s: int, memory_mb: int, nproc: int, fsize_bytes: int):
    """Build the child-side hook that installs the rlimit caps.

    `memory_mb <= 0` leaves RLIMIT_AS unset (see _local_run_memory_mb);
    `nproc <= 0` leaves RLIMIT_NPROC unset (allowance unknown);
    `fsize_bytes <= 0` leaves RLIMIT_FSIZE unset (compile steps, where the
    linker legitimately writes binaries larger than the run-time output bound).
    """

    def _apply() -> None:  # pragma: no cover - runs in the forked child
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if fsize_bytes > 0:
            resource.setrlimit(resource.RLIMIT_FSIZE, (fsize_bytes, fsize_bytes))
        if memory_mb > 0:
            cap = memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
        if nproc > 0:
            resource.setrlimit(resource.RLIMIT_NPROC, (nproc, nproc))

    return _apply


def _kill_process_group(proc: subprocess.Popen[str]) -> None:
    """SIGKILL the run's whole process group (best effort)."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except OSError:
        try:
            proc.kill()
        except OSError:
            pass


def _local_run(
    _image: str | None,
    host_workdir: Path,
    inner_cmd: list[str],
    memory_mb: int,
    timeout_s: float,
    stdin_text: str | None = None,
    *,
    fsize_bytes: int = _LOCAL_FSIZE_BYTES,
) -> subprocess.CompletedProcess[str]:
    """Run one command under the rlimit sandbox.

    The image argument exists so this is call-compatible with `_run_docker`;
    the rlimit backend uses the host toolchain instead of a container image.
    """
    if resource is None:
        raise SandboxUnavailable("rlimit sandbox unavailable on this platform")
    cpu_s = max(1, math.ceil(timeout_s))
    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPYCACHEPREFIX": str(host_workdir / ".pycache"),
    }
    argv = [str(part) for part in inner_cmd]
    try:
        with _FORK_LOCK:
            proc = subprocess.Popen(
                argv,
                cwd=str(host_workdir),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                preexec_fn=_limit_preexec(
                    cpu_s, memory_mb, _uid_process_allowance(), fsize_bytes
                ),
                start_new_session=True,
                env=env,
            )
        stdout, stderr = proc.communicate(stdin_text, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        _kill_process_group(proc)
        stdout, stderr = proc.communicate()
        raise subprocess.TimeoutExpired(argv, timeout_s, output=stdout, stderr=stderr) from None
    except OSError as e:
        raise SandboxUnavailable(f"failed to start sandboxed process: {e}") from e
    return subprocess.CompletedProcess(
        argv,
        proc.returncode,
        _truncate(stdout, _LOCAL_STDOUT_LIMIT),
        _truncate(stderr, _LOCAL_STDOUT_LIMIT),
    )


def _local_compile(
    language: str, host_workdir: Path, memory_mb: int
) -> tuple[list[str], str | None]:
    """Compile on the host toolchain. Returns (run_cmd, compile_error).

    Mirrors `_docker_compile`: commands are relative to the run workdir, and a
    missing toolchain is an infra failure (SandboxUnavailable), never a
    compilation error attributed to the contestant.
    """
    if language in ("java", "go", "rust", "javascript"):
        # These toolchains/runtimes reserve large address spaces, so RLIMIT_AS
        # would stop them before they compile anything. A runaway compiler is
        # bounded by COMPILE_TIMEOUT_S instead.
        mem = 0
    else:
        mem = max(_LOCAL_COMPILE_MIN_MB, _clamp_memory_mb(memory_mb))

    missing = [b for b in _LOCAL_TOOLCHAIN.get(language, ()) if shutil.which(b) is None]
    if missing:
        raise SandboxUnavailable(
            f"toolchain unavailable on judge host: {', '.join(missing)}"
        )

    def _compile_cmd(cmd: list[str]) -> str | None:
        try:
            # No RLIMIT_FSIZE while compiling: linkers and code generators write
            # artefacts larger than the run-time output bound, and a truncated
            # write would surface as a bogus compilation error. COMPILE_TIMEOUT_S
            # already bounds a runaway compiler.
            proc = _local_run(
                None, host_workdir, cmd, mem, COMPILE_TIMEOUT_S, fsize_bytes=0
            )
        except subprocess.TimeoutExpired:
            return "compilation timed out"
        except SandboxUnavailable:
            raise
        except OSError as e:
            raise SandboxUnavailable(str(e)) from e
        if proc.returncode != 0:
            return (proc.stderr or "").strip() or f"compilation failed (exit {proc.returncode})"
        return None

    python_exe = sys.executable or "python3"

    if language == "python":
        err = _compile_cmd([python_exe, "-m", "py_compile", "solution.py"])
        if err is not None:
            return [], err
        return [python_exe, "solution.py"], None

    if language == "c":
        err = _compile_cmd(["gcc", *_C_HARDEN_FLAGS, "-o", "solution", "solution.c"])
        if err is not None:
            return [], err
        return ["./solution"], None

    if language == "c++":
        err = _compile_cmd(["g++", *_CXX_HARDEN_FLAGS, "-o", "solution", "solution.cpp"])
        if err is not None:
            return [], err
        return ["./solution"], None

    if language == "java":
        err = _compile_cmd(["javac", "-d", ".", "Solution.java"])
        if err is not None:
            return [], err
        # Heap follows the problem's limit, not the AS floor.
        heap_mb = max(128, _clamp_memory_mb(memory_mb) * 3 // 4)
        return [
            "java",
            f"-Xmx{heap_mb}M",
            "-Xss256k",
            "-XX:ReservedCodeCacheSize=64M",
            "-XX:MaxMetaspaceSize=96M",
            "-cp",
            ".",
            "Solution",
        ], None

    if language == "go":
        # GOCACHE must be writable; it lives in the run workdir so nothing
        # leaks outside and the cache dies with the submission.
        err = _compile_cmd(
            [
                "env",
                # Shared across submissions: a per-run cache recompiles the Go
                # standard library every time (10s+ per build).
                f"GOCACHE={_shared_go_cache()}",
                # Go requires GOTMPDIR to exist already; the run workdir does.
                f"GOTMPDIR={host_workdir}",
                "go",
                "build",
                "-o",
                "solution",
                "solution.go",
            ]
        )
        if err is not None:
            return [], err
        # Go has no RLIMIT_AS in this backend, so the runtime is told its soft
        # memory ceiling directly (Go 1.19+).
        limit_mb = _clamp_memory_mb(memory_mb)
        return ["env", f"GOMEMLIMIT={limit_mb}MiB", "./solution"], None

    if language == "rust":
        err = _compile_cmd(
            ["rustc", "--edition", "2021", "-O", "-o", "solution", "solution.rs"]
        )
        if err is not None:
            return [], err
        return ["./solution"], None

    if language == "javascript":
        # Interpreted: no compile step, but a syntax error still belongs to the
        # contestant, so check the file before running it.
        err = _compile_cmd(["node", "--check", "solution.js"])
        if err is not None:
            return [], err
        heap_mb = max(64, _clamp_memory_mb(memory_mb) * 3 // 4)
        return ["node", f"--max-old-space-size={heap_mb}", "solution.js"], None

    return [], f"Unsupported language: {language}"


def _docker_compile(
    language: str, host_workdir: Path, memory_mb: int
) -> tuple[list[str], str | None]:
    """Compile inside the sandbox. Returns (run_cmd, compile_error).

    Raises SandboxUnavailable when Docker itself fails (fail closed —
    callers must map this to runtime_error, NOT compilation_error).
    """
    image = _image_for(language)
    mem = _compile_container_memory_mb(language, memory_mb)

    def _compile_cmd(cmd: list[str]) -> str | None:
        try:
            proc = _run_docker(image, host_workdir, cmd, mem, COMPILE_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return "compilation timed out"
        except SandboxUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 — docker infra failure fails closed
            raise SandboxUnavailable(str(e)) from e
        if "Cannot connect to the Docker daemon" in (proc.stderr or ""):
            raise SandboxUnavailable("docker daemon unreachable")
        if proc.returncode != 0:
            err = (proc.stderr or "").strip() or f"compilation failed (exit {proc.returncode})"
            return err
        return None

    if language == "python":
        err = _compile_cmd(["python3", "-m", "py_compile", "/sandbox/solution.py"])
        if err is not None:
            return [], err
        return ["python3", "/sandbox/solution.py"], None

    if language == "c":
        err = _compile_cmd(
            ["gcc", *_C_HARDEN_FLAGS, "-o", "/scratch/solution", "/sandbox/solution.c"]
        )
        if err is not None:
            return [], err
        return ["/scratch/solution"], None

    if language == "c++":
        err = _compile_cmd(
            ["g++", *_CXX_HARDEN_FLAGS, "-o", "/scratch/solution", "/sandbox/solution.cpp"]
        )
        if err is not None:
            return [], err
        return ["/scratch/solution"], None

    if language == "java":
        # Compiled output (-d /scratch) is separated from read-only sources.
        err = _compile_cmd(["javac", "-d", "/scratch", "/sandbox/Solution.java"])
        if err is not None:
            return [], err
        run_mem = _run_memory_mb(language, memory_mb)
        heap_mb = max(128, run_mem * 3 // 4)
        return [
            "java",
            f"-Xmx{heap_mb}M",
            "-Xss256k",
            "-XX:ReservedCodeCacheSize=64M",
            "-XX:MaxMetaspaceSize=96M",
            "-cp",
            "/scratch",
            "Solution",
        ], None

    if language == "go":
        # /scratch is the writable exec tmpfs; sources stay read-only.
        err = _compile_cmd(
            [
                "env",
                "GOCACHE=/scratch/gocache",
                "GOTMPDIR=/scratch",
                "go",
                "build",
                "-o",
                "/scratch/solution",
                "/sandbox/solution.go",
            ]
        )
        if err is not None:
            return [], err
        # Under Docker the cgroup memory limit is the real ceiling, so the
        # runtime floor is unnecessary here.
        return ["/scratch/solution"], None

    if language == "rust":
        err = _compile_cmd(
            [
                "rustc",
                "--edition",
                "2021",
                "-O",
                "-o",
                "/scratch/solution",
                "/sandbox/solution.rs",
            ]
        )
        if err is not None:
            return [], err
        return ["/scratch/solution"], None

    if language == "javascript":
        err = _compile_cmd(["node", "--check", "/sandbox/solution.js"])
        if err is not None:
            return [], err
        run_mem = _run_memory_mb(language, memory_mb)
        heap_mb = max(64, run_mem * 3 // 4)
        return ["node", f"--max-old-space-size={heap_mb}", "/sandbox/solution.js"], None

    return [], f"Unsupported language: {language}"


def _strip_java_noise(code: str) -> str:
    """Remove block/line comments and string/char literals (naive scan)."""
    out: list[str] = []
    i = 0
    n = len(code)
    state = "code"
    while i < n:
        ch = code[i]
        nxt = code[i + 1] if i + 1 < n else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                state = "line"
                i += 2
            elif ch == "/" and nxt == "*":
                state = "block"
                i += 2
            elif ch == '"':
                state = "str"
                out.append(" ")
                i += 1
            elif ch == "'":
                state = "chr"
                out.append(" ")
                i += 1
            else:
                out.append(ch)
                i += 1
        elif state == "line":
            if ch == "\n":
                state = "code"
                out.append("\n")
            i += 1
        elif state == "block":
            if ch == "*" and nxt == "/":
                state = "code"
                i += 2
            else:
                i += 1
        elif state == "str":
            if ch == "\\":
                i += 2
            elif ch == '"':
                state = "code"
                i += 1
            else:
                i += 1
        else:  # chr
            if ch == "\\":
                i += 2
            elif ch == "'":
                state = "code"
                i += 1
            else:
                i += 1
    return "".join(out)


def _java_has_solution_class(code: str) -> bool:
    return _JAVA_SOLUTION_CLASS_RE.search(_strip_java_noise(code)) is not None


def _prepare(language: str, code: str, workdir: Path) -> None:
    """Write sources into the host workdir (mounted at /sandbox read-only)."""
    if language == "python":
        (workdir / "solution.py").write_text(code, encoding="utf-8")
    elif language == "c":
        (workdir / "solution.c").write_text(code, encoding="utf-8")
    elif language == "c++":
        (workdir / "solution.cpp").write_text(code, encoding="utf-8")
    elif language == "java":
        if not _java_has_solution_class(code):
            raise ValueError(
                "Java submissions must declare 'public class Solution' "
                "(the starter template in the editor already does)."
            )
        (workdir / "Solution.java").write_text(code, encoding="utf-8")
    elif language == "go":
        (workdir / "solution.go").write_text(code, encoding="utf-8")
    elif language == "rust":
        (workdir / "solution.rs").write_text(code, encoding="utf-8")
    elif language == "javascript":
        (workdir / "solution.js").write_text(code, encoding="utf-8")
    else:
        raise ValueError(f"Unsupported language: {language}")


def _is_oom(language: str, stderr: str, returncode: int | None = None) -> bool:
    # Cgroup OOM kills surface as docker exit 137 (128+SIGKILL) or -9.
    # --rm removes the container so post-mortem `docker inspect`
    # OOMKilled is unavailable; the exit code plus stderr heuristics
    # below are the OOM signal (documented in DEPLOYMENT_CONTRACT.md).
    if returncode in (137, -9):
        return True
    lowered = stderr.lower()
    if "out of memory" in lowered:
        return True
    if "MemoryError" in stderr:
        return True
    if language == "java" and "OutOfMemoryError" in stderr:
        return True
    if language == "c++" and "bad_alloc" in stderr:
        return True
    if language == "go" and ("out of memory" in lowered or "cannot allocate memory" in lowered):
        return True
    if language == "rust" and ("memory allocation of" in lowered or "capacity overflow" in lowered):
        return True
    if language == "javascript" and "heap out of memory" in lowered:
        return True
    return False


def _is_cpu_limit_kill(returncode: int | None) -> bool:
    """True when the rlimit backend's RLIMIT_CPU stopped the process.

    Linux delivers SIGXCPU at the soft limit (Python reports it as the
    negative signal number), so an infinite CPU loop is a TLE rather than a
    generic runtime error. The docker backend never reaches the process this
    way: it is stopped by the wall-clock timeout instead.
    """
    return returncode is not None and returncode == -signal.SIGXCPU


def execute_judge(req: JudgeRequest) -> JudgeResponse:
    if req.language not in SUPPORTED_LANGUAGES:
        # Caller should have already returned 422, but keep as safety
        raise ValueError("Unsupported language")

    with tempfile.TemporaryDirectory(prefix="koj-judge-") as tmp:
        workdir = Path(tmp)
        sample_flags = [bool(c.is_sample) for c in req.cases]
        try:
            _prepare(req.language, req.code, workdir)
        except ValueError as e:
            return _ce_response(str(e), len(req.cases), sample_flags)

        backend = resolve_sandbox_backend()
        logger.info(
            "judge start backend=%s language=%s cases=%d",
            backend,
            req.language,
            len(req.cases),
        )
        compile_fn = _docker_compile if backend == "docker" else _local_compile
        run_fn = _run_docker if backend == "docker" else _local_run

        try:
            image = _image_for(req.language)
            run_cmd, compile_error = compile_fn(req.language, workdir, req.memory_mb)
        except SandboxUnavailable as e:
            return _sandbox_unavailable_response(str(e), len(req.cases))
        if compile_error is not None:
            return _ce_response(compile_error, len(req.cases), sample_flags)

        # Run each case in a fresh sandbox (container or host process).
        wall_timeout = req.time_limit_ms / 1000 + 2.0
        if backend == "docker":
            mem = _run_memory_mb(req.language, req.memory_mb)
        else:
            mem = _local_run_memory_mb(req.language, req.memory_mb)

        results: list[CaseResult] = []
        max_runtime = 0
        aggregate: Verdict = "accepted"
        first_error: str | None = None
        saw_infra = False

        for idx, case in enumerate(req.cases):
            is_sample = bool(case.is_sample)
            start = time.monotonic()
            try:
                proc = run_fn(image, workdir, run_cmd, mem, wall_timeout, stdin_text=case.stdin)
                elapsed_ms = int((time.monotonic() - start) * 1000)
                stdout_raw = proc.stdout or ""
                stderr_raw = proc.stderr or ""

                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms

                daemon_err = "Cannot connect to the Docker daemon" in stderr_raw
                if daemon_err:
                    raise SandboxUnavailable("docker daemon unreachable")

                if proc.returncode != 0:
                    verdict: Verdict
                    if _is_cpu_limit_kill(proc.returncode):
                        verdict = "time_limit_exceeded"
                    elif _is_oom(req.language, stderr_raw, proc.returncode):
                        verdict = "memory_limit_exceeded"
                    else:
                        verdict = "runtime_error"
                    err_msg = _truncate(
                        stderr_raw.strip()
                        or (
                            f"time limit exceeded ({req.time_limit_ms}ms)"
                            if verdict == "time_limit_exceeded"
                            else f"process exited with {proc.returncode}"
                        ),
                        2048,
                    )
                    if first_error is None:
                        first_error = err_msg
                        aggregate = verdict
                    results.append(
                        _visible_case(
                            index=idx,
                            passed=False,
                            verdict=verdict,
                            runtime_ms=elapsed_ms,
                            stdout=stdout_raw,
                            stderr=stderr_raw,
                            is_sample=is_sample,
                        )
                    )
                    continue

                # Check TLE based on time_limit_ms (if elapsed > limit, mark TLE)
                if elapsed_ms > req.time_limit_ms:
                    verdict = "time_limit_exceeded"
                    if first_error is None:
                        first_error = f"time limit exceeded ({elapsed_ms}ms > {req.time_limit_ms}ms)"
                        aggregate = verdict
                    results.append(
                        _visible_case(
                            index=idx,
                            passed=False,
                            verdict=verdict,
                            runtime_ms=elapsed_ms,
                            stdout=stdout_raw,
                            stderr=stderr_raw,
                            is_sample=is_sample,
                        )
                    )
                    continue

                # Compare output
                if _outputs_equal(stdout_raw, case.expected_stdout):
                    results.append(
                        _visible_case(
                            index=idx,
                            passed=True,
                            verdict="accepted",
                            runtime_ms=elapsed_ms,
                            stdout=stdout_raw,
                            stderr=stderr_raw,
                            is_sample=is_sample,
                        )
                    )
                elif _whitespace_only_diff(stdout_raw, case.expected_stdout):
                    verdict = "presentation_error"
                    if first_error is None:
                        aggregate = verdict
                        first_error = None
                    results.append(
                        _visible_case(
                            index=idx,
                            passed=False,
                            verdict=verdict,
                            runtime_ms=elapsed_ms,
                            stdout=stdout_raw,
                            stderr=stderr_raw,
                            is_sample=is_sample,
                        )
                    )
                else:
                    verdict = "wrong_answer"
                    if first_error is None:
                        aggregate = verdict
                        first_error = None  # WA has no error_message per spec? keep None unless later
                    results.append(
                        _visible_case(
                            index=idx,
                            passed=False,
                            verdict=verdict,
                            runtime_ms=elapsed_ms,
                            stdout=stdout_raw,
                            stderr=stderr_raw,
                            is_sample=is_sample,
                        )
                    )

            except subprocess.TimeoutExpired as e:
                elapsed_ms = int((time.monotonic() - start) * 1000)
                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms
                stdout_raw = (e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")) if e.stdout else ""
                stderr_raw = (e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")) if e.stderr else ""
                verdict = "time_limit_exceeded"
                if first_error is None:
                    first_error = f"time limit exceeded ({req.time_limit_ms}ms)"
                    aggregate = verdict
                results.append(
                    _visible_case(
                        index=idx,
                        passed=False,
                        verdict=verdict,
                        runtime_ms=elapsed_ms,
                        stdout=stdout_raw,
                        stderr=stderr_raw,
                        is_sample=is_sample,
                    )
                )
            except SandboxUnavailable as e:
                elapsed_ms = int((time.monotonic() - start) * 1000)
                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms
                msg = _truncate(f"judge sandbox unavailable: {e}", 2048)
                if first_error is None:
                    first_error = msg
                    aggregate = "runtime_error"
                saw_infra = True
                results.append(
                    CaseResult(
                        index=idx,
                        passed=False,
                        verdict="runtime_error",
                        runtime_ms=elapsed_ms,
                        stdout="",
                        stderr=_truncate(msg, 4096),
                    )
                )
            except Exception as e:  # noqa: BLE001
                elapsed_ms = int((time.monotonic() - start) * 1000)
                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms
                msg = _truncate(str(e), 2048)
                if first_error is None:
                    first_error = msg
                    aggregate = "runtime_error"
                saw_infra = True
                results.append(
                    CaseResult(
                        index=idx,
                        passed=False,
                        verdict="runtime_error",
                        runtime_ms=elapsed_ms,
                        stdout="",
                        stderr=_truncate(msg, 4096),
                    )
                )

        passed = sum(1 for r in results if r.passed)
        total = len(results)
        # Aggregate is already first non-accepted, else accepted
        if passed == total and total > 0:
            aggregate = "accepted"
            first_error = None
        elif total == 0:
            # A problem with no test cases cannot be judged: any submission
            # would otherwise be handed a free AC. Report it as an
            # infrastructure/config failure, never as a pass.
            aggregate = "runtime_error"
            saw_infra = True
            first_error = "problem has no test cases; nothing was judged"

        # error_message is first error's message truncated 2KB, except
        # accepted/wrong_answer/presentation_error which carry no message
        error_message: str | None = None
        if aggregate not in ("accepted", "wrong_answer", "presentation_error"):
            error_message = _truncate(first_error or "", 2048) if first_error else None

        return JudgeResponse(
            status=aggregate,
            passed_tests=passed,
            total_tests=total,
            execution_time_ms=max_runtime,
            error_message=error_message,
            cases=results,
            infra_error=saw_infra,
        )
