"""Unbiased pass@k estimates for independent samples per problem."""

from __future__ import annotations

from collections.abc import Iterable


def estimate_pass_at_k(results: Iterable[Iterable[bool]], k: int) -> float:
    groups = [list(problem_results) for problem_results in results]
    if not groups:
        raise ValueError("at least one problem is required")
    if k < 1 or any(len(group) < k for group in groups):
        raise ValueError("each problem needs at least k judged samples")

    estimates: list[float] = []
    for group in groups:
        correct = sum(group)
        total = len(group)
        if total - correct < k:
            estimates.append(1.0)
            continue
        probability_all_fail = 1.0
        for index in range(k):
            probability_all_fail *= (total - correct - index) / (total - index)
        estimates.append(1.0 - probability_all_fail)
    return sum(estimates) / len(estimates)


def group_results(samples: Iterable[dict[str, object]]) -> dict[str, list[bool]]:
    grouped: dict[str, list[bool]] = {}
    for sample in samples:
        if sample.get("status") != "completed":
            continue
        key = sample.get("problem_key")
        verdict = sample.get("verdict")
        if not isinstance(key, str) or verdict is None:
            continue
        grouped.setdefault(key, []).append(verdict == "accepted")
    return grouped
