"""Unit tests for api/app/judge.py — hermetic, no network/DB/docker."""

from __future__ import annotations

import signal

import pytest

from app.judge import (
    SUPPORTED_LANGUAGES,
    _ce_response,
    _clamp_memory_mb,
    _compile_memory_mb,
    _is_cpu_limit_kill,
    _is_oom,
    _java_has_solution_class,
    _normalize_output,
    _outputs_equal,
    _run_memory_mb,
    _sandbox_unavailable_response,
    _strip_java_noise,
    _truncate,
    _visible_case,
    _whitespace_only_diff,
)


# ---------------------------------------------------------------------------
# _normalize_output
# ---------------------------------------------------------------------------

class TestNormalizeOutput:
    def test_empty_string(self):
        assert _normalize_output("") == []

    def test_trailing_newlines(self):
        assert _normalize_output("hello\n\n\n") == ["hello"]

    def test_trailing_spaces_per_line(self):
        assert _normalize_output("hello   \nworld  \n") == ["hello", "world"]

    def test_tabs(self):
        # rstrip() strips trailing tabs/spaces but preserves leading
        assert _normalize_output("\tfoo\t\n") == ["\tfoo"]

    def test_crlf(self):
        assert _normalize_output("a\r\nb\r\n") == ["a", "b"]

    def test_blank_lines_in_middle(self):
        assert _normalize_output("a\n\nb") == ["a", "", "b"]

    def test_only_whitespace(self):
        assert _normalize_output("  \n  \n") == []


# ---------------------------------------------------------------------------
# _outputs_equal
# ---------------------------------------------------------------------------

class TestOutputsEqual:
    def test_equal(self):
        assert _outputs_equal("hello\n", "hello\n") is True

    def test_trailing_ws_insensitive(self):
        assert _outputs_equal("hello  \n", "hello\n") is True

    def test_blank_lines_at_end(self):
        assert _outputs_equal("hello\n\n\n", "hello\n") is True

    def test_different(self):
        assert _outputs_equal("hello", "world") is False


# ---------------------------------------------------------------------------
# _whitespace_only_diff
# ---------------------------------------------------------------------------

class TestWhitespaceOnlyDiff:
    def test_true_pe_case(self):
        assert _whitespace_only_diff("hello world", "helloworld") is True

    def test_equal_returns_false(self):
        assert _whitespace_only_diff("hello\n", "hello\n") is False

    def test_totally_different(self):
        assert _whitespace_only_diff("abc", "xyz") is False

    def test_tabs_vs_spaces(self):
        assert _whitespace_only_diff("a\tb", "ab") is True


# ---------------------------------------------------------------------------
# _truncate
# ---------------------------------------------------------------------------

class TestTruncate:
    def test_short(self):
        assert _truncate("hi", 10) == "hi"

    def test_long(self):
        assert _truncate("hello world", 5) == "hello"

    def test_exact_boundary(self):
        assert _truncate("hello", 5) == "hello"

    def test_empty(self):
        assert _truncate("", 10) == ""


# ---------------------------------------------------------------------------
# _ce_response
# ---------------------------------------------------------------------------

class TestCeResponse:
    def test_status_ce(self):
        r = _ce_response("error msg", 3)
        assert r.status == "compilation_error"

    def test_passed_zero(self):
        r = _ce_response("error msg", 3)
        assert r.passed_tests == 0

    def test_per_case_ce_verdicts(self):
        r = _ce_response("error msg", 3)
        assert len(r.cases) == 3
        for c in r.cases:
            assert c.verdict == "compilation_error"
            assert c.passed is False
            assert c.runtime_ms == 0

    def test_message_truncated(self):
        long_msg = "x" * 4000
        r = _ce_response(long_msg, 1)
        assert r.error_message is not None and len(r.error_message) == 2048

    def test_message_short(self):
        r = _ce_response("short", 1)
        assert r.error_message == "short"

    def test_sample_keeps_stderr(self):
        r = _ce_response("err", 2, is_sample_list=[True, False])
        assert r.cases[0].stderr == "err"

    def test_hidden_redacts_stderr(self):
        r = _ce_response("err", 2, is_sample_list=[True, False])
        assert r.cases[1].stderr == ""

    def test_total_tests(self):
        r = _ce_response("e", 5)
        assert r.total_tests == 5


