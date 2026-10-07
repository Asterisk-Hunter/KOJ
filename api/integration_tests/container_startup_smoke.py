"""Bounded local control-image startup smoke; synthetic credentials, no cloud/DB."""

from __future__ import annotations

import argparse
import subprocess
import time

_CLIENT = '''import json, os, urllib.request, urllib.error
assert os.geteuid() != 0
origin = "http://127.0.0.1:8091"
with urllib.request.urlopen(origin + "/health", timeout=1) as response:
    assert response.status == 200
    assert json.load(response) == {"status": "ok"}
for request, expected in [
    (urllib.request.Request(origin + "/ready"), 401),
    (urllib.request.Request(origin + "/judge", data=json.dumps({
        "language": "python", "code": "print(42)", "cases": [],
        "time_limit_ms": 2000, "memory_mb": 256,
    }).encode(), headers={"Content-Type": "application/json", "X-Judge-Secret": "test"}), 503),
]:
    try:
        urllib.request.urlopen(request, timeout=1)
    except urllib.error.HTTPError as error:
        assert error.code == expected, (error.code, expected)
    else:
        raise AssertionError("protected/disabled endpoint unexpectedly succeeded")
print("health=200; unauthenticated ready=401; disabled judge=503")
'''


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Already built local control image")
    args = parser.parse_args()
    container = subprocess.run([
        "docker", "run", "--detach", "--network", "none",
        "--cpus", "1", "--memory", "512m", "--pids-limit", "128",
        "--env", "DATABASE_URL=postgresql://test:test@127.0.0.1:1/test",
        "--env", "JUDGE_INTERNAL_SECRET=test",
        "--env", "JUDGE_HTTP_EXECUTION_ENABLED=false",
        "--env", "PORT=8091", args.image,
    ], capture_output=True, text=True, check=True, timeout=30).stdout.strip()
    try:
        deadline = time.monotonic() + 40
        while True:
            result = subprocess.run(
                ["docker", "exec", container, "python", "-c", _CLIENT],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                print(f"Default non-root control CMD honored PORT=8091: {result.stdout.strip()}")
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Control startup probe failed: {result.stderr[-2000:]}")
            time.sleep(1)
        subprocess.run(["docker", "stop", "--time", "5", container], capture_output=True, check=True, timeout=15)
        exit_code = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.ExitCode}}", container],
            capture_output=True, text=True, check=True, timeout=5,
        ).stdout.strip()
        if exit_code != "0":
            raise RuntimeError(f"Control container did not stop gracefully: exit={exit_code}")
        print("SIGTERM shutdown exited cleanly")
    finally:
        subprocess.run(["docker", "rm", "--force", container], capture_output=True, check=True, timeout=10)
        print("Temporary control container removed")


if __name__ == "__main__":
    main()
