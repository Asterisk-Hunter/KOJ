"""Multi-language judge: compile (if needed) + per-case execution + output comparison.

Supported v1 languages: python, c, c++, java (SRS REQ-JUDGE-02).
Each submission runs in its own temporary working directory containing
only the files required for judging (REQ-JUDGE-08).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Literal

import py_compile
from pydantic import BaseModel, Field

# resource is POSIX-only; on Windows import fails — memory limiting is skipped there
try:
    import resource  # type: ignore[import-not-found]

    _HAS_RESOURCE = True
except ImportError:  # pragma: no cover - Windows
    _HAS_RESOURCE = False  # resource unavailable on Windows, memory limit skipped silently

SUPPORTED_LANGUAGES: tuple[str, ...] = ("python", "c", "c++", "java")

COMPILE_TIMEOUT_S = 30.0

Verdict = Literal[
    "accepted",
    "wrong_answer",
    "time_limit_exceeded",
    "memory_limit_exceeded",
    "runtime_error",
    "compilation_error",
]


class JudgeCase(BaseModel):
    stdin: str
    expected_stdout: str


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


def _ce_response(message: str, total: int) -> JudgeResponse:
    msg = _truncate(message, 2048)
    cases = [
        CaseResult(
            index=idx,
            passed=False,
            verdict="compilation_error",
            runtime_ms=0,
            stdout="",
            stderr=_truncate(msg, 4096),
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


def _compile(source: Path, argv: list[str]) -> str | None:
    """Run a compiler; return None on success or the stderr on failure."""
    if shutil.which(argv[0]) is None:
        return f"compiler not installed: {argv[0]}"
    try:
        proc = subprocess.run(
            argv,
            cwd=source.parent,
            capture_output=True,
            text=True,
            timeout=COMPILE_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return "compilation timed out"
    if proc.returncode != 0:
        return proc.stderr.strip() or f"compilation failed (exit {proc.returncode})"
    return None


def _prepare(language: str, code: str, workdir: Path, memory_mb: int) -> tuple[list[str], str | None]:
    """Write sources, compile if needed. Returns (run_cmd, compile_error)."""
    if language == "python":
        src = workdir / "solution.py"
        src.write_text(code, encoding="utf-8")
        try:
            py_compile.compile(str(src), doraise=True)
        except py_compile.PyCompileError as e:
            return [], str(e)
        except SyntaxError as e:
            return [], str(e)
        return [sys.executable, str(src)], None

    if language == "c":
        src = workdir / "solution.c"
        src.write_text(code, encoding="utf-8")
        err = _compile(src, ["gcc", "-O2", "-std=c11", "-o", "solution", "solution.c"])
        if err is not None:
            return [], err
        return [str(workdir / "solution")], None

    if language == "c++":
        src = workdir / "solution.cpp"
        src.write_text(code, encoding="utf-8")
        err = _compile(src, ["g++", "-O2", "-std=c++17", "-o", "solution", "solution.cpp"])
        if err is not None:
            return [], err
        return [str(workdir / "solution")], None

    if language == "java":
        if "class Solution" not in code:
            return [], "Java submissions must declare 'public class Solution'"
        src = workdir / "Solution.java"
        src.write_text(code, encoding="utf-8")
        err = _compile(src, ["javac", "Solution.java"])
        if err is not None:
            return [], err
        heap_mb = max(64, memory_mb * 3 // 4)
        return [
            "java",
            f"-Xmx{heap_mb}M",
            "-Xss256k",
            "-XX:ReservedCodeCacheSize=64M",
            "-XX:MaxMetaspaceSize=96M",
            "-cp",
            str(workdir),
            "Solution",
        ], None

    return [], f"Unsupported language: {language}"


def _is_oom(language: str, stderr: str) -> bool:
    if "MemoryError" in stderr:
        return True
    if language == "java" and "OutOfMemoryError" in stderr:
        return True
    if language == "c++" and "bad_alloc" in stderr:
        return True
    return False


def execute_judge(req: JudgeRequest) -> JudgeResponse:
    if req.language not in SUPPORTED_LANGUAGES:
        # Caller should have already returned 422, but keep as safety
        raise ValueError("Unsupported language")

    with tempfile.TemporaryDirectory(prefix="koj-judge-") as tmp:
        workdir = Path(tmp)
        run_cmd, compile_error = _prepare(req.language, req.code, workdir, req.memory_mb)
        if compile_error is not None:
            return _ce_response(compile_error, len(req.cases))

        # Run each case
        wall_timeout = req.time_limit_ms / 1000 + 2.0
        memory_bytes = req.memory_mb * 1024 * 1024
        # Java is exempt from RLIMIT_AS: a modern JVM reserves gigabytes of
        # virtual address space at startup, so an AS cap kills it before main().
        # Heap is still hard-capped via -Xmx above, and OutOfMemoryError maps
        # to memory_limit_exceeded. Native/thread abuse remains a documented
        # limitation for the trusted college user base (see docs/status.md).
        enforce_as = req.language != "java" and _HAS_RESOURCE

        def _set_resource_limits() -> None:
            if not _HAS_RESOURCE:
                return
            if enforce_as:
                # Memory limit (REQ-JUDGE-06)
                resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))  # type: ignore[attr-defined]
            # CPU time limit in seconds (REQ-JUDGE-04)
            cpu_s = max(1, int(req.time_limit_ms / 1000) + 1)
            try:
                resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))  # type: ignore[attr-defined]
            except (ValueError, OSError):
                pass
            # Limit child processes to prevent fork bombs (REQ-JUDGE-07 / REQ-SAFE-03)
            # Skipped for Java because the JVM requires multiple runtime threads.
            if req.language != "java":
                try:
                    resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))  # type: ignore[attr-defined]
                except (ValueError, OSError):
                    pass

        kwargs: dict = {}
        if _HAS_RESOURCE:
            kwargs["preexec_fn"] = _set_resource_limits

        results: list[CaseResult] = []
        max_runtime = 0
        aggregate: Verdict = "accepted"
        first_error: str | None = None

        for idx, case in enumerate(req.cases):
            start = time.monotonic()
            try:
                proc = subprocess.run(
                    run_cmd,
                    input=case.stdin,
                    capture_output=True,
                    text=True,
                    timeout=wall_timeout,
                    cwd=str(workdir),
                    **kwargs,
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)
                # Enforce time_limit_ms wall as TLE if elapsed exceeds limit (best-effort)
                # If process exceeded resource limit, it may be killed; treat as memory limit
                # but we map non-zero exit generally to runtime_error unless we detect TLE

                # Truncate outputs to 4KB per spec for case results
                stdout_trunc = _truncate(proc.stdout, 4096)
                stderr_trunc = _truncate(proc.stderr, 4096)

                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms

                if proc.returncode != 0:
                    verdict: Verdict
                    if _is_oom(req.language, proc.stderr):
                        verdict = "memory_limit_exceeded"
                    else:
                        verdict = "runtime_error"
                    err_msg = _truncate(proc.stderr.strip() or f"process exited with {proc.returncode}", 2048)
                    if first_error is None:
                        first_error = err_msg
                        aggregate = verdict
                    results.append(
                        CaseResult(
                            index=idx,
                            passed=False,
                            verdict=verdict,
                            runtime_ms=elapsed_ms,
                            stdout=stdout_trunc,
                            stderr=stderr_trunc,
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
                        CaseResult(
                            index=idx,
                            passed=False,
                            verdict=verdict,
                            runtime_ms=elapsed_ms,
                            stdout=stdout_trunc,
                            stderr=stderr_trunc,
                        )
                    )
                    continue

                # Compare output
                if _outputs_equal(proc.stdout, case.expected_stdout):
                    results.append(
                        CaseResult(
                            index=idx,
                            passed=True,
                            verdict="accepted",
                            runtime_ms=elapsed_ms,
                            stdout=stdout_trunc,
                            stderr=stderr_trunc,
                        )
                    )
                else:
                    verdict = "wrong_answer"
                    if first_error is None:
                        aggregate = verdict
                        first_error = None  # WA has no error_message per spec? keep None unless later
                    results.append(
                        CaseResult(
                            index=idx,
                            passed=False,
                            verdict=verdict,
                            runtime_ms=elapsed_ms,
                            stdout=stdout_trunc,
                            stderr=stderr_trunc,
                        )
                    )

            except subprocess.TimeoutExpired as e:
                elapsed_ms = int((time.monotonic() - start) * 1000)
                if elapsed_ms > max_runtime:
                    max_runtime = elapsed_ms
                stdout_trunc = _truncate((e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")) if e.stdout else "", 4096)
                stderr_trunc = _truncate((e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")) if e.stderr else "", 4096)
                verdict = "time_limit_exceeded"
                if first_error is None:
                    first_error = f"time limit exceeded ({req.time_limit_ms}ms)"
                    aggregate = verdict
                results.append(
                    CaseResult(
                        index=idx,
                        passed=False,
                        verdict=verdict,
                        runtime_ms=elapsed_ms,
                        stdout=stdout_trunc,
                        stderr=stderr_trunc,
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
            aggregate = "accepted"

        # error_message is first error's message truncated 2KB, except WA has no message
        error_message: str | None = None
        if aggregate != "accepted" and aggregate != "wrong_answer":
            error_message = _truncate(first_error or "", 2048) if first_error else None
        elif aggregate == "wrong_answer":
            error_message = None

        return JudgeResponse(
            status=aggregate,
            passed_tests=passed,
            total_tests=total,
            execution_time_ms=max_runtime,
            error_message=error_message,
            cases=results,
        )