# ---------------------------------------------------------------------------
# _sandbox_unavailable_response
# ---------------------------------------------------------------------------

class TestSandboxUnavailableResponse:
    def test_runtime_error(self):
        r = _sandbox_unavailable_response("docker down", 2)
        assert r.status == "runtime_error"

    def test_infra_error_true(self):
        r = _sandbox_unavailable_response("docker down", 2)
        assert r.infra_error is True

    def test_message_prefixed(self):
        r = _sandbox_unavailable_response("boom", 1)
        assert r.error_message is not None and "judge sandbox unavailable" in r.error_message

    def test_passed_zero(self):
        r = _sandbox_unavailable_response("x", 3)
        assert r.passed_tests == 0


# ---------------------------------------------------------------------------
# _visible_case
# ---------------------------------------------------------------------------

class TestVisibleCase:
    def test_sample_keeps_stdout_stderr(self):
        c = _visible_case(0, True, "accepted", 100, "out", "err", is_sample=True)
        assert c.stdout == "out"
        assert c.stderr == "err"

    def test_hidden_redacts_stdout_stderr(self):
        c = _visible_case(0, False, "wrong_answer", 50, "secret", "secret_err", is_sample=False)
        assert c.stdout == ""
        assert c.stderr == ""

    def test_verdict_preserved(self):
        c = _visible_case(0, False, "time_limit_exceeded", 500, "", "", is_sample=False)
        assert c.verdict == "time_limit_exceeded"

    def test_passed_preserved(self):
        c = _visible_case(0, True, "accepted", 100, "", "", is_sample=False)
        assert c.passed is True

    def test_runtime_preserved(self):
        c = _visible_case(0, False, "runtime_error", 42, "", "", is_sample=False)
        assert c.runtime_ms == 42

    def test_sample_stdout_truncated(self):
        c = _visible_case(0, True, "accepted", 0, "x" * 9000, "", is_sample=True)
        assert len(c.stdout) == 4096


# ---------------------------------------------------------------------------
# _clamp_memory_mb
# ---------------------------------------------------------------------------

class TestClampMemoryMb:
    def test_below_floor(self):
        assert _clamp_memory_mb(10) == 64

    def test_passthrough(self):
        assert _clamp_memory_mb(256) == 256

    def test_above_cap(self):
        assert _clamp_memory_mb(9999) == 1024

    def test_floor_boundary(self):
        assert _clamp_memory_mb(64) == 64

    def test_cap_boundary(self):
        assert _clamp_memory_mb(1024) == 1024


# ---------------------------------------------------------------------------
# _compile_memory_mb
# ---------------------------------------------------------------------------

class TestCompileMemoryMb:
    def test_floor_256(self):
        assert _compile_memory_mb(32) == 256

    def test_passthrough(self):
        assert _compile_memory_mb(512) == 512


# ---------------------------------------------------------------------------
# _run_memory_mb
# ---------------------------------------------------------------------------

class TestRunMemoryMb:
    def test_java_floor(self):
        assert _run_memory_mb("java", 32) == 256

    def test_java_passthrough(self):
        assert _run_memory_mb("java", 512) == 512

    def test_go_floor(self):
        assert _run_memory_mb("go", 32) == 256

    def test_javascript_floor(self):
        assert _run_memory_mb("javascript", 32) == 256

    def test_python_passthrough(self):
        assert _run_memory_mb("python", 128) == 128

    def test_c_passthrough(self):
        assert _run_memory_mb("c", 128) == 128


# ---------------------------------------------------------------------------
# _is_oom
# ---------------------------------------------------------------------------

