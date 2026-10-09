"""Regressions for live-contest failure paths; no toolchains or database needed."""

from contextlib import contextmanager
import importlib.util
import io
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import judge, queue, worker
from tests.test_queue_jobs import _Cursor, _install, _result
from tests.test_worker_units import _job, _submission


def test_normal_process_exit_cleans_up_descendants_without_getpgid(monkeypatch):
    killed = []
    process = SimpleNamespace(
        pid=12345,
        stdout=io.BytesIO(b"ok\n"),
        stderr=io.BytesIO(b""),
        stdin=io.BytesIO(),
        poll=lambda: 0,
        wait=lambda: 0,
    )
    monkeypatch.setattr(judge.signal, "SIGKILL", 9, raising=False)
    monkeypatch.setattr(judge.subprocess, "Popen", lambda *_args, **_kwargs: process)
    monkeypatch.setattr(judge.os, "killpg", lambda pid, sig: killed.append((pid, sig)), raising=False)
    monkeypatch.setattr(judge.os, "getpgid", lambda _pid: pytest.fail("leader already reaped"), raising=False)

    result = judge._run_bounded_process(["program"], 1)

    assert result.stdout == "ok\n"
    assert killed == [(process.pid, judge.signal.SIGKILL)]


@pytest.mark.parametrize("failure", [None, "setup", "exec"])
def test_rlimit_uses_fresh_interpreter_and_fails_closed_on_launcher_errors(monkeypatch, failure):
    seen = {}
    monkeypatch.setattr(judge, "resource", object())
    monkeypatch.setattr(judge, "_uid_process_allowance", lambda: 64)

    def run(argv, timeout, stdin, **kwargs):
        seen.update(argv=argv, timeout=timeout, stdin=stdin, kwargs=kwargs)
        marker = argv[argv.index("--marker") + 1]
        stderr = "" if failure == "setup" else f"{marker}\n"
        if failure == "exec":
            stderr += f"{marker}:failed\n"
        return judge.ProcessResult(0 if failure is None else 125, "ok", stderr + "diagnostic", False)

    monkeypatch.setattr(judge, "_run_bounded_process", run)
    if failure is not None:
        with pytest.raises(judge.SandboxUnavailable):
            judge._local_run(None, Path("work"), ["program"], 128, 2)
    else:
        result = judge._local_run(None, Path("work"), ["program"], 128, 2)
        assert result.stderr == "diagnostic"
    assert seen["argv"][:3] == [judge.sys.executable, "-I", "-S"]
    assert seen["argv"][-2:] == ["--", "program"]
    assert "preexec_fn" not in seen["kwargs"]
    assert "spawn_lock" not in seen["kwargs"]
    assert "DATABASE_URL" not in seen["kwargs"]["env"]


