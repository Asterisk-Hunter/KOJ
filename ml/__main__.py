from __future__ import annotations

import argparse
import json
from pathlib import Path

from .client import ResearchClient
from .loop import run_rounds

DEFAULT_MODEL = "Qwen/Qwen2.5-Coder-1.5B"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run KOJ-verdict-driven rejection-sampling LoRA experiments.")
    parser.add_argument("run", choices=["loop"])
    parser.add_argument("--dataset", required=True, help="Registered immutable KOJ research dataset slug")
    parser.add_argument("--version", required=True, help="Pinned imported dataset version")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", required=True, help="Immutable Hugging Face commit SHA for this model")
    parser.add_argument("--output", type=Path, default=Path("runs/koj-research"))
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--train-samples", type=int, default=16)
    parser.add_argument("--eval-samples", type=int, default=16)
    parser.add_argument("--train-problems", type=int, default=100)
    parser.add_argument("--eval-problems", type=int, default=100)
    parser.add_argument("--external-dataset")
    parser.add_argument("--external-version")
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()

    client = ResearchClient.from_environment()
    history = run_rounds(
        client=client,
        dataset=args.dataset,
        version=args.version,
        model_id=args.model,
        revision=args.revision,
        output=args.output,
        rounds=args.rounds,
        train_samples_per_problem=args.train_samples,
        eval_samples_per_problem=args.eval_samples,
        train_problem_limit=args.train_problems,
        eval_problem_limit=args.eval_problems,
        external_dataset=args.external_dataset,
        external_version=args.external_version,
        seed=args.seed,
    )
    print(json.dumps(history, indent=2))


if __name__ == "__main__":
    main()
