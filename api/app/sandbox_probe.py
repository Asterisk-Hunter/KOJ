"""Deployment probes for the Cloud Run sandbox execution boundary."""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path

from .judge import JudgeCase, JudgeRequest, _run_cloudrun, execute_judge, resolve_sandbox_backend

logger = logging.getLogger("koj.sandbox_probe")

_PROBE_CODE = """
import os, pathlib, shutil, socket, subprocess
assert os.getenv('DATABASE_URL') is None
assert os.getenv('JUDGE_INTERNAL_SECRET') is None
assert os.getenv('KOJ_PROBE_PARENT') is None
assert os.geteuid() != 0
assert 'NoNewPrivs:\\t1' in pathlib.Path('/proc/self/status').read_text()
try:
    process_one_environment = pathlib.Path('/proc/1/environ').read_bytes()
except OSError:
    process_one_environment = b''
assert b'DATABASE_URL=' not in process_one_environment
assert b'JUDGE_INTERNAL_SECRET=' not in process_one_environment
if shutil.which('sudo'):
    assert subprocess.run(['sudo', '-n', 'id', '-u'], capture_output=True).returncode != 0
assert not pathlib.Path('/srv/app').exists()
assert not pathlib.Path(__PARENT_PATH__).exists()
for target in ('169.254.169.254', '1.1.1.1'):
    try:
        socket.create_connection((target, 80), timeout=0.5)
    except OSError:
        pass
    else:
        raise AssertionError('sandbox outbound network reachable')
print('boundary-ok')
"""

_SMOKE_CODE = {
    "python": "print(42)",
    "c": '#include <stdio.h>\nint main(void) { puts("42"); }',
    "c++": '#include <iostream>\nint main() { std::cout << 42 << "\\n"; }',
    "java": 'public class Solution { public static void main(String[] args) { System.out.println(42); } }',
    "go": 'package main\nimport "fmt"\nfunc main() { fmt.Println(42) }',
    "rust": 'fn main() { println!("42"); }',
    "javascript": 'console.log(42)',
}


def run_boundary_probe() -> None:
    if resolve_sandbox_backend() != "cloudrun":
        raise RuntimeError("Cloud Run sandbox backend is not selected")
    with tempfile.TemporaryDirectory(prefix="koj-probe-") as directory:
        parent_file = Path(directory) / "parent-only"
        parent_file.write_text("private", encoding="utf-8")
        workdir = Path(directory)
        code = _PROBE_CODE.replace("__PARENT_PATH__", repr(str(parent_file)))
        result = _run_cloudrun(None, workdir, ["python3", "-c", code], 128, 5)
        if result.returncode != 0 or result.stdout.strip() != "boundary-ok":
            raise RuntimeError("Cloud Run sandbox boundary probe failed")
    logger.info("Cloud Run sandbox boundary probe passed")


def run_deployment_probe() -> None:
    run_boundary_probe()
    for language, code in _SMOKE_CODE.items():
        result = execute_judge(JudgeRequest(
            language=language,
            code=code,
            cases=[JudgeCase(stdin="", expected_stdout="42\n", is_sample=True)],
            time_limit_ms=10_000,
            memory_mb=512,
        ))
        if result.infra_error or result.status != "accepted":
            raise RuntimeError(f"Cloud Run sandbox {language} smoke probe failed")
        logger.info("Cloud Run sandbox language probe passed language=%s", language)
    with tempfile.TemporaryDirectory(prefix="koj-probe-") as directory:
        workdir = Path(directory)
        try:
            _run_cloudrun(None, workdir, ["python3", "-c", "import time; time.sleep(5)"], 128, 0.5)
        except subprocess.TimeoutExpired:
            pass
        else:
            raise RuntimeError("Cloud Run sandbox timeout probe failed")
        flood = _run_cloudrun(None, workdir, ["python3", "-c", "print('x' * 2097152)"], 128, 5)
        if not flood.output_limit_exceeded:
            raise RuntimeError("Cloud Run sandbox output probe failed")
        fork_code = """
import subprocess
children = []
blocked = False
try:
    for _ in range(96):
        children.append(subprocess.Popen(['sleep', '2']))
except OSError:
    blocked = True
finally:
    for child in children:
        child.terminate()
    for child in children:
        child.wait()
print('fork-blocked' if blocked else 'fork-unbounded')
"""
        fork = _run_cloudrun(None, workdir, ["python3", "-c", fork_code], 128, 5)
        if fork.returncode != 0 or fork.stdout.strip() != "fork-blocked":
            raise RuntimeError("Cloud Run sandbox process probe failed")
        logger.info("Cloud Run sandbox limit probes passed")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    run_deployment_probe()
