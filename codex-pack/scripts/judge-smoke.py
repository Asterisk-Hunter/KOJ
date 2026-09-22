#!/usr/bin/env python3
"""KOJ judge smoke test — exercises every language and every verdict.

Reads JUDGE_URL and JUDGE_INTERNAL_SECRET from the environment; never prints the
secret. Exits non-zero on any mismatch, so it is safe to use as a gate before a
contest or after a deploy.

    export JUDGE_URL=https://koj-judge-189400571693.asia-south1.run.app
    export JUDGE_INTERNAL_SECRET=...
    python3 scripts/judge-smoke.py            # full matrix
    python3 scripts/judge-smoke.py --quick    # python AC / WA / TLE only

Keep this file OUTSIDE the repo (AGENTS.md rule 5 forbids committing test files).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

CASES = [
    {"stdin": "2 3\n", "expected_stdout": "5\n", "is_sample": True},
    {"stdin": "10 20\n", "expected_stdout": "30\n", "is_sample": False},
]

PY_AC = "a,b=map(int,input().split())\nprint(a+b)"
PY_WA = "print(0)"
PY_CE = "def f(\n"
PY_RE = "raise SystemExit(3)"
PY_TLE = "while True: pass"
PY_MLE = "x = bytearray(600*1024*1024)"
C_AC = '#include <stdio.h>\nint main(){long a,b;scanf("%ld %ld",&a,&b);printf("%ld\\n",a+b);}'
CPP_AC = "#include <iostream>\nint main(){long a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;}"
CPP_TLE = "#include <iostream>\nint main(){volatile long x=0;while(true)x++;}"
JAVA_AC = (
    "import java.util.*;public class Solution{public static void main(String[] a){"
    "Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}"
)
GO_AC = "package main\nimport \"fmt\"\nfunc main(){var a,b int64;fmt.Scan(&a,&b);fmt.Println(a+b)}\n"
GO_TLE = "package main\nfunc main(){for{} }\n"
RUST_AC = "use std::io::Read;fn main(){let mut s=String::new();std::io::stdin().read_to_string(&mut s).unwrap();let v:Vec<i64>=s.split_whitespace().map(|x|x.parse().unwrap()).collect();println!(\"{}\",v[0]+v[1]);}\n"
JS_AC = "const d=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(d[0]+d[1]);"
JS_TLE = "while(true){}"

# Every language is judged against a 2 s limit except where noted; Go/Rust compile
# inside the same budget, hence the extra headroom.

# (name, body, expected verdict)
FULL = [
    ("python AC", ("python", PY_AC, 2000, 256), "accepted"),
    ("python WA", ("python", PY_WA, 2000, 256), "wrong_answer"),
    ("python CE", ("python", PY_CE, 2000, 256), "compilation_error"),
    ("python RE", ("python", PY_RE, 2000, 256), "runtime_error"),
    ("python TLE", ("python", PY_TLE, 1000, 256), "time_limit_exceeded"),
    ("python MLE", ("python", PY_MLE, 2000, 64), "memory_limit_exceeded"),
    ("c AC", ("c", C_AC, 2000, 256), "accepted"),
    ("c++ AC", ("c++", CPP_AC, 2000, 256), "accepted"),
    ("c++ TLE", ("c++", CPP_TLE, 1000, 256), "time_limit_exceeded"),
    ("java AC", ("java", JAVA_AC, 6000, 256), "accepted"),
    ("go AC", ("go", GO_AC, 8000, 256), "accepted"),
    ("go TLE", ("go", GO_TLE, 1000, 256), "time_limit_exceeded"),
    ("rust AC", ("rust", RUST_AC, 8000, 256), "accepted"),
    ("javascript AC", ("javascript", JS_AC, 4000, 256), "accepted"),
    ("javascript TLE", ("javascript", JS_TLE, 1000, 256), "time_limit_exceeded"),
]
QUICK = [t for t in FULL if t[0] in {"python AC", "python WA", "python TLE"}]


def post(base: str, path: str, payload: dict, secret: str | None, timeout: int = 120):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if secret:
        req.add_header("X-Judge-Secret", secret)
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode()), time.time() - started
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:200], time.time() - started


def get(base: str, path: str) -> str:
    with urllib.request.urlopen(base + path, timeout=30) as response:
        return response.read().decode()[:300]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="python AC/WA/TLE only")
    args = parser.parse_args()

    base = (os.environ.get("JUDGE_URL") or "").rstrip("/")
    secret = os.environ.get("JUDGE_INTERNAL_SECRET") or ""
    if not base or not secret:
        print("JUDGE_URL and JUDGE_INTERNAL_SECRET must be set", file=sys.stderr)
        return 2

    try:
        health = get(base, "/health")
    except Exception as exc:  # noqa: BLE001 - report and continue to the matrix
        print(f"health check failed: {exc}", file=sys.stderr)
        return 2
    print(f"health: {health}")
    if '"sandbox"' in health and '"rlimit"' not in health and '"docker"' not in health:
        print("WARNING: /health does not report a usable sandbox", file=sys.stderr)

    failures = 0
    for name, (language, code, time_limit_ms, memory_mb), expected in (QUICK if args.quick else FULL):
        status, body, elapsed = post(
            base,
            "/judge",
            {
                "language": language,
                "code": code,
                "cases": CASES,
                "time_limit_ms": time_limit_ms,
                "memory_mb": memory_mb,
            },
            secret,
        )
        got = body.get("status") if isinstance(body, dict) else body
        ok = got == expected
        failures += 0 if ok else 1
        infra = body.get("infra_error") if isinstance(body, dict) else None
        detail = (body.get("error_message") or "")[:70] if isinstance(body, dict) else body
        print(
            f"{'PASS' if ok else 'FAIL'} {name:11s} http={status} {elapsed:5.2f}s "
            f"status={got} infra={infra} err={detail!r}"
        )

    # Hidden-case redaction must hold: sample stdout kept, hidden stdout empty.
    _, body, _ = post(
        base,
        "/judge",
        {
            "language": "python",
            "code": PY_AC,
            "cases": CASES,
            "time_limit_ms": 2000,
            "memory_mb": 256,
        },
        secret,
    )
    if isinstance(body, dict):
        sample, hidden = body["cases"][0]["stdout"], body["cases"][1]["stdout"]
        ok = sample != "" and hidden == ""
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'} redaction   sample={sample!r} hidden={hidden!r}")

    # A problem with no test cases must never produce a pass. Regression guard for
    # the free-AC bug: an empty case list used to return "accepted" 0/0.
    _, body, _ = post(
        base,
        "/judge",
        {
            "language": "python",
            "code": "print('definitely not the answer')",
            "cases": [],
            "time_limit_ms": 2000,
            "memory_mb": 256,
        },
        secret,
    )
    if isinstance(body, dict):
        got = body.get("status")
        ok = got != "accepted" and body.get("infra_error") is True
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'} zero cases  status={got} infra_error={body.get('infra_error')}")

    # Auth and validation gates.
    for label, status, body, expected_status in (
        ("no secret", *post(base, "/judge", {"language": "python", "code": PY_AC, "cases": CASES, "time_limit_ms": 1000, "memory_mb": 64}, None)[:2], 401),
        # NOTE: must stay an *unsupported* language. "rust" used to be the probe here and
        # is now a real language — using it would assert 422 against a 200.
        ("bad language", *post(base, "/judge", {"language": "perl", "code": "x", "cases": CASES, "time_limit_ms": 1000, "memory_mb": 64}, secret)[:2], 422),
    ):
        ok = status == expected_status
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'} {label:11s} http={status} expected={expected_status}")

    print(f"\nFAILURES: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
