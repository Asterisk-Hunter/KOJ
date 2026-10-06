"""Private, bounded research evaluation over server-held test cases."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import db
from .config import settings

router = APIRouter(prefix="/v1/research", tags=["research"])
_SAMPLE_ID = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
_MAX_CANDIDATE_BYTES = 16 * 1024
_MAX_TOTAL_CODE_BYTES = 512 * 1024


class ResearchCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sample_id: str
    problem_key: str = Field(min_length=1, max_length=160)
    code: str = Field(min_length=1, max_length=_MAX_CANDIDATE_BYTES)

    @field_validator("sample_id")
    @classmethod
    def validate_sample_id(cls, value: str) -> str:
        if not _SAMPLE_ID.fullmatch(value):
            raise ValueError("sample_id must contain only letters, digits, _ or -")
        return value


class ResearchRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset: str = Field(min_length=1, max_length=80)
    version: str = Field(min_length=1, max_length=80)
    split: Literal["train", "heldout", "external"]
    model_id: str = Field(min_length=1, max_length=200)
    round: int = Field(ge=0, le=10)
    candidates: list[ResearchCandidate] = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def validate_batch(self) -> "ResearchRunRequest":
        sample_ids = [candidate.sample_id for candidate in self.candidates]
        problem_keys = {candidate.problem_key for candidate in self.candidates}
        total_code_bytes = sum(len(candidate.code.encode("utf-8")) for candidate in self.candidates)
        if len(sample_ids) != len(set(sample_ids)):
            raise ValueError("sample_id values must be unique within a run")
        if len(problem_keys) != 1:
            raise ValueError("each run must contain samples for exactly one problem")
        if total_code_bytes > _MAX_TOTAL_CODE_BYTES:
            raise ValueError("total candidate code exceeds the batch limit")
        return self


def _authorize(provided: str | None) -> None:
    expected = settings.TRAINING_API_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="research evaluation is disabled")
    if not provided or not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


def _payload_hash(request: ResearchRunRequest) -> str:
    payload = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@router.get("/problems")
def list_research_problems(
    dataset: str = Query(min_length=1, max_length=80),
    version: str = Query(min_length=1, max_length=80),
    split: Literal["train", "heldout", "external"] = Query(),
    after: str | None = Query(default=None, max_length=160),
    limit: int = Query(default=50, ge=1, le=50),
    x_training_secret: str | None = Header(default=None, alias="X-Training-Secret"),
) -> dict[str, object]:
    _authorize(x_training_secret)
    with db.get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT problem.source_problem_id, problem.prompt "
            "FROM research_problems AS problem JOIN research_datasets AS dataset "
            "ON dataset.id = problem.dataset_id WHERE dataset.organization_id = %s "
            "AND dataset.slug = %s AND dataset.version = %s "
            "AND problem.split = %s AND (%s::text IS NULL OR problem.source_problem_id > %s) "
            "ORDER BY problem.source_problem_id LIMIT %s",
            (settings.TRAINING_ORGANIZATION_ID, dataset, version, split, after, after, limit + 1),
        )
        rows = cur.fetchall()
    has_more = len(rows) > limit
    page = rows[:limit]
    return {
        "problems": [{"problem_key": row[0], "prompt": row[1]} for row in page],
        "next_after": page[-1][0] if has_more and page else None,
    }


@router.post("/runs", status_code=202)
def create_research_run(
    request: ResearchRunRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    x_training_secret: str | None = Header(default=None, alias="X-Training-Secret"),
) -> dict[str, object]:
    _authorize(x_training_secret)
    if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 128:
        raise HTTPException(status_code=400, detail="valid Idempotency-Key required")

    key_hash = hashlib.sha256(idempotency_key.strip().encode("utf-8")).hexdigest()
    payload_hash = _payload_hash(request)
    problem_key = request.candidates[0].problem_key

    with db.get_connection() as conn, conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('koj:research-admission'), 0)")
            cur.execute(
                "DELETE FROM research_runs AS run WHERE run.created_at < NOW() - INTERVAL '30 days' "
                "AND NOT EXISTS (SELECT 1 FROM research_samples AS sample WHERE sample.run_id = run.id "
                "AND sample.status IN ('queued', 'leased'))"
            )
            cur.execute(
                "SELECT id, payload_sha256 FROM research_runs WHERE idempotency_key_hash = %s",
                (key_hash,),
            )
            existing = cur.fetchone()
            if existing:
                if existing[1] != payload_hash:
                    raise HTTPException(status_code=409, detail="idempotency key reused with different input")
                return {"run_id": str(existing[0]), "status": "accepted", "deduped": True}

            cur.execute(
                "SELECT dataset.id, problem.id FROM research_datasets AS dataset "
                "JOIN research_problems AS problem ON problem.dataset_id = dataset.id "
                "WHERE dataset.organization_id = %s AND dataset.slug = %s AND dataset.version = %s AND problem.source_problem_id = %s "
                "AND problem.split = %s",
                (settings.TRAINING_ORGANIZATION_ID, request.dataset, request.version, problem_key, request.split),
            )
            selected_problem = cur.fetchone()
            if selected_problem is None:
                raise HTTPException(status_code=404, detail="problem is not registered in this dataset split")
            dataset_id, problem_id = selected_problem

            cur.execute("SELECT count(*) FROM research_samples WHERE status IN ('queued', 'leased')")
            if cur.fetchone()[0] + len(request.candidates) > settings.TRAINING_MAX_ACTIVE_SAMPLES:
                raise HTTPException(status_code=503, detail="research queue is full", headers={"Retry-After": "60"})
            cur.execute(
                "SELECT count(*) FROM research_samples WHERE created_at >= date_trunc('day', NOW())"
            )
            if cur.fetchone()[0] + len(request.candidates) > settings.TRAINING_DAILY_SAMPLE_LIMIT:
                cur.execute("SELECT GREATEST(1, ceil(extract(epoch FROM date_trunc('day', NOW()) + INTERVAL '1 day' - NOW()))::integer)")
                retry_after = str(cur.fetchone()[0])
                raise HTTPException(status_code=429, detail="daily research sample limit reached", headers={"Retry-After": retry_after})
            cur.execute("SELECT count(*) FROM research_samples")
            if cur.fetchone()[0] + len(request.candidates) > settings.TRAINING_MAX_RETAINED_SAMPLES:
                raise HTTPException(status_code=507, detail="research storage limit reached")

            cur.execute(
                "INSERT INTO research_runs "
                "(dataset_id, split, model_id, round, idempotency_key_hash, payload_sha256, total_samples) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (dataset_id, request.split, request.model_id, request.round, key_hash, payload_hash, len(request.candidates)),
            )
            run_id = cur.fetchone()[0]
            cur.executemany(
                "INSERT INTO research_samples (run_id, dataset_id, split, problem_id, sample_id, code) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                [
                    (run_id, dataset_id, request.split, problem_id, candidate.sample_id, candidate.code)
                    for candidate in request.candidates
                ],
            )
    return {"run_id": str(run_id), "status": "accepted", "deduped": False}


@router.get("/runs/{run_id}")
def get_research_run(
    run_id: UUID,
    x_training_secret: str | None = Header(default=None, alias="X-Training-Secret"),
) -> dict[str, object]:
    _authorize(x_training_secret)
    with db.get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT run.id, run.total_samples, "
            "count(sample.id) FILTER (WHERE sample.status = 'completed'), "
            "count(sample.id) FILTER (WHERE sample.verdict = 'accepted'), "
            "count(sample.id) FILTER (WHERE sample.status = 'dead') "
            "FROM research_runs AS run LEFT JOIN research_samples AS sample ON sample.run_id = run.id "
            "WHERE run.id = %s GROUP BY run.id",
            (run_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="research run not found")
        cur.execute(
            "SELECT sample.sample_id, sample.status, sample.verdict "
            "FROM research_samples AS sample WHERE sample.run_id = %s ORDER BY sample.sample_id",
            (run_id,),
        )
        samples = [{"sample_id": sample[0], "status": sample[1], "verdict": sample[2]} for sample in cur.fetchall()]

    completed, total, dead = row[2], row[1], row[4]
    status = "completed" if completed + dead == total else "running" if completed + dead else "queued"
    return {
        "run_id": str(row[0]),
        "status": status,
        "total_samples": total,
        "completed_samples": completed,
        "accepted_samples": row[3],
        "infrastructure_failures": row[4],
        "samples": samples,
    }


def claim_sample(worker_id: str, lease_seconds: int) -> dict[str, object] | None:
    with db.get_connection() as conn, conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('koj:research-worker-capacity'), 0)")
            cur.execute(
                "UPDATE research_samples SET status = 'dead', leased_by = NULL, lease_expires_at = NULL, "
                "completed_at = NOW() WHERE status = 'leased' AND attempts >= 3 AND lease_expires_at <= NOW()"
            )
            cur.execute("SELECT count(*) FROM research_samples WHERE status = 'leased' AND lease_expires_at > NOW()")
            if cur.fetchone()[0] >= 1:
                return None
            cur.execute(
                "WITH candidate AS (SELECT id FROM research_samples WHERE attempts < 3 AND ("
                "(status = 'queued' AND available_at <= NOW()) OR (status = 'leased' AND lease_expires_at <= NOW())) "
                "ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1) "
                "UPDATE research_samples AS sample SET status = 'leased', attempts = sample.attempts + 1, "
                "leased_by = %s, lease_expires_at = NOW() + (%s * INTERVAL '1 second') "
                "FROM candidate WHERE sample.id = candidate.id "
                "RETURNING sample.id, sample.run_id, sample.problem_id, sample.attempts",
                (worker_id, lease_seconds),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cur.execute(
                "SELECT test_cases, time_limit_ms, memory_limit_mb FROM research_problems WHERE id = %s",
                (row[2],),
            )
            problem = cur.fetchone()
            cur.execute("SELECT code FROM research_samples WHERE id = %s", (row[0],))
            code = cur.fetchone()[0]
    return {"id": row[0], "run_id": row[1], "problem_id": row[2], "attempt": row[3], "code": code,
            "cases": problem[0], "time_limit_ms": problem[1], "memory_limit_mb": problem[2]}


def heartbeat_sample(sample_id: UUID, worker_id: str, lease_seconds: int) -> bool:
    with db.get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE research_samples SET lease_expires_at = NOW() + (%s * INTERVAL '1 second') "
            "WHERE id = %s AND status = 'leased' AND leased_by = %s AND lease_expires_at > NOW()",
            (lease_seconds, sample_id, worker_id),
        )
        return cur.rowcount == 1


def complete_sample(sample_id: UUID, worker_id: str, attempt: int, verdict: str) -> bool:
    with db.get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE research_samples SET status = 'completed', verdict = %s, completed_at = NOW(), "
            "leased_by = NULL, lease_expires_at = NULL WHERE id = %s AND status = 'leased' "
            "AND leased_by = %s AND attempts = %s AND lease_expires_at > NOW()",
            (verdict, sample_id, worker_id, attempt),
        )
        return cur.rowcount == 1


def retry_sample(sample_id: UUID, worker_id: str, attempt: int) -> bool:
    retry = attempt < 3
    with db.get_connection() as conn, conn.cursor() as cur:
        completion_sql = "NULL" if retry else "NOW()"
        cur.execute(
            "UPDATE research_samples SET status = %s, available_at = NOW() + (%s * INTERVAL '1 second'), "
            f"leased_by = NULL, lease_expires_at = NULL, completed_at = {completion_sql} "
            "WHERE id = %s AND status = 'leased' AND leased_by = %s AND attempts = %s AND lease_expires_at > NOW()",
            ("queued" if retry else "dead", min(30 * (2 ** max(0, attempt - 1)), 300), sample_id, worker_id, attempt),
        )
        return cur.rowcount == 1
