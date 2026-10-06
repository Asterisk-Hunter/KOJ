"""Prompt a small causal coder and save independent Python samples as JSONL."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .client import ResearchClient
from .prompts import build_prompt

_MODEL_REVISION = re.compile(r"[0-9a-f]{40}\Z", re.IGNORECASE)


def validate_model_revision(revision: str) -> str:
    revision_id = revision.strip()
    if not _MODEL_REVISION.fullmatch(revision_id):
        raise ValueError("model revision must be an immutable 40-character Hugging Face commit SHA")
    return revision_id


def sample_problems(
    client: ResearchClient,
    *,
    dataset: str,
    version: str,
    split: str,
    model_id: str,
    revision: str,
    round_index: int,
    count_per_problem: int,
    output: Path,
    max_problems: int | None = None,
    adapter: Path | None = None,
    seed: int = 17,
    max_input_tokens: int = 6000,
    max_new_tokens: int = 1024,
) -> int:
    if not 1 <= count_per_problem <= 64:
        raise ValueError("count_per_problem must be between 1 and 64")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if not torch.cuda.is_available():
        raise RuntimeError("candidate generation requires a CUDA GPU")
    problems = client.problems(dataset, version, split, max_problems)
    if not problems:
        raise ValueError(f"dataset {dataset}@{version} has no {split} problems")
    revision_id = validate_model_revision(revision)
    dataset_digests = {problem["dataset_sha256"] for problem in problems}
    if len(dataset_digests) != 1:
        raise ValueError("KOJ returned inconsistent dataset digests")
    dataset_sha256 = next(iter(dataset_digests))

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision_id, trust_remote_code=False)
    tokenizer.padding_side = "left"
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        revision=revision_id,
        torch_dtype=dtype,
        device_map="auto",
        trust_remote_code=False,
        use_safetensors=True,
    )
    if adapter is not None:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter, is_trainable=False)
    model.eval()

    output.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, dict[str, dict[str, Any]]] = {}
    if output.exists():
        with output.open(encoding="utf-8") as old_file:
            for line in old_file:
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, dict) or row.get("split") != split or row.get("dataset") != dataset or row.get("version") != version or row.get("model_id") != model_id or row.get("model_revision") != revision_id or row.get("round") != round_index or row.get("dataset_sha256") != dataset_sha256:
                    raise ValueError("existing sample file does not match this run's pinned inputs")
                problem_key, sample_id = row.get("problem_key"), row.get("sample_id")
                if not isinstance(problem_key, str) or not isinstance(sample_id, str):
                    raise ValueError("existing sample file has an invalid task/sample key")
                samples_for_problem = existing.setdefault(problem_key, {})
                if sample_id in samples_for_problem:
                    raise ValueError("existing sample file repeats a sample ID")
                samples_for_problem[sample_id] = row
        known_problem_keys = {problem["problem_key"] for problem in problems}
        if not set(existing).issubset(known_problem_keys):
            raise ValueError("existing sample file includes problems outside the pinned dataset page")
    generated_count = 0
    with output.open("a", encoding="utf-8") as result_file:
        for problem_index, problem in enumerate(problems):
            prompt = build_prompt(
                problem["prompt"],
                adapter_kind=str(problem.get("adapter_kind") or "stdin_stdout"),
                adapter_entry_point=problem.get("adapter_entry_point"),
            )
            inputs = tokenizer(prompt, return_tensors="pt", truncation=False)
            if inputs["input_ids"].shape[-1] > max_input_tokens:
                raise ValueError(f"problem {problem['problem_key']} exceeds the configured prompt token budget")
            inputs = {name: value.to(model.device) for name, value in inputs.items()}
            prompt_length = inputs["input_ids"].shape[-1]
            current = existing.get(problem["problem_key"], {})
            expected_ids = {f"r{round_index}-{problem_index}-{index}" for index in range(count_per_problem)}
            if not set(current).issubset(expected_ids):
                raise ValueError("existing sample file contains IDs outside this prompt/sample plan")
            for sample_index in range(count_per_problem):
                sample_id = f"r{round_index}-{problem_index}-{sample_index}"
                if sample_id in current:
                    continue
                sample_seed = seed + problem_index * count_per_problem + sample_index
                torch.manual_seed(sample_seed)
                generated = model.generate(
                    **inputs,
                    do_sample=True,
                    temperature=0.7,
                    top_p=0.95,
                    num_return_sequences=1,
                    max_new_tokens=max_new_tokens,
                    pad_token_id=tokenizer.pad_token_id,
                )
                sequence = generated[0]
                item: dict[str, Any] = {
                    "problem_key": problem["problem_key"],
                    "sample_id": sample_id,
                    "prompt": problem["prompt"],
                    "adapter_kind": problem.get("adapter_kind", "stdin_stdout"),
                    "adapter_entry_point": problem.get("adapter_entry_point"),
                    "code": tokenizer.decode(sequence[prompt_length:], skip_special_tokens=True),
                    "split": split,
                    "dataset": dataset,
                    "version": version,
                    "model_id": model_id,
                    "model_revision": revision_id,
                    "round": round_index,
                    "seed": sample_seed,
                    "dataset_sha256": dataset_sha256,
                }
                result_file.write(json.dumps(item, ensure_ascii=False) + "\n")
                result_file.flush()
                generated_count += 1
    return generated_count
