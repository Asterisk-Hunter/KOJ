"""Hermetic unit tests for retry scheduling."""

from app.queue import retry_delay_seconds


def test_retry_delay_grows_exponentially_and_caps_at_five_minutes():
    assert retry_delay_seconds(1) == 5
    assert retry_delay_seconds(2) == 10
    assert retry_delay_seconds(3) == 20
    assert retry_delay_seconds(20) == 300


def test_retry_delay_handles_nonpositive_attempt_count():
    assert retry_delay_seconds(0) == 5
    assert retry_delay_seconds(-1) == 5
