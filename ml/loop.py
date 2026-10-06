"""Two-round rejection-sampling SFT loop with KOJ verdicts as the filter."""

from __future__ import annotations

import hashlib
import json
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from .client import ResearchClient
from .finetune import train_lora
from .metrics import estimate_pass_at_k
from .sampling import sample_problems


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as file:
        rows = [json.loads(line) for line in file if line.strip()]
    return rows


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")


def judge_samples(
    client: ResearchClient,
    samples_path: Path,
    *,
    dataset: str,
    version: str,
    split: str,
    model_id: str,
    model_revision: str,
    round_index: int,
    output: Path,
    run_model_id: str | None = None,
    run_timeout_s: float = 7200,
) -> list[dict[str, Any]]:
    samples = _read_jsonl(samples_path)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seen_sample_ids: set[str] = set()
    trusted_prompts = {
        problem["problem_key"]: problem["prompt"]
        for problem in client.problems(dataset, version, split)
    }
    for sample in samples:
        expected = {
            "dataset": dataset,
            "version": version,
            "split": split,
            "model_id": model_id,
            "model_revision": model_revision,
            "round": round_index,
        }
        if any(sample.get(key) != value for key, value in expected.items()):
            raise ValueError("sample metadata does not match the pinned judge inputs")
        if not isinstance(sample.get("problem_key"), str) or not sample["problem_key"] or not isinstance(sample.get("code"), str) or not sample["code"]:
            raise ValueError("candidate is missing problem_key or code")
        if sample["problem_key"] not in trusted_prompts or sample.get("prompt") != trusted_prompts[sample["problem_key"]]:
            raise ValueError("sample prompt does not match the server-pinned dataset problem")
        sample_id = sample.get("sample_id")
        if not isinstance(sample_id, str) or not sample_id or sample_id in seen_sample_ids:
            raise ValueError("sample IDs must be non-empty and unique in the pinned run")
        seen_sample_ids.add(sample_id)
        grouped[sample["problem_key"]].append(sample)

    results: list[dict[str, Any]] = []
    for problem_key in sorted(grouped):
        candidates = grouped[problem_key]
        for offset in range(0, len(candidates), 64):
            batch = candidates[offset : offset + 64]
            content = json.dumps(
                [{"sample_id": item["sample_id"], "code": item["code"]} for item in batch],
                sort_keys=True,
                separators=(",", ":"),
            )
            idempotency_key = hashlib.sha256(
                f"{dataset}:{version}:{split}:{round_index}:{problem_key}:{content}".encode("utf-8")
            ).hexdigest()
            run_id = client.submit_problem(
                dataset=dataset,
                version=version,
                split=split,
                model_id=run_model_id or model_id,
                round_index=round_index,
                problem_key=problem_key,
                candidates=[{"sample_id": item["sample_id"], "code": item["code"]} for item in batch],
                idempotency_key=idempotency_key,
            )
            status = client.wait_for_run(run_id, timeout_s=run_timeout_s)
            by_sample = {entry["sample_id"]: entry for entry in status["samples"]}
            for sample in batch:
                verdict = by_sample.get(sample["sample_id"], {})
                results.append({
                    **sample,
                    "status": verdict.get("status", "dead"),
                    "verdict": verdict.get("verdict"),
                })
    _write_jsonl(output, results)
    return results


