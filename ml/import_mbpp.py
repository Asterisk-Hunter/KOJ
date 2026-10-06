"""Create a pinned MBPP JSONL import without running upstream dataset code."""

from __future__ import annotations

import argparse
import ast
import hashlib
import io
import json
import math
import random
import re
from pathlib import Path
from typing import Any

import requests

_DATASET = "google-research-datasets/mbpp"
_DATASET_URL = f"https://huggingface.co/datasets/{_DATASET}"
_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
_MAX_PARQUET_BYTES = 32 * 1024 * 1024


def _json_value(value: Any) -> bool:
    if value is None or type(value) in (bool, int, str):
        return True
    if type(value) is float:
        return math.isfinite(value)
    if type(value) is list:
        return all(_json_value(item) for item in value)
    if type(value) is dict:
        return all(type(key) is str and _json_value(item) for key, item in value.items())
    return False


def parse_test(test: str, entry_point: str) -> dict[str, str] | None:
    try:
        statement = ast.parse(test).body
    except SyntaxError:
        return None
    if len(statement) != 1 or not isinstance(statement[0], ast.Assert):
        return None
    assertion = statement[0].test
    if not isinstance(assertion, ast.Compare) or len(assertion.ops) != 1 or not isinstance(assertion.ops[0], ast.Eq):
        return None
    call = assertion.left
    if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or call.func.id != entry_point:
        return None
    if any(keyword.arg is None for keyword in call.keywords):
        return None
    try:
        args = [ast.literal_eval(argument) for argument in call.args]
        kwargs = {str(keyword.arg): ast.literal_eval(keyword.value) for keyword in call.keywords}
        expected = ast.literal_eval(assertion.comparators[0])
        if not _json_value(args) or not _json_value(kwargs) or not _json_value(expected):
            return None
        stdin = json.dumps({"args": args, "kwargs": kwargs}, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        expected_stdout = json.dumps(expected, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (ValueError, TypeError, OverflowError):
        return None
    return {"stdin": stdin, "expected_stdout": expected_stdout}


def _convert_row(row: dict[str, Any], split: str, revision: str) -> dict[str, Any] | None:
    if row.get("test_setup_code", "").strip():
        return None
    source = row.get("code")
    tests = row.get("test_list")
    if not isinstance(source, str) or not isinstance(tests, list):
        return None
    try:
        functions = {
            node.name
            for node in ast.parse(source).body
            if isinstance(node, ast.FunctionDef)
        }
    except SyntaxError:
        return None
    parsed_tests: list[dict[str, str]] = []
    entry_point: str | None = None
    for test in [*tests, *(row.get("challenge_test_list") or [])]:
        if not isinstance(test, str):
            continue
        try:
            test_body = ast.parse(test).body
        except SyntaxError:
            continue
        if len(test_body) != 1 or not isinstance(test_body[0], ast.Assert):
            continue
        comparison = test_body[0].test
        if not isinstance(comparison, ast.Compare) or not isinstance(comparison.left, ast.Call):
            continue
        called = comparison.left.func
        if not isinstance(called, ast.Name) or called.id not in functions:
            continue
        candidate_entry_point = called.id
        parsed = parse_test(test, candidate_entry_point)
        if parsed is None or (entry_point is not None and candidate_entry_point != entry_point):
            continue
        entry_point = candidate_entry_point
        parsed_tests.append(parsed)
    if entry_point is None or len(parsed_tests) < 2:
        return None
    prompt = row.get("text")
    task_id = row.get("task_id")
    if not isinstance(prompt, str) or not prompt.strip() or not isinstance(task_id, int):
        return None
    source_url = f"{_DATASET_URL}/blob/{revision}/full/{split}-00000-of-00001.parquet"
    return {
        "source_problem_id": f"mbpp-{task_id}",
        "source_url": source_url,
        "license_id": "CC-BY-4.0",
        "license_url": _LICENSE_URL,
        "license_reviewed": True,
        "split": "train" if split == "train" else "heldout",
        "prompt": prompt.strip(),
        "tests": parsed_tests,
        "reference_solution": source,
        "time_limit_ms": 3000,
        "memory_limit_mb": 256,
        "adapter_kind": "python_assertions",
        "adapter_entry_point": entry_point,
    }


def _read_split(split: str, revision: str) -> list[dict[str, Any]]:
    import pyarrow.parquet as parquet

    url = f"{_DATASET_URL}/resolve/{revision}/full/{split}-00000-of-00001.parquet"
    response = requests.get(url, timeout=60, stream=True)
    response.raise_for_status()
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=1024 * 1024):
        total += len(chunk)
        if total > _MAX_PARQUET_BYTES:
            raise ValueError("MBPP parquet file exceeded the import download limit")
        chunks.append(chunk)
    table = parquet.read_table(io.BytesIO(b"".join(chunks)))
    return table.to_pylist()


def create_import(
    *, revision: str, version: str, seed: int, train_count: int, heldout_count: int, output: Path
) -> tuple[int, str]:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("dataset revision must be an immutable 40-character Hugging Face commit SHA")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", version):
        raise ValueError("version contains unsupported characters")
    if not 1 <= train_count <= 100 or not 1 <= heldout_count <= 100:
        raise ValueError("each split size must be between 1 and 100 problems")

    selected: list[dict[str, Any]] = []
    for split, count in (("train", train_count), ("test", heldout_count)):
        converted = [
            task
            for row in _read_split(split, revision)
            if (task := _convert_row(row, split, revision)) is not None
        ]
        if len(converted) < count:
            raise ValueError(f"only {len(converted)} {split} tasks met the safe JSON-function contract")
        random.Random(f"{seed}:{split}:{revision}").shuffle(converted)
        selected.extend(converted[:count])

    output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "slug": "mbpp-function-pilot",
        "version": version,
        "source_url": f"{_DATASET_URL}/tree/{revision}/full",
        "license_id": "CC-BY-4.0",
        "license_url": _LICENSE_URL,
        "attribution": "Google Research, MBPP dataset; source revision " + revision,
        "seed": seed,
        "dataset_revision": revision,
        "license_reviewed": True,
        "license_review_note": "Dataset card declares CC-BY-4.0; public tests are not contamination-resistant.",
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    problem_file = output / "problems.jsonl"
    with problem_file.open("w", encoding="utf-8") as handle:
        for task in selected:
            handle.write(json.dumps(task, ensure_ascii=False, separators=(",", ":")) + "\n")
    digest = hashlib.sha256(problem_file.read_bytes()).hexdigest()
    return len(selected), digest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--train-count", type=int, default=20)
    parser.add_argument("--heldout-count", type=int, default=20)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    count, digest = create_import(
        revision=args.revision,
        version=args.version,
        seed=args.seed,
        train_count=args.train_count,
        heldout_count=args.heldout_count,
        output=args.output,
    )
    print(f"Created {count} reviewed MBPP rows; JSONL SHA-256: {digest}")


if __name__ == "__main__":
    main()
