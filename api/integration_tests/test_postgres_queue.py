"""Real SQL/worker tests, opt-in only through verify-postgres-queue.py.

Connections are hardcoded to the harness's internal Docker alias. Never accept
an arbitrary environment DSN, and verify the disposable marker before writes.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time

import psycopg
import pytest

from app import db, queue
from app.config import settings
from app.judge import CaseResult, JudgeResponse

DSN = "postgresql://koj_test:koj_test_only@koj-postgres/koj_queue_test?sslmode=disable"
_REAL_CONNECT = psycopg.connect
_REAL_CLASS_CONNECT = psycopg.Connection.connect
pytestmark = [pytest.mark.integration, pytest.mark.skipif(
    os.environ.get("KOJ_DISPOSABLE_POSTGRES") != "1",
    reason="Run scripts/deployment/verify-postgres-queue.py for disposable PostgreSQL",
)]


@pytest.fixture(autouse=True)
def forbid_database_connections(monkeypatch):
    # Override only this module's inherited hermetic-unit-test guard.
    assert os.environ.get("KOJ_DISPOSABLE_POSTGRES") == "1"
    assert sys.platform == "linux"
    with _REAL_CONNECT(DSN, connect_timeout=3) as conn:
        assert conn.execute(
            "SELECT current_database(), shobj_description(oid, 'pg_database') "
            "FROM pg_database WHERE datname = current_database()"
        ).fetchone() == ("koj_queue_test", "koj-disposable-postgres-check")
    monkeypatch.setattr(psycopg, "connect", _REAL_CONNECT)
    monkeypatch.setattr(psycopg.Connection, "connect", _REAL_CLASS_CONNECT)
    db.close_pool()
    monkeypatch.setattr(settings, "DATABASE_URL", DSN)
    monkeypatch.setattr(settings, "DATABASE_TLS_VERIFY", False)
    db.init_pool()
    with db.get_connection() as conn:
        conn.execute("TRUNCATE judge_workers, judge_jobs, submissions, problem_test_cases, problems, users RESTART IDENTITY CASCADE")
        conn.execute("INSERT INTO users (clerk_id, username, email) VALUES ('synthetic', 'synthetic', 'synthetic@example.invalid')")
        conn.execute("INSERT INTO problems (author_id, title, statement, input_format, output_format, constraints) VALUES ('synthetic', 'test', '', '', '', '')")
    yield
    db.close_pool()


def sql(query, params=()):
    with db.get_connection() as conn:
        cursor = conn.execute(query, params)
        return cursor.fetchall() if cursor.description else []


def seed(count=1, *, max_attempts=3, code="print('ok')"):
    ids = []
    for _ in range(count):
        submission_id = sql(
            "INSERT INTO submissions (user_id, problem_id, language, code) "
            "VALUES ('synthetic', 1, 'python', %s) RETURNING id", (code,),
        )[0][0]
        ids.append(sql("INSERT INTO judge_jobs (submission_id, max_attempts) VALUES (%s, %s) RETURNING id",
                       (submission_id, max_attempts))[0][0])
    return ids


def worker(name):
    queue.register_worker(name, "synthetic-host")
    return name


def accepted():
    return JudgeResponse(status="accepted", passed_tests=1, total_tests=1, execution_time_ms=7,
                         cases=[CaseResult(index=0, passed=True, verdict="accepted", runtime_ms=7, stdout="ok", stderr="")])


def snapshot():
    return (sql("SELECT * FROM judge_jobs ORDER BY id"),
            sql("SELECT * FROM submissions ORDER BY id"),
            sql("SELECT * FROM judge_workers ORDER BY id"))


def expire(job):
    sql("UPDATE judge_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = %s", (job.id,))


def test_simultaneous_claims_are_unique():
    ids = seed(32)
    workers = [worker(f"parallel-{index}") for index in range(8)]
    barrier = threading.Barrier(8, timeout=10)

    def claim(name):
        barrier.wait()
        return queue.claim_job(name, 30)

    claims = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        for _ in range(4):
            claims.extend(executor.map(claim, workers, timeout=15))
    assert all(job is not None and job.attempt == 1 for job in claims)
    assert sorted(job.id for job in claims) == ids
    assert queue.claim_job(workers[0], 30) is None
    assert sql("SELECT count(*) FROM submissions WHERE status = 'running'") == [(32,)]


def test_simultaneous_expired_takeover_has_one_winner():
    seed()
    old = queue.claim_job(worker("gone"), 30)
    expire(old)
    workers = [worker(f"takeover-{index}") for index in range(8)]
    barrier = threading.Barrier(8, timeout=10)

    def claim(name):
        barrier.wait()
        return queue.claim_job(name, 30)

    with ThreadPoolExecutor(max_workers=8) as executor:
        claims = list(executor.map(claim, workers, timeout=15))
    winners = [job for job in claims if job is not None]
    assert len(winners) == 1
    assert winners[0].id == old.id and winners[0].attempt == 2
    assert sql("SELECT attempts FROM judge_jobs") == [(2,)]


def test_claim_skips_locked_row_without_waiting():
    first, second = seed(2)
    name = worker("skip-lock")
    with db.get_connection() as conn, conn.transaction():
        conn.execute("SELECT id FROM judge_jobs WHERE id = %s FOR UPDATE", (first,))
        start = time.monotonic()
        job = queue.claim_job(name, 30)
        assert job.id == second
        assert time.monotonic() - start < 1.5
    assert queue.claim_job(name, 30).id == first


@pytest.mark.parametrize("takeover", ["none", "different-worker", "same-worker"])
def test_expired_and_stale_attempt_writes_are_fenced(takeover):
    seed()
    old_worker = worker("old")
    old = queue.claim_job(old_worker, 30)
    expire(old)
    if takeover != "none":
        new_worker = old_worker if takeover == "same-worker" else worker("new")
        new = queue.claim_job(new_worker, 30)
        assert new.id == old.id and new.attempt == old.attempt + 1
        assert sql("SELECT leased_by FROM judge_jobs") == [(new_worker,)]
    before = snapshot()
    assert not queue.heartbeat_worker(old_worker, old, 30)
    assert not queue.complete_job(old_worker, old, accepted())
    assert not queue.retry_job(old_worker, old, "private diagnostic", 1)
    queue.mark_job_unavailable(old_worker, old)
    assert snapshot() == before
    if takeover != "none":
        assert queue.complete_job(new_worker, new, accepted())
        assert sql("SELECT status, attempts FROM judge_jobs") == [("completed", 2)]


def test_heartbeat_renews_active_lease_and_blocks_takeover():
    seed()
    name = worker("active")
    job = queue.claim_job(name, 30)
    sql("UPDATE judge_jobs SET lease_expires_at = clock_timestamp() + interval '1 second' WHERE id = %s", (job.id,))
    assert queue.heartbeat_worker(name, job, 30)
    time.sleep(1.1)
    assert queue.claim_job(worker("competitor"), 30) is None
    assert sql("SELECT lease_expires_at > clock_timestamp() + interval '25 seconds' FROM judge_jobs") == [(True,)]


def test_wrong_owner_or_attempt_cannot_write_active_lease():
    seed()
    name = worker("owner")
    job = queue.claim_job(name, 30)
    worker("impostor")
    before = snapshot()
    for owner, attempt in [("impostor", job), (name, replace(job, attempt=job.attempt + 1))]:
        assert not queue.heartbeat_worker(owner, attempt, 30)
        assert not queue.complete_job(owner, attempt, accepted())
        assert not queue.retry_job(owner, attempt, "diagnostic")
        queue.mark_job_unavailable(owner, attempt)
    assert snapshot() == before


def test_completion_and_retry_persist_atomically():
    seed(max_attempts=2)
    sql("INSERT INTO problem_test_cases (problem_id, input, expected_output, is_sample) VALUES (1, '', 'ok', true)")
    name = worker("retry")
    first = queue.claim_job(name, 30)
    submission = queue.load_submission(first.submission_id)
    assert submission.language == "python" and len(submission.cases) == 1
    assert queue.retry_job(name, first, "secret internal diagnostic", 1)
    assert sql("SELECT status, leased_by, lease_expires_at, completed_at, available_at > clock_timestamp() FROM judge_jobs") == [("queued", None, None, None, True)]
    assert sql("SELECT status, judge_infra_error, completed_at, case_results FROM submissions") == [("pending", True, None, None)]
    assert queue.claim_job(name, 30) is None
    sql("UPDATE judge_jobs SET available_at = clock_timestamp() - interval '1 second'")
    second = queue.claim_job(name, 30)
    assert second.attempt == 2
    assert queue.complete_job(name, second, accepted())
    assert sql("SELECT status, leased_by, lease_expires_at, completed_at IS NOT NULL FROM judge_jobs") == [("completed", None, None, True)]
    row = sql("SELECT status, judge_infra_error, passed_tests, total_tests, execution_time_ms, case_results FROM submissions")[0]
    assert row[:5] == ("accepted", False, 1, 1, 7)
    assert row[5][0]["passed"] is True
    assert sql("SELECT status, active_job_id FROM judge_workers") == [("idle", None)]


@pytest.mark.parametrize("operation", ["heartbeat", "complete", "retry", "unavailable"])
def test_write_waiting_on_lock_cannot_cross_lease_expiry(operation):
    seed()
    name = worker("blocked-writer")
    job = queue.claim_job(name, 30)
    sql("UPDATE judge_jobs SET lease_expires_at = clock_timestamp() + interval '1 second'")
    before = snapshot()

    def write():
        if operation == "heartbeat":
            return queue.heartbeat_worker(name, job, 30)
        if operation == "complete":
            return queue.complete_job(name, job, accepted())
        if operation == "retry":
            return queue.retry_job(name, job, "diagnostic")
        return queue.mark_job_unavailable(name, job)

    with ThreadPoolExecutor(max_workers=1) as executor:
        with db.get_connection() as conn, conn.transaction():
            conn.execute("SELECT id FROM judge_jobs WHERE id = %s FOR UPDATE", (job.id,))
            future = executor.submit(write)
            wait_until(lambda: sql(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND cardinality(pg_blocking_pids(pid)) > 0",
            )[0][0] == 1, 1)
            wait_until(lambda: sql("SELECT lease_expires_at <= clock_timestamp() FROM judge_jobs")[0][0], 1.5)
        assert future.result(timeout=5) is (None if operation == "unavailable" else False)
    assert snapshot() == before


@pytest.mark.parametrize("operation", ["complete", "retry"])
def test_submission_write_failure_rolls_back_job_and_worker(operation):
    seed()
    name = worker("rollback")
    job = queue.claim_job(name, 30)
    before = snapshot()
    sql("CREATE FUNCTION integration_reject_submission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic persistence failure'; END $$")
    sql("CREATE TRIGGER integration_reject_submission BEFORE UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION integration_reject_submission()")
    try:
        with pytest.raises(psycopg.errors.RaiseException, match="synthetic persistence failure"):
            if operation == "complete":
                queue.complete_job(name, job, accepted())
            else:
                queue.retry_job(name, job, "diagnostic")
        assert snapshot() == before
        assert queue.heartbeat_worker(name, job, 30)
    finally:
        sql("DROP TRIGGER integration_reject_submission ON submissions")
        sql("DROP FUNCTION integration_reject_submission()")


def test_last_infrastructure_attempt_becomes_terminal():
    seed(max_attempts=1)
    name = worker("last-attempt")
    job = queue.claim_job(name, 30)
    assert queue.retry_job(name, job, "private diagnostic", 2)
    assert sql("SELECT status, last_error, completed_at IS NOT NULL FROM judge_jobs") == [("dead", "Judge infrastructure temporarily unavailable.", True)]
    assert sql("SELECT status, judge_infra_error, total_tests, completed_at IS NOT NULL FROM submissions") == [("runtime_error", True, 2, True)]
    assert queue.claim_job(name, 30) is None


def test_exhausted_recovery_is_bounded_and_skips_locks():
    ids = seed(108, max_attempts=1)
    sql("UPDATE judge_jobs SET attempts = 1")
    sql("UPDATE judge_jobs SET status = 'leased', leased_by = 'gone', lease_expires_at = clock_timestamp() - interval '1 second' WHERE id IN (%s, %s)", tuple(ids[:2]))
    active, future, locked = ids[-3:]
    sql("UPDATE judge_jobs SET status = 'leased', leased_by = 'active', lease_expires_at = clock_timestamp() + interval '30 seconds' WHERE id = %s", (active,))
    sql("UPDATE judge_jobs SET available_at = clock_timestamp() + interval '30 seconds' WHERE id = %s", (future,))
    with db.get_connection() as conn, conn.transaction():
        conn.execute("SELECT id FROM judge_jobs WHERE id = %s FOR UPDATE", (locked,))
        assert queue.finalize_exhausted_jobs() == 100
        assert queue.finalize_exhausted_jobs() == 5
        assert queue.finalize_exhausted_jobs() == 0
    assert queue.finalize_exhausted_jobs() == 1
    assert sql("SELECT count(*) FROM judge_jobs WHERE status = 'dead' AND leased_by IS NULL AND lease_expires_at IS NULL AND completed_at IS NOT NULL") == [(106,)]
    assert sql("SELECT count(*) FROM submissions WHERE status = 'runtime_error' AND judge_infra_error AND completed_at IS NOT NULL") == [(106,)]
    assert queue.claim_job(worker("recovery"), 30) is None


def test_job_lock_allows_worker_foreign_key_check():
    seed()
    name = worker("fk-worker")
    job = queue.claim_job(name, 30)
    sql("UPDATE judge_workers SET active_job_id = NULL WHERE id = %s", (name,))
    worker_locked = threading.Event()
    check_fk = threading.Event()

    def update_worker():
        with db.get_connection() as conn, conn.transaction():
            conn.execute("SELECT id FROM judge_workers WHERE id = %s FOR UPDATE", (name,))
            worker_locked.set()
            assert check_fk.wait(5)
            conn.execute("UPDATE judge_workers SET active_job_id = %s WHERE id = %s", (job.id, name))

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(update_worker)
        try:
            assert worker_locked.wait(5)
            with db.get_connection() as conn, conn.transaction(), conn.cursor() as cur:
                queue._lock_job(cur, job.id)
                check_fk.set()
                # FOR UPDATE here would block the worker's FK KEY SHARE check.
                future.result(timeout=1.5)
        finally:
            check_fk.set()
    assert sql("SELECT active_job_id FROM judge_workers WHERE id = %s", (name,)) == [(job.id,)]


def test_stale_write_waits_for_rejudge_job_then_submission_locks():
    seed()
    name = worker("before-rejudge")
    old = queue.claim_job(name, 30)
    assert queue.complete_job(name, old, accepted())
    with ThreadPoolExecutor(max_workers=1) as executor:
        with db.get_connection() as conn, conn.transaction():
            # Replay the route's relevant lock/reset SQL, not its TS handler.
            conn.execute("SELECT id FROM judge_jobs WHERE id = %s ORDER BY id FOR UPDATE", (old.id,))
            conn.execute("SELECT id FROM submissions WHERE id = %s ORDER BY id FOR UPDATE", (old.submission_id,))
            future = executor.submit(queue.complete_job, name, old, accepted())
            wait_until(lambda: sql(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND cardinality(pg_blocking_pids(pid)) > 0"
            )[0][0] == 1, 1)
            conn.execute("UPDATE submissions SET status = 'pending', completed_at = NULL WHERE id = %s", (old.submission_id,))
            conn.execute("UPDATE judge_jobs SET status = 'queued', attempts = 0, leased_by = NULL, lease_expires_at = NULL, completed_at = NULL WHERE id = %s", (old.id,))
        assert future.result(timeout=5) is False
    assert sql("SELECT status, attempts, completed_at FROM judge_jobs") == [("queued", 0, None)]
    assert sql("SELECT status, completed_at FROM submissions") == [("pending", None)]
    new_name = worker("after-rejudge")
    new = queue.claim_job(new_name, 30)
    assert new.id == old.id and new.attempt == 1
    assert not queue.complete_job(name, old, accepted())
    assert queue.complete_job(new_name, new, accepted())


def wait_until(check, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.1)
    raise AssertionError(f"Condition did not become true within {seconds}s")


def test_real_worker_sigkill_natural_lease_recovery():
    seed(code="import time\ntime.sleep(0.5)\nprint('ok')")
    sql("INSERT INTO problem_test_cases (problem_id, input, expected_output, position) SELECT 1, '', 'ok', n FROM generate_series(1, 40) AS n")
    processes = []
    env = {"PATH": os.environ["PATH"], "HOME": "/tmp", "DATABASE_URL": DSN,
           "DATABASE_TLS_VERIFY": "false", "JUDGE_SANDBOX_MODE": "rlimit",
           "JUDGE_LEASE_SECONDS": "30", "JUDGE_WORKER_POLL_SECONDS": "0.2",
           "PYTHONDONTWRITEBYTECODE": "1", "JUDGE_INTERNAL_SECRET": "synthetic"}
    with tempfile.TemporaryFile(mode="w+") as log:
        def start():
            process = subprocess.Popen([sys.executable, "-m", "app.worker"], env=env,
                                       stdout=log, stderr=log, start_new_session=True)
            processes.append(process)
            return process

        try:
            first = start()
            initial = wait_until(lambda: sql("SELECT leased_by, heartbeat_at FROM judge_jobs WHERE status = 'leased' AND attempts = 1"), 30)[0]
            wait_until(lambda: sql("SELECT heartbeat_at > %s FROM judge_jobs", (initial[1],))[0][0], 15)
            os.killpg(first.pid, signal.SIGKILL)
            assert first.wait(timeout=5) == -signal.SIGKILL
            # Do not accelerate expiry: prove recovery at the real 30-second lease.
            assert queue.claim_job(worker("early-contender"), 30) is None
            second = start()
            wait_until(lambda: sql("SELECT attempts = 2 AND leased_by <> %s FROM judge_jobs", (initial[0],))[0][0], 40)
            wait_until(lambda: sql("SELECT status = 'completed' FROM judge_jobs")[0][0], 40)
            assert sql("SELECT status, judge_infra_error, passed_tests, total_tests FROM submissions") == [("accepted", False, 40, 40)]
            second.send_signal(signal.SIGTERM)
            assert second.wait(timeout=10) == 0
            assert sql("SELECT status, stopped_at IS NOT NULL FROM judge_workers WHERE last_job_id = 1 AND id <> %s", (initial[0],)) == [("stopping", True)]
        except BaseException:
            log.seek(0)
            print(log.read())
            raise
        finally:
            for process in processes:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
