"""Run the deployed Docker boundary probes before enabling public judging."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

os.environ.update(
    {
        "DATABASE_URL": "postgresql://probe:probe@127.0.0.1/koj_probe",
        "JUDGE_INTERNAL_SECRET": "probe-secret-must-not-enter-container",
        "JUDGE_SANDBOX_MODE": "docker",
        "JUDGE_MAX_CONCURRENT": "1",
    }
)
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))

from app.judge import JudgeCase, JudgeRequest, JudgeResponse, execute_judge, resolve_sandbox_backend

SMOKE = {
    "python": "a, b = map(int, input().split())\nprint(a + b)\n",
    "c": r'''#include <stdio.h>
int main(void){int a,b;scanf("%d%d",&a,&b);printf("%d\n",a+b);}''',
    "c++": r'''#include <iostream>
int main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<"\n";}''',
    "java": 'import java.util.*; public class Solution { public static void main(String[] x){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}\n',
    "go": 'package main\nimport "fmt"\nfunc main(){var a,b int;fmt.Scan(&a,&b);fmt.Println(a+b)}\n',
    "rust": 'use std::io; fn main(){let mut s=String::new();io::stdin().read_line(&mut s).unwrap();let v:Vec<i32>=s.split_whitespace().map(|x|x.parse().unwrap()).collect();println!("{}",v[0]+v[1]);}\n',
    "javascript": r'const fs=require("fs");const [a,b]=fs.readFileSync(0,"utf8").trim().split(/\s+/).map(Number);console.log(a+b);',
}


def judge(
    language: str,
    code: str,
    *,
    expected_stdout: str = "42\n",
    timeout_ms: int = 5000,
    memory_mb: int = 256,
) -> JudgeResponse:
    return execute_judge(
        JudgeRequest(
            language=language,
            code=code,
            cases=[JudgeCase(stdin="19 23\n", expected_stdout=expected_stdout, is_sample=True)],
            time_limit_ms=timeout_ms,
            memory_mb=memory_mb,
        )
    )


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def require_result(name: str, result: JudgeResponse, *, status: str, stdout: str | None = None) -> None:
    case = result.cases[0] if result.cases else None
    if result.status != status or result.infra_error or (stdout is not None and (case is None or case.stdout.strip() != stdout)):
        raise RuntimeError(
            f"{name} failed: status={result.status} infra_error={result.infra_error} "
            f"error={str(result.error_message or '')[:300]!r} "
            f"stdout={case.stdout[:300] if case else ''!r} stderr={case.stderr[:300] if case else ''!r}"
        )


def main() -> None:
    require(resolve_sandbox_backend() == "docker", "Docker backend is not selected")
    require(os.path.exists("/etc/koj/seccomp-koj.json"), "host seccomp profile is missing")

    for language, code in SMOKE.items():
        result = judge(language, code)
        require_result(f"{language} AC probe", result, status="accepted", stdout="42")
        print(f"PASS {language} accepted")

    with tempfile.NamedTemporaryFile(prefix="koj-parent-probe-", delete=False) as parent_file:
        parent_path = Path(parent_file.name)
        parent_file.write(b"host-only marker")
    try:
        boundary_code = f"""
import os, pathlib, socket, urllib.request
assert os.geteuid() != 0
process_status = pathlib.Path('/proc/self/status').read_text()
assert 'NoNewPrivs:\\t1' in process_status
assert 'Seccomp:\\t2' in process_status
assert 'CapEff:\\t0000000000000000' in process_status
assert os.getenv('DATABASE_URL') is None
assert os.getenv('JUDGE_INTERNAL_SECRET') is None
process_one_environment = pathlib.Path('/proc/1/environ').read_bytes()
assert b'DATABASE_URL=' not in process_one_environment
assert b'JUDGE_INTERNAL_SECRET=' not in process_one_environment
assert not pathlib.Path({str(parent_path)!r}).exists()
root = next(line for line in pathlib.Path('/proc/mounts').read_text().splitlines() if line.split()[1] == '/')
assert 'ro,' in root or root.endswith(' ro')
cpu_max = pathlib.Path('/sys/fs/cgroup/cpu.max')
if cpu_max.exists():
    quota, period = cpu_max.read_text().split()
    assert quota != 'max' and 0 < int(quota) <= int(period)
else:
    quota = int(pathlib.Path('/sys/fs/cgroup/cpu/cpu.cfs_quota_us').read_text())
    period = int(pathlib.Path('/sys/fs/cgroup/cpu/cpu.cfs_period_us').read_text())
    assert 0 < quota <= period
pids_max = pathlib.Path('/sys/fs/cgroup/pids.max')
if pids_max.exists():
    assert int(pids_max.read_text()) <= 64
else:
    assert int(pathlib.Path('/sys/fs/cgroup/pids/pids.max').read_text()) <= 64
memory_max = pathlib.Path('/sys/fs/cgroup/memory.max')
if memory_max.exists():
    assert int(memory_max.read_text()) <= 256 * 1024 * 1024
else:
    assert int(pathlib.Path('/sys/fs/cgroup/memory/memory.limit_in_bytes').read_text()) <= 256 * 1024 * 1024
try:
    open('/usr/local/koj-host-write-probe', 'w').close()
except OSError:
    pass
else:
    raise AssertionError('root filesystem accepts writes')
for address in ('169.254.169.254', '127.0.0.1'):
    try:
        socket.create_connection((address, 80), timeout=0.5)
    except OSError:
        pass
    else:
        raise AssertionError('network access is available')
try:
    urllib.request.urlopen('http://metadata.google.internal/computeMetadata/v1/', timeout=0.5)
except Exception:
    pass
else:
    raise AssertionError('metadata service is reachable')
print('boundary-ok')
"""
        boundary = judge("python", boundary_code, expected_stdout="boundary-ok\n")
        require_result(
            "filesystem/network/metadata/secret probe",
            boundary,
            status="accepted",
            stdout="boundary-ok",
        )
        print("PASS filesystem/network/metadata/secrets")
    finally:
        parent_path.unlink(missing_ok=True)

    timeout = judge("python", "while True: pass", timeout_ms=300)
    require_result("wall timeout probe", timeout, status="time_limit_exceeded")
    print("PASS timeout")

    flood = judge("python", "print('x' * 2097152)")
    require_result("output cap probe", flood, status="runtime_error")
    print("PASS output cap")

    process_code = """
import subprocess
children=[]
blocked=False
try:
    for _ in range(128):
        children.append(subprocess.Popen(['sleep','5']))
except OSError:
    blocked=True
finally:
    for child in children:
        child.terminate()
    for child in children:
        child.wait()
print('pids-blocked' if blocked else 'pids-unbounded')
"""
    process_count = judge("python", process_code, expected_stdout="pids-blocked\n")
    require_result("PID cap probe", process_count, status="accepted", stdout="pids-blocked")
    print("PASS PID cap")

    memory = judge("python", "bytearray(1536 * 1024 * 1024)", memory_mb=128)
    require(memory.status in ("runtime_error", "memory_limit_exceeded") and not memory.infra_error, "memory cgroup probe failed")
    print("PASS memory cap")

    print("Docker host probes passed; this does not establish aggregate host-capacity safety.")


if __name__ == "__main__":
    main()
