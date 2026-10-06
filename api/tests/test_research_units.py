from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest
from pydantic import ValidationError

from app import research
from app import research_import
from app import research_adapter
from app import worker
from app.config import Settings, settings
from app.judge import JudgeResponse
from ml.loop import judge_samples, summarize
from ml.client import ResearchClient
from ml.sampling import validate_model_revision


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


def test_research_organization_is_required_only_when_research_is_enabled() -> None:
    common = {"DATABASE_URL": "postgresql://test:test@localhost/test"}
    assert Settings(**common).TRAINING_ORGANIZATION_ID is None

    with pytest.raises(ValueError, match="TRAINING_ORGANIZATION_ID"):
        Settings(**common, TRAINING_API_SECRET="a" * 32, TRAINING_OIDC_AUDIENCE="https://research.example.test", TRAINING_OIDC_PRINCIPAL="gpu@example.iam.gserviceaccount.com")
    with pytest.raises(ValueError, match="TRAINING_ORGANIZATION_ID"):
        Settings(**common, TRAINING_WORKER_ENABLED=True)

    configured = Settings(**common, TRAINING_WORKER_ENABLED=True, TRAINING_ORGANIZATION_ID=7)
    assert configured.TRAINING_ORGANIZATION_ID == 7


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
    monkeypatch.setattr(research, "_verify_oidc_token", lambda _authorization: True)
    with pytest.raises(research.HTTPException) as denied:
        research._authorize("incorrect")
    assert denied.value.status_code == 401
    research._authorize("correct", "Bearer token")


def test_research_oidc_verifier_checks_audience_and_principal(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRAINING_OIDC_AUDIENCE", "https://research.example.test")
    monkeypatch.setattr(settings, "TRAINING_OIDC_PRINCIPAL", "gpu@example.iam.gserviceaccount.com")
    import google.oauth2.id_token

    monkeypatch.setattr(
        google.oauth2.id_token,
        "verify_oauth2_token",
        lambda token, _request, audience: {
            "iss": "https://accounts.google.com",
            "aud": audience,
            "email": "gpu@example.iam.gserviceaccount.com",
            "email_verified": True,
        },
    )
    assert research._verify_oidc_token("Bearer signed-token")

    monkeypatch.setattr(settings, "TRAINING_OIDC_PRINCIPAL", "other@example.iam.gserviceaccount.com")
    assert not research._verify_oidc_token("Bearer signed-token")


def test_dataset_digest_is_stable_for_ordered_rows() -> None:
    rows = [("task-1", "train", "a" * 64), ("task-2", "heldout", "b" * 64)]
    assert research._dataset_digest(rows) == research._dataset_digest(rows)


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


def test_problem_import_rejects_changes_to_an_existing_version() -> None:
    with pytest.raises(ValueError, match="problem set differs"):
        research_import._validate_immutable_problem_set({"task-1"}, {"task-1", "task-2"})


def test_judge_samples_rejects_stale_or_tampered_prompts(tmp_path: Path) -> None:
    class Client:
        def problems(self, dataset: str, version: str, split: str) -> list[dict[str, str]]:
            return [{"problem_key": "p-1", "prompt": "Trusted prompt", "dataset_sha256": "a" * 64}]

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
            "dataset_sha256": "a" * 64,
        }) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="server-pinned"):
        judge_samples(
            Client(), path, dataset="sample-set", version="v1", split="train",
            model_id="model", model_revision="revision", round_index=0, output=tmp_path / "result.jsonl",
        )


def test_judge_samples_retries_dead_infrastructure_samples(tmp_path: Path) -> None:
    class Client:
        def __init__(self) -> None:
            self.submit_count = 0
            self.submissions: list[dict[str, object]] = []

        def problems(self, dataset: str, version: str, split: str) -> list[dict[str, str]]:
            return [{"problem_key": "p-1", "prompt": "Trusted prompt", "dataset_sha256": "a" * 64}]

        def submit_problem(self, **kwargs: object):
            self.submit_count += 1
            self.submissions.append(kwargs)
            return self.submit_count

        def wait_for_run(self, run_id, **_kwargs: object) -> dict[str, object]:
            verdict = "dead" if run_id == 1 else "completed"
            return {"samples": [{"sample_id": "sample-1", "status": verdict, "verdict": "accepted" if verdict == "completed" else None}]}

    path = tmp_path / "samples.jsonl"
    path.write_text(
        json.dumps({
            "dataset": "sample-set", "version": "v1", "split": "train", "model_id": "model",
            "model_revision": "revision", "round": 0, "problem_key": "p-1", "sample_id": "sample-1",
            "prompt": "Trusted prompt", "code": "print(1)", "dataset_sha256": "a" * 64,
        }) + "\n",
        encoding="utf-8",
    )
    client = Client()
    results = judge_samples(
        client, path, dataset="sample-set", version="v1", split="train", model_id="model",
        model_revision="revision", round_index=0, output=tmp_path / "results.jsonl",
    )
    assert client.submit_count == 2
    assert all(
        submission["dataset"] == "sample-set" and submission["version"] == "v1"
        for submission in client.submissions
    )
    assert results[0]["status"] == "completed"


