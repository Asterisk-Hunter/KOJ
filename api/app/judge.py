"""Multi-language judge: sandboxed compile + per-case execution.

Supported v1 languages: python, c, c++, java (SRS REQ-JUDGE-02).

Backends selected by JUDGE_SANDBOX_MODE (see api/DEPLOYMENT_CONTRACT.md):

* `docker` — container sandbox. Requires a Docker daemon on the judge host;
  without it judging fails closed with `runtime_error` + `infra_error=True`
  so callers never blame the contestant.
* `cloudrun` — Cloud Run Preview sandbox launcher with a separate toolchain
  rootfs, default-denied egress, and no inherited parent credentials.
* `rlimit` — host-toolchain process limits for trusted local development only.
* `auto` (default) — Docker or Cloud Run launcher, otherwise fails closed.

Docker sandbox (fixed server-side flags, never user-controlled):
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

import json
import logging
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, MAX_EMAX, MIN_EMIN, localcontext
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Literal

from pydantic import BaseModel, Field, field_validator

from .config import settings
from .host_lock import HostExecutionLockError, host_execution_lock

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
_JUDGE_WALL_BUDGET_S = 60.0

# Hardening constants (fixed, not user-controlled).
_DOCKER_TMPFS_TMP = "rw,noexec,nosuid,size=64m"
# Writable exec scratch for build artifacts and execution. Exec is
# required here (compiled binaries cannot run from noexec /tmp);
# size-bounded and cleared with the container (--rm).
_DOCKER_TMPFS_SCRATCH = "rw,nosuid,exec,size=256m"
_RUN_FSIZE_LIMIT_BYTES = 1024 * 1024
_COMPILE_FSIZE_LIMIT_BYTES = 64 * 1024 * 1024
_DOCKER_NPROC_ULIMIT = "nproc=64:64"
_DOCKER_NOFILE_ULIMIT = "nofile=256:256"
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
_SPECIAL_CHECKER_TIMEOUT_S = 2.0
_CLOUDRUN_CLI = Path("/usr/local/gcp/bin/sandbox")
_CLOUDRUN_ROOTFS = Path("/opt/koj-sandbox-root")
_CLOUDRUN_TAR_MAX_BYTES = 512 * 1024 * 1024
_CLOUDRUN_JUDGE_LOCK = threading.Lock()
_DOCKER_ARTIFACT_VOLUME_BYTES = 256 * 1024 * 1024
_INFRASTRUCTURE_PUBLIC_MESSAGE = "Judge infrastructure temporarily unavailable."

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
    cases: list[JudgeCase] = Field(max_length=100)
    time_limit_ms: int = Field(ge=1, le=10_000)
    memory_mb: int = Field(ge=1, le=1024)
    output_comparator: Literal["exact", "float"] = "exact"
    absolute_tolerance: float = Field(default=0.000001, ge=0, le=1, allow_inf_nan=False)
    relative_tolerance: float = Field(default=0.000001, ge=0, le=1, allow_inf_nan=False)
    checker_code: str | None = Field(default=None, max_length=65_536)

    @field_validator("code")
    @classmethod
    def code_must_fit_utf8_limit(cls, code: str) -> str:
        try:
            code_size = len(code.encode("utf-8"))
        except UnicodeEncodeError as error:
            raise ValueError("code must be valid UTF-8") from error
        if code_size > 100 * 1024:
            raise ValueError("code exceeds the 100 KiB limit")
        return code


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


@dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: str
    stderr: str
    output_limit_exceeded: bool


_MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024


def _read_bounded_stream(
    stream: BinaryIO,
    buffer: bytearray,
    total_bytes: list[int],
    output_limit_exceeded: threading.Event,
) -> None:
    while True:
        block = stream.read(64 * 1024)
        if not block:
            return
        previous_size = total_bytes[0]
        total_bytes[0] = previous_size + len(block)
        remaining = _MAX_PROCESS_OUTPUT_BYTES - previous_size
        if remaining > 0:
            buffer.extend(block[:remaining])
        if total_bytes[0] > _MAX_PROCESS_OUTPUT_BYTES:
            output_limit_exceeded.set()


def _write_process_input(stream: BinaryIO | None, input_text: str | None) -> None:
    if stream is None:
        return
    try:
        if input_text is not None:
            stream.write(input_text.encode("utf-8"))
            stream.flush()
    except (BrokenPipeError, OSError):
        pass
    finally:
        try:
            stream.close()
        except OSError:
            pass


def _run_bounded_process(
    argv: list[str],
    timeout_s: float,
    stdin_text: str | None = None,
    *,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
    preexec_fn: Callable[[], None] | None = None,
    spawn_lock: threading.Lock | None = None,
) -> ProcessResult:
    def start_process() -> subprocess.Popen[bytes]:
        return subprocess.Popen(
            argv,
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=preexec_fn,
            start_new_session=True,
        )

    if spawn_lock is None:
        process = start_process()
    else:
        with spawn_lock:
            process = start_process()

    stdout_buffer = bytearray()
    stderr_buffer = bytearray()
    stdout_size = [0]
    stderr_size = [0]
    output_limit_exceeded = threading.Event()
    stdout_stream = process.stdout
    stderr_stream = process.stderr
    if stdout_stream is None or stderr_stream is None:
        _kill_process_group(process)
        raise SandboxUnavailable("failed to capture sandbox process output")

    readers = [
        threading.Thread(
            target=_read_bounded_stream,
            args=(stdout_stream, stdout_buffer, stdout_size, output_limit_exceeded),
            daemon=True,
        ),
        threading.Thread(
            target=_read_bounded_stream,
            args=(stderr_stream, stderr_buffer, stderr_size, output_limit_exceeded),
            daemon=True,
        ),
    ]
    for reader in readers:
        reader.start()
    input_writer = threading.Thread(
        target=_write_process_input,
        args=(process.stdin, stdin_text),
        daemon=True,
    )
    input_writer.start()

    deadline = time.monotonic() + timeout_s
    timed_out = False
    while process.poll() is None:
        if output_limit_exceeded.is_set():
            _kill_process_group(process)
            break
        if time.monotonic() >= deadline:
            timed_out = True
            _kill_process_group(process)
            break
        time.sleep(0.01)
    returncode = process.wait()
    input_writer.join(timeout=1)
    for reader in readers:
        reader.join(timeout=2)

    stdout = bytes(stdout_buffer).decode("utf-8", errors="replace")
    stderr = bytes(stderr_buffer).decode("utf-8", errors="replace")
    if timed_out:
        raise subprocess.TimeoutExpired(argv, timeout_s, output=stdout, stderr=stderr)
    return ProcessResult(
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
        output_limit_exceeded=output_limit_exceeded.is_set(),
    )


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


def _float_outputs_equal(
    actual: str,
    expected: str,
    absolute_tolerance: float,
    relative_tolerance: float,
) -> bool:
    actual_tokens = actual.split()
    expected_tokens = expected.split()
    if len(actual_tokens) != len(expected_tokens):
        return False

    for actual_token, expected_token in zip(actual_tokens, expected_tokens):
        try:
            actual_number = Decimal(actual_token)
        except InvalidOperation:
            actual_number = None
        if actual_number is not None and actual_number.is_finite() and not re.fullmatch(
            r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?",
            actual_token,
        ):
            actual_number = None
        try:
            expected_number = Decimal(expected_token)
        except InvalidOperation:
            expected_number = None
        if expected_number is not None and expected_number.is_finite() and not re.fullmatch(
            r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?",
            expected_token,
        ):
            expected_number = None

        if actual_number is not None and not actual_number.is_finite():
            return False
        if expected_number is not None and not expected_number.is_finite():
            return False
        if actual_number is not None and expected_number is not None:
            with localcontext() as context:
                context.prec = max(32, len(actual_token), len(expected_token)) + 8
                context.Emax = MAX_EMAX
                context.Emin = MIN_EMIN
                allowed_difference = max(
                    Decimal(str(absolute_tolerance)),
                    Decimal(str(relative_tolerance))
                    * max(abs(actual_number), abs(expected_number)),
                )
                if abs(actual_number - expected_number) > allowed_difference:
                    return False
        elif actual_token != expected_token:
            return False

    return True


def _whitespace_only_diff(actual: str, expected: str) -> bool:
    # True when outputs match after removing ALL whitespace: the program is
    # logically correct but formatted wrong -> presentation_error (REQ-JUDGE-11)
    strip = lambda s: "".join(s.split())
    return strip(actual) == strip(expected) and not _outputs_equal(actual, expected)


def _special_checker_passed(
    returncode: int | None,
    output_limit_exceeded: bool,
    stderr: str = "",
) -> bool | None:
    if output_limit_exceeded or returncode not in (0, 1):
        return None
    if returncode == 1 and stderr:
        return None
    return returncode == 0


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


def _sandbox_unavailable_response(_message: str, total: int) -> JudgeResponse:
    """Fail-closed verdict when Docker cannot run. Always runtime_error + infra_error."""
    msg = _INFRASTRUCTURE_PUBLIC_MESSAGE
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
    """Force-remove a lingering container before its artifact volume is removed."""
    try:
        proc = subprocess.run(
            ["docker", "rm", "-f", container_name],
            capture_output=True,
            text=True,
            timeout=_DOCKER_KILL_TIMEOUT_S,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SandboxUnavailable("failed to stop Docker sandbox container") from error
    if proc.returncode != 0 and "no such container" not in (proc.stderr or "").lower():
        raise SandboxUnavailable("failed to stop Docker sandbox container")


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
    image: str,
    host_workdir: Path,
    container_name: str,
    memory_mb: int,
    fsize_bytes: int,
    artifact_volume: str | None = None,
    artifact_volume_read_only: bool = False,
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
        "--interactive",
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
        f"fsize={fsize_bytes}:{fsize_bytes}",
        "--ulimit",
        _DOCKER_NPROC_ULIMIT,
        "--ulimit",
        _DOCKER_NOFILE_ULIMIT,
        "--tmpfs",
        f"/tmp:{_DOCKER_TMPFS_TMP}",
        *(
            ["-v", f"{artifact_volume}:/scratch:rw"]
            if artifact_volume is not None and not artifact_volume_read_only
            else ["--tmpfs", f"/scratch:{_DOCKER_TMPFS_SCRATCH}"]
        ),
        *(
            ["-v", f"{artifact_volume}:/artifacts:ro"]
            if artifact_volume is not None and artifact_volume_read_only
            else []
        ),
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


def _create_docker_artifact_volume() -> str:
    if shutil.which("docker") is None:
        raise SandboxUnavailable("docker binary not found on judge host")
    volume_name = f"koj-artifacts-{uuid.uuid4().hex}"
    try:
        result = subprocess.run(
            [
                "docker", "volume", "create", "--driver", "local",
                "--opt", "type=tmpfs", "--opt", "device=tmpfs",
                "--opt", f"o=size={_DOCKER_ARTIFACT_VOLUME_BYTES},uid=65534,gid=65534,mode=0700",
                volume_name,
            ],
            capture_output=True,
            text=True,
            timeout=_DOCKER_KILL_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SandboxUnavailable("failed to create bounded Docker artifact volume") from error
    if result.returncode != 0 or result.stdout.strip() != volume_name:
        raise SandboxUnavailable("failed to create bounded Docker artifact volume")
    return volume_name


def _remove_docker_artifact_volume(volume_name: str) -> None:
    try:
        result = subprocess.run(
            ["docker", "volume", "rm", "--force", volume_name],
            capture_output=True,
            text=True,
            timeout=_DOCKER_KILL_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SandboxUnavailable("failed to remove Docker artifact volume") from error
    if result.returncode != 0:
        raise SandboxUnavailable("failed to remove Docker artifact volume")


@contextmanager
def _docker_artifact_volume():
    volume_name = _create_docker_artifact_volume()
    try:
        yield volume_name
    finally:
        _remove_docker_artifact_volume(volume_name)


def _run_docker(
    image: str,
    host_workdir: Path,
    inner_cmd: list[str],
    memory_mb: int,
    timeout_s: float,
    stdin_text: str | None = None,
    *,
    fsize_bytes: int = _RUN_FSIZE_LIMIT_BYTES,
    artifact_volume: str | None = None,
    artifact_volume_read_only: bool = False,
) -> ProcessResult:
    """Run one sandboxed command. Raises SandboxUnavailable on infra failure."""
    if shutil.which("docker") is None:
        raise SandboxUnavailable("docker binary not found on judge host")
    # Full UUID: unique container names for reliable timeout cleanup.
    container_name = f"koj-judge-{uuid.uuid4().hex}"
    argv = _docker_base_argv(
        image,
        host_workdir,
        container_name,
        memory_mb,
        fsize_bytes,
        artifact_volume,
        artifact_volume_read_only,
    ) + inner_cmd
    try:
        proc = _run_bounded_process(argv, timeout_s, stdin_text)
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
    if proc.output_limit_exceeded:
        _cleanup_container(container_name)
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


def _cloudrun_source_tar(workdir: Path) -> Path:
    source_files = [entry for entry in workdir.iterdir() if entry.is_file()]
    if len(source_files) != 1:
        raise SandboxUnavailable("expected exactly one submission source file")
    archive = workdir / "koj-source.tar"
    with tarfile.open(archive, "w") as output:
        output.add(source_files[0], arcname=f"work/{source_files[0].name}", recursive=False)
    return archive


def _validate_cloudrun_tar(archive: Path) -> None:
    if not archive.is_file() or archive.stat().st_size > _CLOUDRUN_TAR_MAX_BYTES:
        raise SandboxUnavailable("sandbox artifact archive missing or oversized")
    try:
        with tarfile.open(archive, "r") as source:
            total_size = 0
            for index, member in enumerate(source):
                path = PurePosixPath(member.name)
                parts = tuple(part for part in path.parts if part != ".")
                if (
                    index >= 10_000
                    or (parts and parts[0] != "work")
                    or (not parts and not member.isdir())
                    or ".." in parts
                    or path.is_absolute()
                    or not (member.isfile() or member.isdir())
                ):
                    raise SandboxUnavailable("unsafe sandbox artifact archive")
                total_size += member.size
                if total_size > _CLOUDRUN_TAR_MAX_BYTES:
                    raise SandboxUnavailable("sandbox artifact archive oversized")
    except (OSError, tarfile.TarError) as error:
        raise SandboxUnavailable("invalid sandbox artifact archive") from error


def _cleanup_cloudrun_sandbox(name: str) -> None:
    try:
        subprocess.run(
            [str(_CLOUDRUN_CLI), "delete", name, "--force"],
            capture_output=True,
            timeout=_DOCKER_KILL_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        logger.warning("sandbox cleanup failed name=%s", name)


def _run_cloudrun(
    _image: str | None,
    host_workdir: Path,
    inner_cmd: list[str],
    memory_mb: int,
    timeout_s: float,
    stdin_text: str | None = None,
    *,
    fsize_bytes: int = _RUN_FSIZE_LIMIT_BYTES,
    export_state: bool = False,
) -> ProcessResult:
    if not _CLOUDRUN_CLI.is_file() or not _CLOUDRUN_ROOTFS.is_dir():
        raise SandboxUnavailable("Cloud Run sandbox launcher or rootfs unavailable")
    name = f"koj-{uuid.uuid4().hex}"
    marker = f"KOJ_SANDBOX_STARTED_{uuid.uuid4().hex}"
    argv = [
        str(_CLOUDRUN_CLI), "do", "--sandbox-name", name,
        "--rootfs", str(_CLOUDRUN_ROOTFS), "--write",
        "--env", "HOME=/work", "--env", "TMPDIR=/work",
        "--workdir", "/work",
    ]
    state_tar = host_workdir / "koj-state.tar"
    source_tar = host_workdir / "koj-source.tar"
    if state_tar.is_file():
        _validate_cloudrun_tar(state_tar)
        argv.extend(["--import-tar", str(state_tar)])
    elif source_tar.is_file():
        argv.extend(["--import-tar", str(source_tar)])
    if export_state:
        argv.extend(["--export-tar", str(state_tar)])
    argv.extend([
        "--", "/usr/local/bin/python3", "-I", "/usr/local/bin/koj-sandbox-exec.py",
        "--cpu-seconds", str(max(1, math.ceil(timeout_s))),
        "--memory-mb", str(memory_mb), "--file-bytes", str(fsize_bytes),
        "--nproc", "128" if export_state else "64",
        "--marker", marker, "--", *inner_cmd,
    ])
    def limit_export_size() -> None:
        if resource is not None:
            resource.setrlimit(resource.RLIMIT_FSIZE, (_CLOUDRUN_TAR_MAX_BYTES, _CLOUDRUN_TAR_MAX_BYTES))

    try:
        result = _run_bounded_process(
            argv, timeout_s, stdin_text, preexec_fn=limit_export_size, spawn_lock=_FORK_LOCK,
        )
        if marker not in result.stderr:
            raise SandboxUnavailable("Cloud Run sandbox command did not start")
        stderr = result.stderr.replace(f"{marker}\n", "", 1)
        if export_state and result.returncode == 0:
            _validate_cloudrun_tar(state_tar)
        return ProcessResult(result.returncode, result.stdout, stderr, result.output_limit_exceeded)
    except OSError as error:
        raise SandboxUnavailable("failed to start Cloud Run sandbox") from error
    finally:
        _cleanup_cloudrun_sandbox(name)


# ---------------------------------------------------------------------------
# rlimit backend (host toolchain)
#
# SRS §2.5 constraint 3: process-level isolation via resource.setrlimit instead
# of containers, sufficient only for trusted local development. Never use this
# mode to execute arbitrary public submissions.
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

_LOCAL_FSIZE_BYTES = _RUN_FSIZE_LIMIT_BYTES
_LOCAL_COMPILE_FSIZE_BYTES = _COMPILE_FSIZE_LIMIT_BYTES
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
    """Return the selected backend, failing closed when auto has none."""
    mode = settings.JUDGE_SANDBOX_MODE
    if mode == "docker":
        return "docker"
    if mode == "cloudrun":
        return "cloudrun"
    if mode == "rlimit":
        return "rlimit"
    if shutil.which("docker"):
        return "docker"
    return "cloudrun" if _CLOUDRUN_CLI.is_file() else "unavailable"


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
                fsize_bytes=_LOCAL_COMPILE_FSIZE_BYTES,
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
        _, current_hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        file_limit = min(256, current_hard) if current_hard != resource.RLIM_INFINITY else 256
        resource.setrlimit(resource.RLIMIT_NOFILE, (file_limit, file_limit))

    return _apply


def _kill_process_group(proc: subprocess.Popen[bytes]) -> None:
    """SIGKILL the run's whole process group (best effort)."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (AttributeError, OSError):
        try:
            proc.kill()
        except OSError:
            pass