@pytest.mark.parametrize("language", judge.SUPPORTED_LANGUAGES)
def test_all_language_compile_commands_remain_supported(monkeypatch, language):
    commands = []
    monkeypatch.setattr(judge.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(judge, "_shared_go_cache", lambda: Path("cache"))
    monkeypatch.setattr(judge, "_local_run", lambda *args, **kwargs: commands.append((args, kwargs)) or judge.ProcessResult(0, "", "", False))

    run_command, error = judge._local_compile(language, Path("work"), 256)

    assert error is None
    assert run_command
    assert len(commands) == 1
    assert commands[0][1]["fsize_bytes"] == judge._LOCAL_COMPILE_FSIZE_BYTES


@pytest.mark.parametrize("language", judge.SUPPORTED_LANGUAGES)
@pytest.mark.parametrize("returncode,stderr", [(-9, ""), (-11, ""), (1, "Resource temporarily unavailable"), (1, "internal compiler error")])
def test_compiler_infrastructure_failure_is_not_contestant_ce(monkeypatch, language, returncode, stderr):
    monkeypatch.setattr(judge.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(judge, "_shared_go_cache", lambda: Path("cache"))
    monkeypatch.setattr(judge, "_local_run", lambda *_args, **_kwargs: judge.ProcessResult(returncode, "", stderr, False))

    with pytest.raises(judge.SandboxUnavailable):
        judge._local_compile(language, Path("work"), 256)


@pytest.mark.parametrize("language", judge.SUPPORTED_LANGUAGES)
def test_compiler_diagnostics_still_produce_ce(monkeypatch, language):
    monkeypatch.setattr(judge.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(judge, "_shared_go_cache", lambda: Path("cache"))
    monkeypatch.setattr(judge, "_local_run", lambda *_args, **_kwargs: judge.ProcessResult(1, "", "syntax error", False))

    run_command, error = judge._local_compile(language, Path("work"), 256)

    assert run_command == []
    assert error == "syntax error"


def test_valid_hundred_case_problem_can_take_more_than_sixty_seconds(monkeypatch):
    clock = [0.0]

    @contextmanager
    def temporary_directory(**_kwargs):
        yield "work"

    def run(*_args, **_kwargs):
        clock[0] += 1.0
        return judge.ProcessResult(0, "ok\n", "", False)

    monkeypatch.setattr(judge.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(judge.tempfile, "TemporaryDirectory", temporary_directory)
    monkeypatch.setattr(judge, "_prepare", lambda *_args: None)
    monkeypatch.setattr(judge, "_local_compile", lambda *_args: (["program"], None))
    monkeypatch.setattr(judge, "_local_run", run)
    request = judge.JudgeRequest(language="python", code="", time_limit_ms=2000, memory_mb=256, cases=[judge.JudgeCase(stdin="", expected_stdout="ok\n") for _ in range(100)])

    result = judge._execute_judge(request, "rlimit")

    assert clock[0] == 100
    assert result.status == "accepted"
    assert result.passed_tests == 100
    assert not result.infra_error


@pytest.mark.parametrize("operation", ["heartbeat", "complete", "retry", "unavailable"])
def test_stale_attempt_cannot_write_any_state(monkeypatch, operation):
    cursor = _install(monkeypatch, _Cursor(fetchone_rows=[None]))
    job = queue.ClaimedJob(11, 22, 2, 5)
    if operation == "heartbeat":
        assert queue.heartbeat_worker("worker", job, 30) is False
    elif operation == "complete":
        assert queue.complete_job("worker", job, _result()) is False
    elif operation == "retry":
        assert queue.retry_job("worker", job, "unavailable") is False
    else:
        queue.mark_job_unavailable("worker", job)
    assert len(cursor.queries) == 2
    assert cursor.queries[0] == ("SELECT id FROM judge_jobs WHERE id = %s FOR NO KEY UPDATE", (11,))
    assert "leased_by = %s" in cursor.queries[1][0]
    assert "attempts = %s" in cursor.queries[1][0]
    assert "lease_expires_at > clock_timestamp()" in cursor.queries[1][0]


def test_lease_lost_during_submission_load_does_not_start_execution(monkeypatch):
    events = {}

    def remember_lease(_worker, _job, _stop, lost):
        events["lost"] = lost

    def load(_id):
        events["lost"].set()
        return _submission()

    monkeypatch.setattr(worker.threading, "Thread", lambda target, args, **_kwargs: SimpleNamespace(start=lambda: target(*args), join=lambda **_kwargs: None))
    monkeypatch.setattr(worker, "_keep_lease_alive", remember_lease)
    monkeypatch.setattr(worker, "_uses_cloudrun_job_dispatch", lambda: False)
    monkeypatch.setattr(queue, "load_submission", load)
    monkeypatch.setattr(worker, "_execute_local_submission", lambda *_args: pytest.fail("lease lost before execution"))

    worker._process_job("worker", _job())


@pytest.mark.parametrize("missing", ["gcc", "g++", "javac", "java", "go", "rustc", "cc", "node"])
def test_worker_requires_every_supported_toolchain(monkeypatch, missing):
    monkeypatch.setattr(judge, "resource", object())
    monkeypatch.setattr(judge.shutil, "which", lambda name: None if name == missing else f"/usr/bin/{name}")
    with pytest.raises(judge.SandboxUnavailable, match="worker toolchains unavailable"):
        judge.validate_local_toolchains()


def test_worker_rejects_unavailable_backend_before_database_access(monkeypatch):
    monkeypatch.setattr(worker, "resolve_sandbox_backend", lambda: "unavailable")
    monkeypatch.setattr(worker.db, "init_pool", lambda: pytest.fail("database opened before config validation"))
    with pytest.raises(RuntimeError, match="No judge backend configured"):
        worker.run()


def test_worker_rejects_broken_toolchains_before_database_access(monkeypatch):
    monkeypatch.setattr(worker, "resolve_sandbox_backend", lambda: "rlimit")
    monkeypatch.setattr(worker.db, "init_pool", lambda: pytest.fail("database opened before config validation"))

    def unavailable():
        raise judge.SandboxUnavailable("missing toolchain")

    monkeypatch.setattr(worker, "validate_local_toolchains", unavailable)
    with pytest.raises(judge.SandboxUnavailable):
        worker.run()


@pytest.mark.parametrize("launched", [False, True])
def test_launcher_timeout_is_infrastructure_only_before_exec(monkeypatch, launched):
    monkeypatch.setattr(judge, "resource", object())
    monkeypatch.setattr(judge, "_uid_process_allowance", lambda: 64)

    def timeout(argv, seconds, *_args, **_kwargs):
        marker = argv[argv.index("--marker") + 1]
        raise judge.subprocess.TimeoutExpired(argv, seconds, stderr=f"{marker}\nprogram diagnostic" if launched else "")

    monkeypatch.setattr(judge, "_run_bounded_process", timeout)
    if launched:
        with pytest.raises(judge.subprocess.TimeoutExpired) as error:
            judge._local_run(None, Path("work"), ["program"], 128, 2)
        assert error.value.stderr == "program diagnostic"
    else:
        with pytest.raises(judge.SandboxUnavailable):
            judge._local_run(None, Path("work"), ["program"], 128, 2)


@pytest.mark.parametrize("exec_fails", [False, True])
def test_limit_launcher_installs_caps_before_exec_without_importing_app(monkeypatch, exec_fails):
    limits = []
    messages = []
    executed = []
    fake_resource = SimpleNamespace(
        RLIMIT_CPU=1, RLIMIT_CORE=2, RLIMIT_FSIZE=3, RLIMIT_AS=4,
        RLIMIT_NPROC=5, RLIMIT_NOFILE=6, RLIM_INFINITY=-1,
        setrlimit=lambda kind, values: limits.append((kind, values)),
        getrlimit=lambda _kind: (1024, 1024),
    )
    monkeypatch.setitem(sys.modules, "resource", fake_resource)
    spec = importlib.util.spec_from_file_location("test_limit_launcher", Path(judge.__file__).with_name("rlimit_exec.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def execute(program, command, environment):
        executed.append((program, command, environment))
        if exec_fails:
            raise OSError("not executable")

    module.os = SimpleNamespace(write=lambda fd, text: messages.append((fd, text)), execvpe=execute, environ={"PATH": "/usr/bin"})
    monkeypatch.setattr(sys, "argv", ["launcher", "--cpu-seconds", "2", "--memory-mb", "128", "--file-bytes", "1048576", "--nproc", "64", "--marker", "marker", "--", "program", "arg"])
    if exec_fails:
        with pytest.raises(SystemExit) as error:
            module.main()
        assert error.value.code == 125
        assert messages[-1] == (2, b"marker:failed\n")
    else:
        module.main()
    assert limits == [(1, (2, 3)), (2, (0, 0)), (3, (1048576, 1048576)), (4, (134217728, 134217728)), (5, (64, 64)), (6, (256, 256))]
    assert executed == [("program", ["program", "arg"], {"PATH": "/usr/bin"})]
    assert messages[0] == (2, b"marker\n")


def test_recovery_failure_does_not_block_new_claims(monkeypatch):
    stopping = iter([False, True])
    claims = []
    event = SimpleNamespace(is_set=lambda: next(stopping), set=lambda: None, wait=lambda _seconds: None)
    monkeypatch.setattr(worker.threading, "Event", lambda: event)
    monkeypatch.setattr(worker.signal, "signal", lambda *_args: None)
    monkeypatch.setattr(worker, "resolve_sandbox_backend", lambda: "rlimit")
    monkeypatch.setattr(worker, "validate_local_toolchains", lambda: None)
    monkeypatch.setattr(worker, "warm_go_cache", lambda: None)
    monkeypatch.setattr(worker.db, "init_pool", lambda: None)
    monkeypatch.setattr(worker.db, "close_pool", lambda: None)
    monkeypatch.setattr(queue, "register_worker", lambda *_args: None)
    monkeypatch.setattr(queue, "mark_worker_stopping", lambda *_args: None)

    def fail_recovery():
        raise RuntimeError("locked exhausted submission")

    monkeypatch.setattr(queue, "finalize_exhausted_jobs", fail_recovery)
    monkeypatch.setattr(queue, "claim_job", lambda *args: claims.append(args) or None)

    worker.run()

    assert len(claims) == 1


def test_io_thread_start_failure_cleans_up_process_and_pipes(monkeypatch):
    killed = []
    reaped = []
    waits = []
    process = SimpleNamespace(
        pid=12345, stdout=io.BytesIO(), stderr=io.BytesIO(), stdin=io.BytesIO(),
        wait=lambda: waits.append(True),
    )

    class Thread:
        def __init__(self, **_kwargs):
            self.ident = None

        def start(self):
            raise RuntimeError("can't start new thread")

        def is_alive(self):
            return False

    monkeypatch.setattr(judge, "_enable_child_subreaper", lambda: None)
    monkeypatch.setattr(judge, "_kill_process_group", lambda child: killed.append(child.pid))
    monkeypatch.setattr(judge, "_reap_process_group", reaped.append)
    monkeypatch.setattr(judge.subprocess, "Popen", lambda *_args, **_kwargs: process)
    monkeypatch.setattr(judge.threading, "Thread", Thread)
    with pytest.raises(judge.SandboxUnavailable, match="IO threads"):
        judge._run_bounded_process(["program"], 1)
    assert killed == reaped == [12345]
    assert waits == [True]
    assert process.stdin.closed and process.stdout.closed and process.stderr.closed


@pytest.mark.parametrize("returncode", [0, -1])
def test_subreaper_setup_is_required_and_cached_on_linux(monkeypatch, returncode):
    calls = []
    monkeypatch.setattr(judge.sys, "platform", "linux")
    monkeypatch.setattr(judge, "_subreaper_enabled", False)
    monkeypatch.setattr(judge.ctypes, "CDLL", lambda *_args, **_kwargs: SimpleNamespace(prctl=lambda *args: calls.append(args) or returncode))
    if returncode == -1:
        with pytest.raises(judge.SandboxUnavailable, match="reaping unavailable"):
            judge._enable_child_subreaper()
        assert not judge._subreaper_enabled
    else:
        judge._enable_child_subreaper()
        judge._enable_child_subreaper()
        assert judge._subreaper_enabled
    assert calls == [(36, 1, 0, 0, 0)]


def test_descendant_reaper_waits_for_exit_and_drains_all_children(monkeypatch):
    results = iter([(123, 9), (0, 0), (456, 9)])
    groups = []

    def waitpid(group, options):
        groups.append((group, options))
        try:
            return next(results)
        except StopIteration:
            raise ChildProcessError

    monkeypatch.setattr(judge.sys, "platform", "linux")
    monkeypatch.setattr(judge, "_subreaper_enabled", True)
    monkeypatch.setattr(judge.os, "WNOHANG", 1, raising=False)
    monkeypatch.setattr(judge.os, "waitpid", waitpid, raising=False)
    monkeypatch.setattr(judge.time, "sleep", lambda _seconds: None)
    judge._reap_process_group(100)
    assert groups == [(-100, 1)] * 4


def test_go_toolchain_probe_uses_its_supported_version_command(monkeypatch):
    from tests.test_hostile_corpus import _toolchain_usable

    commands = []
    monkeypatch.setattr(judge.shutil, "which", lambda _name: "/usr/bin/go")
    monkeypatch.setattr(judge.subprocess, "run", lambda argv, **_kwargs: commands.append(argv) or SimpleNamespace(returncode=0))
    assert _toolchain_usable.__wrapped__("go") is True
    assert commands == [["go", "version"]]


@pytest.mark.parametrize("returncode", [0, 2])
def test_go_warmup_has_no_address_space_cap_and_checks_exit(monkeypatch, tmp_path, caplog, returncode):
    calls = []

    @contextmanager
    def temporary_directory(**_kwargs):
        yield str(tmp_path)

    def run(*args, **kwargs):
        calls.append((args, kwargs))
        return judge.ProcessResult(returncode, "", "", False)

    monkeypatch.setattr(judge, "resolve_sandbox_backend", lambda: "rlimit")
    monkeypatch.setattr(judge.shutil, "which", lambda _name: "/usr/bin/go")
    monkeypatch.setattr(judge.tempfile, "TemporaryDirectory", temporary_directory)
    monkeypatch.setattr(judge, "_shared_go_cache", lambda: tmp_path)
    monkeypatch.setattr(judge, "_local_run", run)
    caplog.set_level("INFO", logger="koj.judge")
    judge.warm_go_cache()
    assert len(calls) == 1
    assert calls[0][0][3] == 0
    assert ("cache warmed" in caplog.text) is (returncode == 0)
    assert ("warm-up failed" in caplog.text) is (returncode != 0)


@pytest.mark.parametrize("language", judge.SUPPORTED_LANGUAGES)
def test_infrastructure_phrase_in_echoed_source_remains_compilation_error(monkeypatch, language):
    stderr = '  File "solution.py", line 1\n    print("Resource temporarily unavailable"\nSyntaxError: unexpected EOF\n'
    monkeypatch.setattr(judge.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(judge, "_shared_go_cache", lambda: Path("cache"))
    monkeypatch.setattr(judge, "_local_run", lambda *_args, **_kwargs: judge.ProcessResult(1, "", stderr, False))
    run_command, error = judge._local_compile(language, Path("work"), 256)
    assert run_command == []
    assert error == stderr.strip()


@pytest.mark.parametrize("stderr", [
    "cc1plus: fatal error: cannot allocate memory",
    "solution.cpp:1:13: internal compiler error: compiler crashed",
    "javac: unable to create native thread",
])
def test_prefixed_compiler_infrastructure_diagnostics_still_retry(monkeypatch, stderr):
    monkeypatch.setattr(judge.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(judge, "_local_run", lambda *_args, **_kwargs: judge.ProcessResult(1, "", stderr, False))
    with pytest.raises(judge.SandboxUnavailable):
        judge._local_compile("c++", Path("work"), 256)
