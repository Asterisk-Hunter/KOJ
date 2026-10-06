"""LoRA SFT over only KOJ-accepted samples; no GRPO dependency."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from typing import Any

from .prompts import build_prompt
from .sampling import validate_model_revision


def _adapter_digest(path: Path) -> str:
    digest = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(file_path.relative_to(path).as_posix().encode("utf-8"))
        with file_path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def train_lora(
    accepted_samples: list[dict[str, Any]],
    *,
    model_id: str,
    revision: str,
    output: Path,
    parent_adapter: Path | None = None,
    epochs: float = 2.0,
    learning_rate: float = 2e-4,
    max_length: int = 4096,
) -> None:
    if not accepted_samples:
        raise ValueError("no KOJ-accepted samples; refusing to train on unverified code")
    if any(sample.get("split") != "train" or sample.get("verdict") != "accepted" for sample in accepted_samples):
        raise ValueError("SFT input must contain only accepted train-split samples")
    if any(not isinstance(sample.get("code"), str) or not sample["code"] for sample in accepted_samples):
        raise ValueError("accepted sample is missing code")
    dataset_digests = {sample.get("dataset_sha256") for sample in accepted_samples}
    if len(dataset_digests) != 1 or not isinstance(next(iter(dataset_digests)), str):
        raise ValueError("accepted samples must share one server-pinned dataset digest")
    revision = validate_model_revision(revision)

    dataset_digest = hashlib.sha256(
        "\n".join(
            f"{sample.get('sample_id', '')}:{hashlib.sha256(str(sample['code']).encode('utf-8')).hexdigest()}"
            for sample in sorted(accepted_samples, key=lambda item: str(item.get("sample_id", "")))
        ).encode("utf-8")
    ).hexdigest()
    manifest = {
        "model_id": model_id,
        "model_revision": revision,
        "parent_adapter_sha256": _adapter_digest(parent_adapter) if parent_adapter else None,
        "accepted_sha256": dataset_digest,
        "dataset_sha256": next(iter(dataset_digests)),
        "verified_sample_count": len(accepted_samples),
        "epochs": epochs,
        "learning_rate": learning_rate,
        "max_length": max_length,
    }
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / "training-manifest.json"
    if manifest_path.exists():
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if existing_manifest != manifest:
            raise ValueError("training checkpoint exists with different model/data/hyperparameters")
    else:
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    completed_manifest_path = output / "run.json"
    if completed_manifest_path.exists() and (output / "adapter").is_dir():
        if json.loads(completed_manifest_path.read_text(encoding="utf-8")) == manifest:
            return

    import torch
    from peft import LoraConfig, PeftModel, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments
    from transformers.trainer_utils import get_last_checkpoint

    if not torch.cuda.is_available():
        raise RuntimeError("LoRA fine-tuning requires a CUDA GPU")
    tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision, trust_remote_code=False)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        revision=revision,
        torch_dtype=dtype,
        trust_remote_code=False,
        use_safetensors=True,
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
    if parent_adapter is None:
        model = get_peft_model(
            model,
            LoraConfig(
                r=16,
                lora_alpha=32,
                lora_dropout=0.05,
                target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
                task_type="CAUSAL_LM",
            ),
        )
    else:
        if not (parent_adapter / "adapter_config.json").is_file():
            raise ValueError("parent adapter is missing its PEFT configuration")
        model = PeftModel.from_pretrained(model, parent_adapter, is_trainable=True)

    tokenized: list[dict[str, list[int]]] = []
    for sample in accepted_samples:
        prompt_ids = tokenizer(build_prompt(str(sample["prompt"])), add_special_tokens=True)["input_ids"]
        completion_ids = tokenizer(str(sample["code"]) + tokenizer.eos_token, add_special_tokens=False)["input_ids"]
        available = max_length - len(prompt_ids)
        if available <= 1:
            raise ValueError("prompt leaves no space for the accepted solution")
        completion_ids = completion_ids[:available]
        input_ids = prompt_ids + completion_ids
        tokenized.append({"input_ids": input_ids, "attention_mask": [1] * len(input_ids), "labels": [-100] * len(prompt_ids) + completion_ids})

    class AcceptedDataset(torch.utils.data.Dataset):
        def __len__(self) -> int:
            return len(tokenized)

        def __getitem__(self, index: int) -> dict[str, list[int]]:
            return tokenized[index]

    class PadBatch:
        def __call__(self, features: list[dict[str, list[int]]]) -> dict[str, torch.Tensor]:
            width = max(len(feature["input_ids"]) for feature in features)
            input_ids, masks, labels = [], [], []
            for feature in features:
                padding = width - len(feature["input_ids"])
                input_ids.append(feature["input_ids"] + [tokenizer.pad_token_id] * padding)
                masks.append(feature["attention_mask"] + [0] * padding)
                labels.append(feature["labels"] + [-100] * padding)
            return {
                "input_ids": torch.tensor(input_ids, dtype=torch.long),
                "attention_mask": torch.tensor(masks, dtype=torch.long),
                "labels": torch.tensor(labels, dtype=torch.long),
            }

    training_args = TrainingArguments(
        output_dir=str(output / "checkpoints"),
        num_train_epochs=epochs,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=learning_rate,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        weight_decay=0.01,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=2,
        fp16=dtype is torch.float16,
        bf16=dtype is torch.bfloat16,
        gradient_checkpointing=True,
        report_to=[],
        seed=17,
        data_seed=17,
    )
    trainer = Trainer(model=model, args=training_args, train_dataset=AcceptedDataset(), data_collator=PadBatch())
    trainer.train(resume_from_checkpoint=get_last_checkpoint(str(output / "checkpoints")))
    model.save_pretrained(output / "adapter")
    tokenizer.save_pretrained(output / "tokenizer")
    (output / "run.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