def _local_process_environment(host_workdir: Path) -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", os.defpath),
        "HOME": str(host_workdir),
        "TMPDIR": str(host_workdir),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPYCACHEPREFIX": str(host_workdir / ".pycache"),
    }


def _local_run(
    _image: str | None,
    host_workdir: Path,
    inner_cmd: list[str],
    memory_mb: int,
    timeout_s: float,
    stdin_text: str | None = None,
    *,
    fsize_bytes: int = _LOCAL_FSIZE_BYTES,
) -> ProcessResult:
    """Run one command under the rlimit sandbox.

    The image argument exists so this is call-compatible with `_run_docker`;
    the rlimit backend uses the host toolchain instead of a container image.
    """
    if resource is None:
        raise SandboxUnavailable("rlimit sandbox unavailable on this platform")
    cpu_s = max(1, math.ceil(timeout_s))
    env = _local_process_environment(host_workdir)
    argv = [str(part) for part in inner_cmd]
    try:
        return _run_bounded_process(
            argv,
            timeout_s,
            stdin_text,
            cwd=str(host_workdir),
            env=env,
            preexec_fn=_limit_preexec(
                cpu_s, memory_mb, _uid_process_allowance(), fsize_bytes
            ),
            spawn_lock=_FORK_LOCK,
        )
    except subprocess.TimeoutExpired:
        raise
    except OSError as e:
        raise SandboxUnavailable(f"failed to start sandboxed process: {e}") from e


