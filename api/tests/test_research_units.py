from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app import research
from app import research_import
from app.config import settings
from ml.loop import judge_samples
from ml.client import ResearchClient


def test_research_run_accepts_one_problem_and_unique_samples() -> None:
    request = research.ResearchRunRequest(
        dataset="sample-set",
        version="v1",
        split="train",
        model_id="Qwen/Qwen2.5-Coder-1.5B",
        round=0,
        candidates=[
            {"sample_id": "s-1", "problem_key": "p-1", "code": "print(1)"},
            {"sample_id": "s-2", "problem_key": "p-1", "code": "print(1)"},
        ],
    )

    assert len(request.candidates) == 2


@pytest.mark.parametrize(
    "candidate_overrides",
    [
        {"sample_id": "not valid!"},
        {"sample_id": "s-1", "code": ""},
        {"expected_output": "secret"},
    ],
)
def test_research_run_rejects_invalid_candidate_batches(candidate_overrides: dict[str, str]) -> None:
    candidate = {"sample_id": "s-1", "problem_key": "p-1", "code": "print(1)"}
    candidate.update(candidate_overrides)
    with pytest.raises(ValidationError):
        research.ResearchRunRequest(
            dataset="sample-set",
            version="v1",
            split="train",
            model_id="model",
            round=0,
            candidates=[candidate],
        )


def test_research_run_rejects_multiple_problem_keys_and_duplicate_sample_ids() -> None:
    candidate = {"sample_id": "s-1", "problem_key": "p-1", "code": "print(1)"}
    with pytest.raises(ValidationError):
        research.ResearchRunRequest(
            dataset="sample-set", version="v1", split="train", model_id="model", round=0,
            candidates=[candidate, {**candidate, "sample_id": "s-2", "problem_key": "p-2"}],
        )
    with pytest.raises(ValidationError):
        research.ResearchRunRequest(
            dataset="sample-set", version="v1", split="train", model_id="model", round=0,
            candidates=[candidate, candidate],
        )


def test_auth_is_disabled_by_default_and_rejects_bad_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRAINING_API_SECRET", "")
    with pytest.raises(research.HTTPException) as disabled:
        research._authorize(None)
    assert disabled.value.status_code == 503

    monkeypatch.setattr(settings, "TRAINING_API_SECRET", "correct")
    with pytest.raises(research.HTTPException) as denied:
        research._authorize("incorrect")
    assert denied.value.status_code == 401
    research._authorize("correct")


def test_idempotency_payload_digest_is_stable() -> None:
    first = research.ResearchRunRequest(
        dataset="sample-set", version="v1", split="heldout", model_id="model", round=1,
        candidates=[{"sample_id": "s-1", "problem_key": "p-1", "code": "print(1)"}],
    )
    second = research.ResearchRunRequest.model_validate(json.loads(first.model_dump_json()))
    assert research._payload_hash(first) == research._payload_hash(second)


def test_problem_import_requires_test_cases_and_reviewed_license(tmp_path: Path) -> None:
    manifest = {
        "slug": "licensed-set",
        "version": "v1",
        "source_url": "https://example.test/dataset",
        "license_id": "CC-BY-4.0",
        "license_url": "https://example.test/license",
        "license_reviewed": True,
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    assert research_import._read_manifest(manifest_path)["license_id"] == "CC-BY-4.0"

    task = {
        "source_problem_id": "task-1",
        "source_url": "https://example.test/problem/task-1",
        "license_id": "CC-BY-4.0",
        "license_url": "https://example.test/licenses/cc-by-4.0",
        "license_reviewed": True,
        "split": "train",
        "prompt": "Read two integers and print their sum.",
        "reference_solution": "a, b = map(int, input().split())\nprint(a + b)",
        "tests": [{"stdin": "2 3\n", "expected_stdout": "5\n"}],
    }
    parsed = research_import._read_problem(json.dumps(task), 1)
    assert parsed["split"] == "train"
    assert len(str(parsed["content_sha256"])) == 64
    with pytest.raises(ValueError, match="license must be reviewed"):
        manifest["license_reviewed"] = False
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        research_import._read_manifest(manifest_path)


def test_judge_samples_rejects_stale_or_tampered_prompts(tmp_path: Path) -> None:
    class Client:
        def problems(self, dataset: str, version: str, split: str) -> list[dict[str, str]]:
            return [{"problem_key": "p-1", "prompt": "Trusted prompt"}]

        def submit_problem(self, **_kwargs: object) -> None:
            raise AssertionError("untrusted prompt must not be submitted")

    path = tmp_path / "samples.jsonl"
    path.write_text(
        json.dumps({
            "dataset": "sample-set",
            "version": "v1",
            "split": "train",
            "model_id": "model",
            "model_revision": "revision",
            "round": 0,
            "problem_key": "p-1",
            "sample_id": "sample-1",
            "prompt": "Tampered prompt",
            "code": "print(1)",
        }) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="server-pinned"):
        judge_samples(
            Client(), path, dataset="sample-set", version="v1", split="train",
            model_id="model", model_revision="revision", round_index=0, output=tmp_path / "result.jsonl",
        )


def test_research_client_requires_tls_outside_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KOJ_TRAINING_API_SECRET", "test-secret")
    with pytest.raises(ValueError, match="HTTPS"):
        ResearchClient("http://training.example.test")
    assert ResearchClient("http://localhost:8000").base_url == "http://localhost:8000"

@pytest.mark.parametrize(
    "task",
    [
        {"source_problem_id": "x", "source_url": "https://e.test/p", "license_id": "MIT", "license_url": "https://e.test/l", "license_reviewed": True, "split": "valid", "prompt": "p", "reference_solution": "print(1)", "tests": [{"stdin": "", "expected_stdout": ""}]},
        {"source_problem_id": "x", "source_url": "https://e.test/p", "license_id": "MIT", "license_url": "https://e.test/l", "license_reviewed": True, "split": "train", "prompt": "p", "reference_solution": "print(1)", "tests": []},
        {"source_problem_id": "x", "source_url": "https://e.test/p", "license_id": "MIT", "license_url": "https://e.test/l", "license_reviewed": True, "split": "train", "prompt": "p", "reference_solution": "print(1)", "tests": [{"stdin": "", "expected_stdout": "", "secret": "no"}]},
    ],
)
def test_problem_import_rejects_ambiguous_or_unbounded_test_data(task: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        research_import._read_problem(json.dumps(task), 1)