def summarize(results: list[dict[str, Any]], output: Path, label: str) -> dict[str, Any]:
    grouped: dict[str, list[bool]] = defaultdict(list)
    infrastructure_failures = 0
    for result in results:
        if result.get("status") == "completed" and isinstance(result.get("verdict"), str):
            grouped[str(result["problem_key"])].append(result["verdict"] == "accepted")
        else:
            infrastructure_failures += 1
    if not grouped:
        raise ValueError("no completed samples; no pass@k score can be reported")
    sample_counts = {len(values) for values in grouped.values()}
    if len(sample_counts) != 1:
        raise ValueError("pass@k requires the same number of completed samples per problem")
    n = sample_counts.pop()
    metrics = {
        "label": label,
        "problems_scored": len(grouped),
        "samples_per_problem": n,
        "infrastructure_failures": infrastructure_failures,
        "pass_at_k": {
            str(k): estimate_pass_at_k(grouped.values(), k)
            for k in (1, 5, 10, 16, 32, 64)
            if k <= n
        },
    }
    output.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def run_rounds(
    *,
    client: ResearchClient,
    dataset: str,
    version: str,
    model_id: str,
    revision: str,
    output: Path,
    rounds: int = 2,
    train_samples_per_problem: int = 16,
    eval_samples_per_problem: int = 16,
    train_problem_limit: int = 500,
    eval_problem_limit: int = 200,
    external_dataset: str | None = None,
    external_version: str | None = None,
    seed: int = 17,
) -> list[dict[str, Any]]:
    if not 1 <= rounds <= 3:
        raise ValueError("rounds must be between one and three")
    if bool(external_dataset) != bool(external_version):
        raise ValueError("external dataset and version must be provided together")
    output.mkdir(parents=True, exist_ok=True)
    accepted_corpus: dict[str, dict[str, Any]] = {}
    adapter: Path | None = None
    history: list[dict[str, Any]] = []

    for round_index in range(rounds + 1):
        model_label = f"{model_id}@{revision}/round-{round_index}"
        for eval_dataset, eval_version, split, problem_limit in [
            (dataset, version, "heldout", eval_problem_limit),
            *(([(external_dataset, external_version, "external", eval_problem_limit)] if external_dataset and external_version else [])),
        ]:
            samples_path = output / f"{split}-round-{round_index}-samples.jsonl"
            results_path = output / f"{split}-round-{round_index}-results.jsonl"
            metrics_path = output / f"{split}-round-{round_index}-metrics.json"
            sample_problems(
                client,
                dataset=str(eval_dataset),
                version=str(eval_version),
                split=split,
                model_id=model_id,
                revision=revision,
                round_index=round_index,
                count_per_problem=eval_samples_per_problem,
                output=samples_path,
                max_problems=problem_limit,
                adapter=adapter,
                seed=seed + round_index,
            )
            results = judge_samples(
                client,
                samples_path,
                dataset=str(eval_dataset),
                version=str(eval_version),
                split=split,
                model_id=model_id,
                model_revision=revision,
                run_model_id=model_label,
                round_index=round_index,
                output=results_path,
            )
            history.append(summarize(results, metrics_path, f"{split}-round-{round_index}"))

        if round_index == rounds:
            break

        training_samples_path = output / f"train-round-{round_index}-samples.jsonl"
        train_results_path = output / f"train-round-{round_index}-results.jsonl"
        sample_problems(
            client,
            dataset=dataset,
            version=version,
            split="train",
            model_id=model_id,
            revision=revision,
            round_index=round_index,
            count_per_problem=train_samples_per_problem,
            output=training_samples_path,
            max_problems=train_problem_limit,
            adapter=adapter,
            seed=seed + round_index,
        )
        train_results = judge_samples(
            client,
            training_samples_path,
            dataset=dataset,
            version=version,
            split="train",
            model_id=model_id,
            model_revision=revision,
            run_model_id=model_label,
            round_index=round_index,
            output=train_results_path,
        )
        for result in train_results:
            if result.get("status") == "completed" and result.get("verdict") == "accepted":
                accepted_corpus[str(result["sample_id"])] = result
        accepted_path = output / "accepted-train-samples.jsonl"
        _write_jsonl(accepted_path, list(accepted_corpus.values()))
        if not accepted_corpus:
            raise RuntimeError(f"no KOJ-accepted code in round {round_index}; training stopped")
        parent_adapter = adapter
        training_output = output / f"round-{round_index + 1}"
        train_lora(
            list(accepted_corpus.values()),
            model_id=model_id,
            revision=revision,
            output=training_output,
            parent_adapter=parent_adapter,
        )
        adapter = training_output / "adapter"
    (output / "metrics-history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    return history