class TestIsOom:
    def test_exit_137(self):
        assert _is_oom("python", "", 137) is True

    def test_exit_neg9(self):
        assert _is_oom("python", "", -9) is True

    def test_memory_error(self):
        assert _is_oom("python", "MemoryError: out of memory", 1) is True

    def test_java_out_of_memory_error(self):
        assert _is_oom("java", "java.lang.OutOfMemoryError", 1) is True

    def test_cpp_bad_alloc(self):
        assert _is_oom("c++", "std::bad_alloc", 1) is True

    def test_go_out_of_memory(self):
        assert _is_oom("go", "runtime: out of memory", 1) is True

    def test_go_cannot_allocate(self):
        assert _is_oom("go", "cannot allocate memory", 1) is True

    def test_rust_memory_allocation(self):
        assert _is_oom("rust", "memory allocation of 1024 bytes failed", 1) is True

    def test_rust_capacity_overflow(self):
        assert _is_oom("rust", "capacity overflow", 1) is True

    def test_javascript_heap_oom(self):
        assert _is_oom("javascript", "FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - heap out of memory", 1) is True

    def test_negative_not_oom(self):
        assert _is_oom("python", "", -1) is False

    def test_plain_re_not_oom(self):
        assert _is_oom("python", "ZeroDivisionError", 1) is False

    def test_none_returncode(self):
        assert _is_oom("python", "", None) is False

    def test_java_non_oom(self):
        assert _is_oom("java", "NullPointerException", 1) is False


# ---------------------------------------------------------------------------
# _is_cpu_limit_kill
# ---------------------------------------------------------------------------

class TestIsCpuLimitKill:
    def test_sigxcpu(self):
        assert _is_cpu_limit_kill(-signal.SIGXCPU) is True

    def test_sigxcpu_positive(self):
        # Python may report as positive on some paths
        assert _is_cpu_limit_kill(128 + signal.SIGXCPU) is False

    def test_other_negative(self):
        assert _is_cpu_limit_kill(-9) is False

    def test_none(self):
        assert _is_cpu_limit_kill(None) is False

    def test_zero(self):
        assert _is_cpu_limit_kill(0) is False


# ---------------------------------------------------------------------------
# _strip_java_noise + _java_has_solution_class
# ---------------------------------------------------------------------------

class TestJavaSolutionClass:
    def test_real_declaration(self):
        assert _java_has_solution_class("public class Solution {") is True

    def test_comment_does_not_match(self):
        assert _java_has_solution_class("// class Solution") is False

    def test_block_comment_does_not_match(self):
        assert _java_has_solution_class("/* class Solution */") is False

    def test_string_literal_does_not_match(self):
        assert _java_has_solution_class('String s = "class Solution";') is False

    def test_no_class(self):
        assert _java_has_solution_class("public class Foo {}") is False

    def test_stripped_preserves_real(self):
        code = "public class Solution { int x; }"
        stripped = _strip_java_noise(code)
        assert "public class Solution" in stripped

    def test_stripped_removes_line_comment(self):
        code = "// class Solution\npublic class Foo {}"
        stripped = _strip_java_noise(code)
        assert "class Solution" not in stripped

    def test_stripped_removes_block_comment(self):
        code = "/* class Solution */\npublic class Foo {}"
        stripped = _strip_java_noise(code)
        assert "class Solution" not in stripped

    def test_stripped_removes_string_literal(self):
        code = 'String s = "class Solution";'
        stripped = _strip_java_noise(code)
        assert "class Solution" not in stripped


# ---------------------------------------------------------------------------
# SUPPORTED_LANGUAGES
# ---------------------------------------------------------------------------

class TestSupportedLanguages:
    def test_contains_python(self):
        assert "python" in SUPPORTED_LANGUAGES

    def test_contains_c(self):
        assert "c" in SUPPORTED_LANGUAGES

    def test_contains_cpp(self):
        assert "c++" in SUPPORTED_LANGUAGES

    def test_contains_java(self):
        assert "java" in SUPPORTED_LANGUAGES

    def test_length_at_least_four(self):
        assert len(SUPPORTED_LANGUAGES) >= 4