def test_summarize_reports_incomplete_problem_without_aborting(tmp_path: Path) -> None:
    metrics = summarize(
        [
            {"problem_key": "p-1", "status": "completed", "verdict": "accepted", "dataset_sha256": "a" * 64},
            {"problem_key": "p-1", "status": "dead", "verdict": None, "dataset_sha256": "a" * 64},
            {"problem_key": "p-2", "status": "completed", "verdict": "wrong_answer", "dataset_sha256": "a" * 64},
            {"problem_key": "p-2", "status": "completed", "verdict": "accepted", "dataset_sha256": "a" * 64},
        ],
        tmp_path / "metrics.json",
        "heldout-round-0",
    )
    assert metrics["problems_scored"] == 1
    assert metrics["incomplete_problems"] == ["p-1"]
    assert metrics["infrastructure_failures"] == 1


def test_research_client_requires_tls_outside_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KOJ_TRAINING_API_SECRET", "test-secret")
    with pytest.raises(ValueError, match="HTTPS"):
        ResearchClient("http://training.example.test")
    assert ResearchClient("http://localhost:8000").base_url == "http://localhost:8000"


def test_model_revision_requires_a_commit_sha() -> None:
    assert validate_model_revision("a" * 40) == "a" * 40
    with pytest.raises(ValueError, match="commit SHA"):
        validate_model_revision("main")
    with pytest.raises(ValueError, match="commit SHA"):
        validate_model_revision("release-tag")

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


def test_function_adapter_requires_valid_server_owned_metadata() -> None:
    task = {
        "source_problem_id": "function-task",
        "source_url": "https://example.test/task",
        "license_id": "CC-BY-4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "license_reviewed": True,
        "split": "train",
        "prompt": "Return the sum of two integers.",
        "reference_solution": "def solution(a, b):\n    return a + b",
        "tests": [{"stdin": '{"args":[2,3]}', "expected_stdout": "5"}],
        "adapter_kind": research_adapter.PYTHON_ASSERTIONS_ADAPTER,
        "adapter_entry_point": "solution",
    }

    parsed = research_import._read_problem(json.dumps(task), 1)

    assert parsed["adapter_kind"] == research_adapter.PYTHON_ASSERTIONS_ADAPTER
    assert parsed["adapter_entry_point"] == "solution"
    assert parsed["test_cases"] == task["tests"]
    generated = research_adapter.build_python_function_program(
        str(parsed["reference_solution"]),
        str(parsed["adapter_entry_point"]),
    )
    assert "def solution(a, b):" in generated
    assert "5" not in generated
    assert "expected_output" not in generated


def test_function_adapter_checker_compares_private_expected_results() -> None:
    checker = research_adapter.function_checker_code()

    def check(actual_output: str) -> int:
        payload = json.dumps({"expected_output": "5", "actual_output": actual_output})
        result = subprocess.run(
            [sys.executable, "-I", "-S", "-c", checker],
            input=payload,
            capture_output=True,
            check=False,
            text=True,
            timeout=5,
        )
        return result.returncode

    assert check("5") == 0
    assert check("4") != 0


def test_research_worker_keeps_expected_result_out_of_candidate_source(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[object] = []
    monkeypatch.setattr(worker.settings, "JUDGE_SANDBOX_MODE", "docker")
    monkeypatch.setattr(worker, "resolve_sandbox_backend", lambda: "docker")
    monkeypatch.setattr(worker, "execute_judge", lambda request, **_kwargs: captured.append(request) or JudgeResponse(
        status="accepted", passed_tests=1, total_tests=1, execution_time_ms=1, cases=[]
    ))
    monkeypatch.setattr(worker.research, "heartbeat_sample", lambda *_args: True)
    monkeypatch.setattr(worker.research, "complete_sample", lambda *_args: True)
    monkeypatch.setattr(worker.research, "retry_sample", lambda *_args: True)

    worker._process_research_sample(
        "worker-1",
        {
            "id": "sample-id",
            "run_id": "run-id",
            "attempt": 1,
            "code": "def solution(a, b):\n    return a + b",
            "cases": [{"stdin": '{"args":[2,3]}', "expected_stdout": "5"}],
            "time_limit_ms": 2000,
            "memory_limit_mb": 256,
            "adapter_kind": research_adapter.PYTHON_ASSERTIONS_ADAPTER,
            "adapter_entry_point": "solution",
        },
    )

    assert len(captured) == 1
    request = captured[0]
    assert isinstance(request, worker.JudgeRequest)
    assert request.checker_code == research_adapter.function_checker_code()
    assert request.cases[0].expected_stdout == "5"
    assert "5" not in request.code


@pytest.mark.parametrize(
    ("kind", "entry_point"),
    [
        (None, None),
        ("unknown", "solution"),
        (research_adapter.PYTHON_ASSERTIONS_ADAPTER, "not a name"),
    ],
)
def test_validate_research_adapter_rejects_malformed_metadata(
    kind: object,
    entry_point: object,
) -> None:
    with pytest.raises(ValueError):
        research_adapter.validate_adapter(kind, entry_point)