def _local_compile(
    language: str, host_workdir: Path, memory_mb: int, timeout_s: float = COMPILE_TIMEOUT_S
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
            proc = _local_run(
                None,
                host_workdir,
                cmd,
                mem,
                timeout_s,
                fsize_bytes=_LOCAL_COMPILE_FSIZE_BYTES,
            )
        except subprocess.TimeoutExpired:
            return "compilation timed out"
        except SandboxUnavailable:
            raise
        except OSError as e:
            raise SandboxUnavailable(str(e)) from e
        if proc.output_limit_exceeded:
            return "compiler output exceeded the 1 MiB limit"
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


def _cloudrun_compile(
    language: str, host_workdir: Path, memory_mb: int, timeout_s: float = COMPILE_TIMEOUT_S
) -> tuple[list[str], str | None]:
    _cloudrun_source_tar(host_workdir)
    memory = (
        0 if language in ("java", "go", "rust", "javascript")
        else max(_LOCAL_COMPILE_MIN_MB, _clamp_memory_mb(memory_mb))
    )

    def compile_command(command: list[str]) -> str | None:
        try:
            result = _run_cloudrun(
                None, host_workdir, command, memory, timeout_s,
                fsize_bytes=_LOCAL_COMPILE_FSIZE_BYTES, export_state=True,
            )
        except subprocess.TimeoutExpired:
            return "compilation timed out"
        if result.output_limit_exceeded:
            return "compiler output exceeded the 1 MiB limit"
        if result.returncode != 0:
            return result.stderr.strip() or f"compilation failed (exit {result.returncode})"
        return None

    if language == "python":
        error = compile_command(["python3", "-m", "py_compile", "solution.py"])
        return (["python3", "solution.py"], None) if error is None else ([], error)
    if language == "c":
        error = compile_command(["gcc", *_C_HARDEN_FLAGS, "-o", "solution", "solution.c"])
        return (["./solution"], None) if error is None else ([], error)
    if language == "c++":
        error = compile_command(["g++", *_CXX_HARDEN_FLAGS, "-o", "solution", "solution.cpp"])
        return (["./solution"], None) if error is None else ([], error)
    if language == "java":
        error = compile_command(["javac", "-d", ".", "Solution.java"])
        if error is not None:
            return [], error
        heap_mb = max(128, _clamp_memory_mb(memory_mb) * 3 // 4)
        return ["java", f"-Xmx{heap_mb}M", "-Xss256k", "-XX:ReservedCodeCacheSize=64M", "-XX:MaxMetaspaceSize=96M", "-cp", ".", "Solution"], None
    if language == "go":
        error = compile_command(["env", "GOCACHE=/work/gocache", "GOTMPDIR=/work", "go", "build", "-o", "solution", "solution.go"])
        if error is not None:
            return [], error
        return ["env", f"GOMEMLIMIT={_clamp_memory_mb(memory_mb)}MiB", "./solution"], None
    if language == "rust":
        error = compile_command(["rustc", "--edition", "2021", "-O", "-o", "solution", "solution.rs"])
        return (["./solution"], None) if error is None else ([], error)
    if language == "javascript":
        error = compile_command(["node", "--check", "solution.js"])
        if error is not None:
            return [], error
        heap_mb = max(64, _clamp_memory_mb(memory_mb) * 3 // 4)
        return ["node", f"--max-old-space-size={heap_mb}", "solution.js"], None
    return [], f"Unsupported language: {language}"


def _docker_compile(
    language: str,
    host_workdir: Path,
    memory_mb: int,
    timeout_s: float = COMPILE_TIMEOUT_S,
    artifact_volume: str | None = None,
) -> tuple[list[str], str | None]:
    """Compile inside the sandbox. Returns (run_cmd, compile_error).

    Raises SandboxUnavailable when Docker itself fails (fail closed —
    callers must map this to runtime_error, NOT compilation_error).
    """
    image = _image_for(language)
    mem = _compile_container_memory_mb(language, memory_mb)

    def _compile_cmd(cmd: list[str]) -> str | None:
        try:
            proc = _run_docker(
                image,
                host_workdir,
                cmd,
                mem,
                timeout_s,
                fsize_bytes=_COMPILE_FSIZE_LIMIT_BYTES,
                artifact_volume=artifact_volume,
            )
        except subprocess.TimeoutExpired:
            return "compilation timed out"
        except SandboxUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 — docker infra failure fails closed
            raise SandboxUnavailable(str(e)) from e
        if proc.output_limit_exceeded:
            return "compiler output exceeded the 1 MiB limit"
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
        return ["/artifacts/solution"], None

    if language == "c++":
        err = _compile_cmd(
            ["g++", *_CXX_HARDEN_FLAGS, "-o", "/scratch/solution", "/sandbox/solution.cpp"]
        )
        if err is not None:
            return [], err
        return ["/artifacts/solution"], None

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
            "/artifacts",
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
        return ["/artifacts/solution"], None

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
        return ["/artifacts/solution"], None

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
    sigxcpu = getattr(signal, "SIGXCPU", None)
    return returncode is not None and sigxcpu is not None and returncode == -sigxcpu


def execute_judge(req: JudgeRequest, *, lock_wait_seconds: float = 0.0) -> JudgeResponse:
    backend = resolve_sandbox_backend()
    if backend == "unavailable":
        return _sandbox_unavailable_response("no isolated backend configured", len(req.cases))
    try:
        with host_execution_lock(settings.JUDGE_HOST_EXECUTION_LOCK, lock_wait_seconds):
            if backend == "docker":
                with _docker_artifact_volume() as volume_name:
                    return _execute_judge(req, backend, volume_name)
            if backend == "cloudrun":
                with _CLOUDRUN_JUDGE_LOCK:
                    return _execute_judge(req, backend)
            return _execute_judge(req, backend)
    except HostExecutionLockError as error:
        return _sandbox_unavailable_response(str(error), len(req.cases))
    except SandboxUnavailable as error:
        return _sandbox_unavailable_response(str(error), len(req.cases))


def _budget_exceeded_response(total: int) -> JudgeResponse:
    return _sandbox_unavailable_response("60-second aggregate wall budget exceeded", total)


def _execute_judge(
    req: JudgeRequest, backend: str, artifact_volume: str | None = None
) -> JudgeResponse:
    if req.language not in SUPPORTED_LANGUAGES:
        # Caller should have already returned 422, but keep as safety
        raise ValueError("Unsupported language")

    deadline = time.monotonic() + _JUDGE_WALL_BUDGET_S
    with (
        tempfile.TemporaryDirectory(prefix="koj-judge-") as tmp,
        tempfile.TemporaryDirectory(prefix="koj-checker-") as checker_tmp,
    ):
        workdir = Path(tmp)
        checker_workdir = Path(checker_tmp)
        if backend == "docker":
            workdir.chmod(0o755)
            checker_workdir.chmod(0o755)
        sample_flags = [bool(c.is_sample) for c in req.cases]
        try:
            _prepare(req.language, req.code, workdir)
            if backend == "docker":
                for source_file in workdir.iterdir():
                    source_file.chmod(0o444)
        except ValueError as e:
            return _ce_response(str(e), len(req.cases), sample_flags)

        logger.info(
            "judge start backend=%s language=%s cases=%d",
            backend,
            req.language,
            len(req.cases),
        )
        compile_fn = (
            _docker_compile if backend == "docker"
            else _cloudrun_compile if backend == "cloudrun"
            else _local_compile
        )
        run_fn = (
            _run_docker if backend == "docker"
            else _run_cloudrun if backend == "cloudrun"
            else _local_run
        )
        checker_image = _image_for("python") if backend == "docker" else None
        checker_cmd = (
            ["python3", "-I", "-S", "-c", req.checker_code or ""]
            if backend == "docker"
            else [sys.executable, "-I", "-S", "-c", req.checker_code or ""]
        )

        try:
            image = _image_for(req.language)
            compile_kwargs = (
                {"artifact_volume": artifact_volume}
                if backend == "docker"
                else {}
            )
            run_cmd, compile_error = compile_fn(
                req.language,
                workdir,
                req.memory_mb,
                min(COMPILE_TIMEOUT_S, max(0.001, deadline - time.monotonic())),
                **compile_kwargs,
            )
        except SandboxUnavailable as e:
            return _sandbox_unavailable_response(str(e), len(req.cases))
        if time.monotonic() >= deadline:
            return _budget_exceeded_response(len(req.cases))
        if compile_error is not None:
            return _ce_response(compile_error, len(req.cases), sample_flags)

        # Run each case in a fresh sandbox (container or host process).
        wall_timeout = req.time_limit_ms / 1000 + 2.0
        if backend == "docker":
            mem = _run_memory_mb(req.language, req.memory_mb)
        else:
            mem = _local_run_memory_mb(req.language, req.memory_mb)
        checker_mem = (
            _run_memory_mb("python", req.memory_mb)
            if backend == "docker"
            else _local_run_memory_mb("python", req.memory_mb)
        )

        results: list[CaseResult] = []
        max_runtime = 0
        aggregate: Verdict = "accepted"
        first_error: str | None = None
        saw_infra = False

        for idx, case in enumerate(req.cases):
            is_sample = bool(case.is_sample)
            start = time.monotonic()
            checker_phase = False
            try:
                remaining_budget = deadline - time.monotonic()
                if remaining_budget <= 0:
                    return _budget_exceeded_response(len(req.cases))
                case_timeout = min(wall_timeout, remaining_budget)
                run_kwargs = {"stdin_text": case.stdin}
                if backend == "docker":
                    run_kwargs.update(
                        artifact_volume=artifact_volume,
                        artifact_volume_read_only=True,
                    )
                proc = run_fn(image, workdir, run_cmd, mem, case_timeout, **run_kwargs)
                if time.monotonic() >= deadline:
                    return _budget_exceeded_response(len(req.cases))
                elapsed_ms = int((time.monotonic() - start) * 1000)
                stdout_raw = proc.stdout or ""
                stderr_raw = proc.stderr or ""

                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms

                if proc.output_limit_exceeded:
                    verdict = "runtime_error"
                    message = "program output exceeded the 1 MiB limit"
                    if first_error is None:
                        first_error = message
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

                checker_feedback = ""
                if req.checker_code is not None:
                    checker_payload = json.dumps(
                        {
                            "input": case.stdin,
                            "expected_output": case.expected_stdout,
                            "actual_output": stdout_raw,
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                    checker_timeout = min(
                        _SPECIAL_CHECKER_TIMEOUT_S,
                        max(0.1, req.time_limit_ms / 1000),
                    )
                    checker_remaining = deadline - time.monotonic()
                    if checker_remaining <= 0:
                        return _budget_exceeded_response(len(req.cases))
                    checker_timeout = min(checker_timeout, checker_remaining)
                    checker_phase = True
                    checker_proc = run_fn(
                        checker_image,
                        checker_workdir,
                        checker_cmd,
                        checker_mem,
                        checker_timeout,
                        **(
                            {
                                "stdin_text": checker_payload,
                                "artifact_volume": artifact_volume,
                                "artifact_volume_read_only": True,
                            }
                            if backend == "docker"
                            else {"stdin_text": checker_payload}
                        ),
                    )
                    checker_phase = False
                    if time.monotonic() >= deadline:
                        return _budget_exceeded_response(len(req.cases))
                    checker_passed = _special_checker_passed(
                        checker_proc.returncode,
                        checker_proc.output_limit_exceeded,
                        checker_proc.stderr,
                    )
                    if checker_passed is None:
                        logger.error(
                            "special checker failed language=%s exit=%s output_limit=%s",
                            req.language,
                            checker_proc.returncode,
                            checker_proc.output_limit_exceeded,
                        )
                        if first_error is None:
                            first_error = "special checker failed; ask an administrator to inspect it"
                            aggregate = "runtime_error"
                        saw_infra = True
                        results.append(
                            _visible_case(
                                index=idx,
                                passed=False,
                                verdict="runtime_error",
                                runtime_ms=elapsed_ms,
                                stdout=stdout_raw,
                                stderr="special checker failed",
                                is_sample=is_sample,
                            )
                        )
                        continue
                    outputs_match = checker_passed
                    checker_feedback = _truncate(checker_proc.stdout.strip(), 1024)
                else:
                    outputs_match = (
                        _outputs_equal(stdout_raw, case.expected_stdout)
                        if req.output_comparator == "exact"
                        else _float_outputs_equal(
                            stdout_raw,
                            case.expected_stdout,
                            req.absolute_tolerance,
                            req.relative_tolerance,
                        )
                    )
                if outputs_match:
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
                elif req.checker_code is None and _whitespace_only_diff(stdout_raw, case.expected_stdout):
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
                            stderr=checker_feedback or stderr_raw,
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
                            stderr=checker_feedback or stderr_raw,
                            is_sample=is_sample,
                        )
                    )

            except subprocess.TimeoutExpired as e:
                if time.monotonic() >= deadline:
                    return _budget_exceeded_response(len(req.cases))
                elapsed_ms = int((time.monotonic() - start) * 1000)
                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms
                stdout_raw = (e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")) if e.stdout else ""
                stderr_raw = (e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")) if e.stderr else ""
                verdict: Verdict = "runtime_error" if checker_phase else "time_limit_exceeded"
                if first_error is None:
                    first_error = (
                        _INFRASTRUCTURE_PUBLIC_MESSAGE
                        if checker_phase
                        else f"time limit exceeded ({req.time_limit_ms}ms)"
                    )
                    aggregate = verdict
                if checker_phase:
                    saw_infra = True
                results.append(
                    _visible_case(
                        index=idx,
                        passed=False,
                        verdict=verdict,
                        runtime_ms=elapsed_ms,
                        stdout="" if checker_phase else stdout_raw,
                        stderr=_INFRASTRUCTURE_PUBLIC_MESSAGE if checker_phase else stderr_raw,
                        is_sample=is_sample,
                    )
                )
            except SandboxUnavailable as e:
                elapsed_ms = int((time.monotonic() - start) * 1000)
                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms
                logger.error("judge sandbox stage failed type=%s", type(e).__name__)
                msg = _INFRASTRUCTURE_PUBLIC_MESSAGE
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
                logger.error("judge sandbox stage failed type=%s", type(e).__name__)
                msg = _INFRASTRUCTURE_PUBLIC_MESSAGE
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
