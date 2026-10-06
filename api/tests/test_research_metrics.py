from __future__ import annotations

import pytest

from ml.metrics import estimate_pass_at_k, group_results


def test_pass_at_k_uses_unbiased_estimator() -> None:
    samples = [[True, False, False, False], [False, False, False, False]]

    assert estimate_pass_at_k(samples, 1) == pytest.approx(0.125)
    assert estimate_pass_at_k(samples, 2) == pytest.approx(0.25)


def test_pass_at_k_handles_all_correct_and_k_equals_n() -> None:
    assert estimate_pass_at_k([[True] * 5, [True] * 5], 5) == 1.0
    assert estimate_pass_at_k([[False] * 5], 5) == 0.0


def test_pass_at_k_requires_enough_samples_for_each_problem() -> None:
    with pytest.raises(ValueError, match="at least k"):
        estimate_pass_at_k([[True, False], [False]], 2)


def test_group_results_excludes_infrastructure_failures() -> None:
    grouped = group_results(
        [
            {"problem_key": "p1", "status": "completed", "verdict": "accepted"},
            {"problem_key": "p1", "status": "completed", "verdict": "wrong_answer"},
            {"problem_key": "p1", "status": "dead", "verdict": None},
        ]
    )

    assert grouped == {"p1": [True, False]}
