"""Opt-in real queue checks; only disposable, isolated Docker PostgreSQL.

From the repository root:
  python scripts/deployment/verify-postgres-queue.py --test-image koj-judge-audit-tests:local

Build a current test image first if needed (network only during Docker build):
  docker build -f api/Dockerfile -t koj-judge:local api
  docker build -f api/Dockerfile.test --build-arg JUDGE_IMAGE=koj-judge:local -t koj-judge-tests:local api

No host DSN/environment files, published ports, Docker socket mounts, or persistent
volumes are used. Journal SQL replay tests an empty schema, not Drizzle's ledger
or upgrades from existing production data. Every command has a timeout.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]
LABEL = "koj.disposable-postgres-check"


def docker(*args: str, timeout: int = 30, input_text: str | None = None) -> str:
    command = ["docker", *args]
    print("+ " + " ".join(command), flush=True)
    result = subprocess.run(command, input=input_text, text=True, capture_output=True, timeout=timeout)
    if result.stdout:
        print(result.stdout, end="", flush=True)
    if result.stderr:
        print(result.stderr, end="", flush=True)
    result.check_returncode()
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-image", default="koj-judge-tests:local")
    parser.add_argument("--postgres-image", default="postgres:16")
    parser.add_argument("--test-filter", default="", help="Optional pytest -k expression for focused reruns")
    args = parser.parse_args()
    migrations = ROOT / "db" / "migrations"
    entries = json.loads((migrations / "meta" / "_journal.json").read_text())["entries"]
    tags = [entry["tag"] for entry in entries]
    files = {path.stem for path in migrations.glob("*.sql")}
    if len(tags) != len(set(tags)) or set(tags) != files:
        raise RuntimeError("Journal must list every SQL file exactly once; resolve migration drift first")
    if [entry["idx"] for entry in entries] != list(range(len(entries))):
        raise RuntimeError("Migration journal indices are not contiguous")
    if [entry["when"] for entry in entries] != sorted(entry["when"] for entry in entries):
        raise RuntimeError("Migration timestamps are not monotonic")
    sql = "BEGIN;\n" + "\n".join(
        f"\\echo Applying {tag}\n" + (migrations / f"{tag}.sql").read_text() for tag in tags
    ) + "\nCOMMIT;\nCOMMENT ON DATABASE koj_queue_test IS 'koj-disposable-postgres-check';\n"
    docker("version", "--format", "{{.Server.Os}} {{.Server.Version}}")
    docker("image", "inspect", args.test_image, "--format", "{{.Id}}")
    suffix = uuid.uuid4().hex[:12]
    network = f"koj-pg-check-{suffix}"
    postgres = f"{network}-db"
    runner = f"{network}-tests"
    try:
        docker("network", "create", "--internal", "--label", LABEL, network)
        docker("run", "-d", "--name", postgres, "--label", LABEL,
               "--network", network, "--network-alias", "koj-postgres",
               "--memory", "512m", "--cpus", "2", "--pids-limit", "128",
               "--tmpfs", "/var/lib/postgresql/data:rw,size=256m",
               "-e", "POSTGRES_USER=koj_test", "-e", "POSTGRES_PASSWORD=koj_test_only",
               "-e", "POSTGRES_DB=koj_queue_test", args.postgres_image, timeout=180)
        deadline = time.monotonic() + 45
        while True:
            try:
                docker("exec", postgres, "pg_isready", "-h", "127.0.0.1", "-U", "koj_test", "-d", "koj_queue_test", timeout=5)
                break
            except subprocess.CalledProcessError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Disposable PostgreSQL readiness timed out")
                time.sleep(1)
        docker("exec", "-i", postgres, "psql", "-X", "-v", "ON_ERROR_STOP=1",
               "-U", "koj_test", "-d", "koj_queue_test", input_text=sql, timeout=60)
        print(f"Applied all {len(tags)} journal migrations in one transaction", flush=True)
        mounts = ["--mount", f"type=bind,src={ROOT / 'api' / 'app'},dst=/srv/app,readonly",
                  "--mount", f"type=bind,src={ROOT / 'api' / 'integration_tests'},dst=/srv/integration_tests,readonly",
                  "--mount", f"type=bind,src={ROOT / 'api' / 'conftest.py'},dst=/srv/conftest.py,readonly"]
        docker("run", "--rm", "--init", "--name", runner, "--label", LABEL,
               "--network", network, "--memory", "2g", "--cpus", "2", "--pids-limit", "256",
               "-e", "KOJ_DISPOSABLE_POSTGRES=1", "-e", "PYTHONDONTWRITEBYTECODE=1",
               *mounts, args.test_image, "-v", "-p", "no:cacheprovider",
               "integration_tests/test_postgres_queue.py", "-k", args.test_filter, timeout=240)
    finally:
        # Also remove stopped containers after timeouts/interrupted docker clients.
        cleanup_errors = []
        for name in (runner, postgres):
            try:
                exists = docker("ps", "-aq", "--filter", f"name=^/{name}$", timeout=10).strip()
                if exists:
                    docker("rm", "-f", "-v", name, timeout=30)
            except (subprocess.SubprocessError, OSError) as exc:
                cleanup_errors.append(f"container {name}: {type(exc).__name__}")
        try:
            docker("network", "rm", network, timeout=30)
        except (subprocess.SubprocessError, OSError) as exc:
            cleanup_errors.append(f"network {network}: {type(exc).__name__}")
        if cleanup_errors:
            raise RuntimeError("Docker cleanup failed: " + "; ".join(cleanup_errors))


if __name__ == "__main__":
    main()
