"""Python-only judge: compile check + per-case execution + output comparison."""

from __future__ import annotations

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


def execute_judge(req: JudgeRequest) -> JudgeResponse:
    # Validate language
    # Caller should have already returned 422, but keep as safety
    if req.language != "python":
        # This will be handled at route level; here we treat as runtime error
        raise ValueError("Unsupported language")

    # Syntax check via py_compile
    tmp_path: Path | None = None
    tmp_file = None
    try:
        tmp_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8"
        )
        tmp_file.write(req.code)
        tmp_file.flush()
        tmp_file.close()
        tmp_path = Path(tmp_file.name)
        try:
            py_compile.compile(str(tmp_path), doraise=True)
        except py_compile.PyCompileError as e:
            msg = _truncate(str(e), 2048)
            # Build compilation_error response
            cases: list[CaseResult] = []
            for idx, _ in enumerate(req.cases):
                cases.append(
                    CaseResult(
                        index=idx,
                        passed=False,
                        verdict="compilation_error",
                        runtime_ms=0,
                        stdout="",
                        stderr=_truncate(msg, 4096),
                    )
                )
            return JudgeResponse(
                status="compilation_error",
                passed_tests=0,
                total_tests=len(req.cases),
                execution_time_ms=0,
                error_message=msg,
                cases=cases,
            )
        except SyntaxError as e:
            msg = _truncate(str(e), 2048)
            cases = []
            for idx, _ in enumerate(req.cases):
                cases.append(
                    CaseResult(
                        index=idx,
                        passed=False,
                        verdict="compilation_error",
                        runtime_ms=0,
                        stdout="",
                        stderr=_truncate(msg, 4096),
                    )
                )
            return JudgeResponse(
                status="compilation_error",
                passed_tests=0,
                total_tests=len(req.cases),
                execution_time_ms=0,
                error_message=msg,
                cases=cases,
            )

        # Run each case
        wall_timeout = req.time_limit_ms / 1000 + 2.0
        memory_bytes = req.memory_mb * 1024 * 1024

        def _limit_memory() -> None:
            if _HAS_RESOURCE:
                # resource unavailable on Windows, skipped silently
                resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))  # type: ignore[attr-defined]

        results: list[CaseResult] = []
        max_runtime = 0
        aggregate: Verdict = "accepted"
        first_error: str | None = None

        for idx, case in enumerate(req.cases):
            start = time.monotonic()
            try:
                preexec = _limit_memory if _HAS_RESOURCE else None
                # On Windows preexec_fn is not supported, so we only pass it on POSIX
                kwargs: dict = {}
                if _HAS_RESOURCE:
                    kwargs["preexec_fn"] = _limit_memory

                proc = subprocess.run(
                    [sys.executable, str(tmp_path)],
                    input=case.stdin,
                    capture_output=True,
                    text=True,
                    timeout=wall_timeout,
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
                    # Heuristic: if stderr mentions MemoryError, map to memory_limit_exceeded
                    # Otherwise runtime_error
                    verdict: Verdict
                    if "MemoryError" in proc.stderr:
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

    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
        # NamedTemporaryFile on Windows needs manual cleanup if not deleted
        if tmp_file is not None and tmp_path is None:
            try:
                Path(tmp_file.name).unlink(missing_ok=True)
            except Exception:
                pass
