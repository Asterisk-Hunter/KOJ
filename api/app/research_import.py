"""Operator-only import for immutable, license-recorded research datasets."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from . import db
from .config import settings
from .judge import JudgeCase, JudgeRequest, execute_judge, resolve_sandbox_backend
from .research_adapter import (
    PYTHON_ASSERTIONS_ADAPTER,
    STDIN_STDOUT_ADAPTER,
    build_python_function_program,
    function_checker_code,
    validate_adapter,
    validate_function_cases,
)

_SLUG = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?\Z")
_SPLITS = {"train", "heldout", "external"}
_MAX_TASKS = 10_000
_MAX_PROBLEM_BYTES = 1024 * 1024


def _validate_immutable_problem_set(existing_ids: set[str], incoming_ids: set[str]) -> None:
    if existing_ids != incoming_ids:
        raise ValueError("dataset version is immutable; problem set differs")


def _https_url(value: object, name: str) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError(f"{name} must be a URL")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{name} must use HTTPS")
    return value


def _read_manifest(path: Path) -> dict[str, object]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be a JSON object")
    slug, version = manifest.get("slug"), manifest.get("version")
    if not isinstance(slug, str) or not _SLUG.fullmatch(slug):
        raise ValueError("manifest slug must be lowercase letters, digits, and hyphens")
    if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", version):
        raise ValueError("manifest version contains unsupported characters")
    license_id = manifest.get("license_id")
    if not isinstance(license_id, str) or not 1 <= len(license_id) <= 120:
        raise ValueError("manifest license_id is required")
    if manifest.get("license_reviewed") is not True:
        raise ValueError("dataset license must be reviewed before import")
    return {
        "slug": slug,
        "version": version,
        "source_url": _https_url(manifest.get("source_url"), "source_url"),
        "license_id": license_id,
        "license_url": _https_url(manifest.get("license_url"), "license_url"),
    }


def _read_problem(line: str, number: int) -> dict[str, object]:
    task = json.loads(line)
    if not isinstance(task, dict):
        raise ValueError(f"line {number}: expected a JSON object")
    allowed_fields = {"source_problem_id", "source_url", "license_id", "license_url", "license_reviewed", "split", "prompt", "tests", "reference_solution", "time_limit_ms", "memory_limit_mb", "adapter_kind", "adapter_entry_point"}
    if set(task) - allowed_fields:
        raise ValueError(f"line {number}: unknown fields")
    problem_key, split, prompt, tests = task.get("source_problem_id"), task.get("split"), task.get("prompt"), task.get("tests")
    if not isinstance(problem_key, str) or not 1 <= len(problem_key) <= 160:
        raise ValueError(f"line {number}: source_problem_id is required")
    if split not in _SPLITS:
        raise ValueError(f"line {number}: split must be train, heldout, or external")
    license_id = task.get("license_id")
    if task.get("license_reviewed") is not True or not isinstance(license_id, str) or not 1 <= len(license_id) <= 120:
        raise ValueError(f"line {number}: per-problem license must be recorded and reviewed")
    source_url = _https_url(task.get("source_url"), f"line {number} source_url")
    license_url = _https_url(task.get("license_url"), f"line {number} license_url")
    if not isinstance(prompt, str) or not 1 <= len(prompt.encode("utf-8")) <= 128 * 1024:
        raise ValueError(f"line {number}: prompt size is invalid")
    if not isinstance(tests, list) or not 1 <= len(tests) <= 100:
        raise ValueError(f"line {number}: tests must contain 1 to 100 cases")
    reference_solution = task.get("reference_solution")
    if not isinstance(reference_solution, str) or not 1 <= len(reference_solution.encode("utf-8")) <= 16 * 1024:
        raise ValueError(f"line {number}: a Python reference_solution of at most 16 KiB is required")
    normalized_tests: list[dict[str, str]] = []
    for case in tests:
        if not isinstance(case, dict) or set(case) != {"stdin", "expected_stdout"}:
            raise ValueError(f"line {number}: each test needs only stdin and expected_stdout")
        if not all(isinstance(case[field], str) for field in ("stdin", "expected_stdout")):
            raise ValueError(f"line {number}: test input and output must be text")
        normalized_tests.append({"stdin": case["stdin"], "expected_stdout": case["expected_stdout"]})
    time_limit_ms = task.get("time_limit_ms", 2000)
    memory_limit_mb = task.get("memory_limit_mb", 256)
    if type(time_limit_ms) is not int or not 100 <= time_limit_ms <= 10_000:
        raise ValueError(f"line {number}: time_limit_ms must be between 100 and 10000")
    if type(memory_limit_mb) is not int or not 64 <= memory_limit_mb <= 512:
        raise ValueError(f"line {number}: memory_limit_mb must be between 64 and 512")
    adapter_kind, adapter_entry_point = validate_adapter(
        task.get("adapter_kind", STDIN_STDOUT_ADAPTER),
        task.get("adapter_entry_point"),
    )
    if adapter_kind == PYTHON_ASSERTIONS_ADAPTER:
        try:
            validate_function_cases(normalized_tests)
        except ValueError as error:
            raise ValueError(f"line {number}: {error}") from error
    encoded_tests = json.dumps(normalized_tests, ensure_ascii=False, separators=(",", ":"))
    content = json.dumps(
        {"prompt": prompt, "tests": normalized_tests, "reference_solution_sha256": hashlib.sha256(reference_solution.encode("utf-8")).hexdigest(), "time_limit_ms": time_limit_ms, "memory_limit_mb": memory_limit_mb,
         "source_url": source_url, "license_id": license_id, "license_url": license_url, "adapter_kind": adapter_kind,
         "adapter_entry_point": adapter_entry_point},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded_tests.encode("utf-8")) > _MAX_PROBLEM_BYTES:
        raise ValueError(f"line {number}: total tests exceed 1 MiB")
    return {
        "source_problem_id": problem_key,
        "source_url": source_url,
        "license_id": license_id,
        "license_url": license_url,
        "split": split,
        "prompt": prompt,
        "test_cases": normalized_tests,
        "reference_solution": reference_solution,
        "time_limit_ms": time_limit_ms,
        "memory_limit_mb": memory_limit_mb,
        "adapter_kind": adapter_kind,
        "adapter_entry_point": adapter_entry_point,
        "content_sha256": hashlib.sha256(content).hexdigest(),
    }


def import_dataset(manifest_path: Path, problems_path: Path) -> int:
    if settings.JUDGE_SANDBOX_MODE != "docker" or resolve_sandbox_backend() != "docker":
        raise RuntimeError("dataset reference verification requires an available Docker judge backend")
    manifest = _read_manifest(manifest_path)
    tasks: list[dict[str, object]] = []
    seen: set[str] = set()
    with problems_path.open(encoding="utf-8") as problem_file:
        for number, line in enumerate(problem_file, 1):
            if not line.strip():
                continue
            task = _read_problem(line, number)
            source_id = str(task["source_problem_id"])
            if source_id in seen:
                raise ValueError(f"line {number}: duplicate source_problem_id")
            seen.add(source_id)
            tasks.append(task)
            if len(tasks) > _MAX_TASKS:
                raise ValueError("dataset exceeds the 10000-problem import limit")
    if not tasks:
        raise ValueError("problem JSONL is empty")

    for task in tasks:
        reference_code = str(task["reference_solution"])
        if task["adapter_kind"] == PYTHON_ASSERTIONS_ADAPTER:
            reference_code = build_python_function_program(
                reference_code, str(task["adapter_entry_point"])
            )
        verification = execute_judge(JudgeRequest(
            language="python",
            code=reference_code,
            cases=[JudgeCase.model_validate(case) for case in task["test_cases"]],
            time_limit_ms=int(task["time_limit_ms"]),
            memory_mb=int(task["memory_limit_mb"]),
            checker_code=function_checker_code() if task["adapter_kind"] == PYTHON_ASSERTIONS_ADAPTER else None,
        ))
        if verification.infra_error or verification.status != "accepted":
            raise ValueError(f"reference solution failed verification for {task['source_problem_id']}")

    with db.get_connection() as conn, conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM organizations WHERE id = %s", (settings.TRAINING_ORGANIZATION_ID,))
            if cur.fetchone() is None:
                raise ValueError("configured research organization does not exist")
            cur.execute(
                "INSERT INTO research_datasets (organization_id, slug, version, source_url, license_id, license_url) "
                "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (slug, version) DO NOTHING RETURNING id",
                (settings.TRAINING_ORGANIZATION_ID, manifest["slug"], manifest["version"], manifest["source_url"], manifest["license_id"], manifest["license_url"]),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "SELECT id, organization_id, source_url, license_id, license_url FROM research_datasets "
                    "WHERE slug = %s AND version = %s FOR UPDATE",
                    (manifest["slug"], manifest["version"]),
                )
                row = cur.fetchone()
                if row is None or tuple(row[1:]) != (
                    settings.TRAINING_ORGANIZATION_ID,
                    manifest["source_url"],
                    manifest["license_id"],
                    manifest["license_url"],
                ):
                    raise ValueError("dataset version exists with different license or source metadata")
            dataset_id = row[0]
            cur.execute(
                "SELECT source_problem_id FROM research_problems WHERE dataset_id = %s",
                (dataset_id,),
            )
            existing_problem_ids = {existing[0] for existing in cur.fetchall()}
            _validate_immutable_problem_set(existing_problem_ids, seen)
            for task in tasks:
                cur.execute(
                    "INSERT INTO research_problems "
                    "(dataset_id, source_problem_id, source_url, license_id, license_url, split, prompt, test_cases, time_limit_ms, memory_limit_mb, adapter_kind, adapter_entry_point, content_sha256) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (dataset_id, source_problem_id) DO NOTHING",
                    (dataset_id, task["source_problem_id"], task["source_url"], task["license_id"], task["license_url"],
                    task["split"], task["prompt"], json.dumps(task["test_cases"], ensure_ascii=False), task["time_limit_ms"], task["memory_limit_mb"],
                    task["adapter_kind"], task["adapter_entry_point"], task["content_sha256"]),
                )
                cur.execute(
                    "SELECT split, source_url, license_id, license_url, adapter_kind, adapter_entry_point, content_sha256 "
                    "FROM research_problems WHERE dataset_id = %s AND source_problem_id = %s",
                    (dataset_id, task["source_problem_id"]),
                )
                imported = cur.fetchone()
                if imported != (task["split"], task["source_url"], task["license_id"], task["license_url"], task["adapter_kind"], task["adapter_entry_point"], task["content_sha256"]):
                    raise ValueError(f"dataset version is immutable; problem {task['source_problem_id']} differs")
    return len(tasks)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--problems", required=True, type=Path)
    args = parser.parse_args()
    count = import_dataset(args.manifest, args.problems)
    print(f"Verified immutable research import: {count} problems")


if __name__ == "__main__":
    main()
