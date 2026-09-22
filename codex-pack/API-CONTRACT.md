# KOJ — API Contract

All Next.js handlers: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, JSON bodies bounded
(`app/api/body-guard.ts`; submissions cap 100 KB of code, judge requests cap 256 KB).
Errors are `{ "error": "<reason>" }` with a meaningful status. Verified against production
2026-09-22 where marked ✅.

## Public (no session)

| Method | Path | Behaviour | Verified |
|---|---|---|---|
| GET | `/api/health` | `{status, db, latencyMs}` — `select 1` probe | ✅ 200, db true |
| GET | `/api/problems` | `published` problems only; `?q=&difficulty=&category=`; computes acceptance; adds `userStatus` when signed in | ✅ 200 |
| GET | `/api/problems/[id]` | problem + sample cases + acceptance; 404 for non-published unless author/staff | ✅ |
| GET | `/api/contests` | all contests ordered by `startsAt`; maps DB status → UI status; `registered` flag per user | ✅ 200 |
| GET | `/api/contests/[id]` | by slug or numeric id; problems only when the contest has started | ✅ |
| GET | `/api/rankings?contestId=` | ICPC standings: solved desc, penalty = first-AC minutes + 20 × wrong-before-AC; 60-min scoreboard freeze; 8 s Redis cache when configured | ✅ 200 (1.4–1.9 s) |
| GET | `/api/auth/me` | `{authenticated, role, canAccessAdmin, canAuthor, canManageContests}` — safe for anonymous | ✅ 200 anonymous |
| POST | `/api/webhooks/clerk` | `user.created/updated/deleted` sync; signature verified | ✅ unsigned probe → 400 |

## Authenticated

| Method | Path | Behaviour |
|---|---|---|
| POST | `/api/submissions` | Body `{problemId, contestId?, language, code, mode:"run"\|"submit"}`. Validates ids, language ∈ `python\|c\|c++\|java\|go\|rust\|javascript` (all seven live-verified), non-empty code ≤ 100 KB, mode. Practice requires `published`; contest requires `status="live"` + registration + problem ∈ contest. Atomically enforces the 30 s per-problem cooldown with `pg_advisory_xact_lock` → **429 + `Retry-After`**. Inserts `pending`→`running`, dispatches `/judge-async`, returns **202 `{id, status:"running"}`**. 502 if dispatch fails. Verified unauthenticated → **401**. |
| GET | `/api/submissions?problemId=&contestId=` | **Both filters optional** (the history page relies on this) → up to 100 rows, owner-scoped, with problem titles. Verified 401 anonymous. |
| GET | `/api/submissions/[id]` | One submission, owner-scoped (404 otherwise) |
| GET | `/api/submissions/[id]/events` | **SSE** verdict stream; owner or admin |
| GET | `/api/contests/[id]/events` | **SSE** leaderboard/verdict stream |
| POST | `/api/contests/[id]/register` | Registers the signed-in user; rejects finished contests |
| POST | `/api/judge/run` | Interactive run against arbitrary stdin (samples/custom); 64 KB input, 100 KB code, 2.5 s cooldown, not persisted. **Must send `is_sample: true`** to the judge — it is the only caller of the sync `/judge` API, and a missing flag silently redacts stdout (the `(no stdout)` bug, `CONTEXT.md` D11). |

## Admin / staff

| Method | Path | Gate |
|---|---|---|
| GET | `/api/admin/summary` | `requireStaff` ✅ 401 anonymous |
| POST/GET | `/api/admin/problems` | `requireSetter` |
| GET/PATCH/DELETE | `/api/admin/problems/[id]` | `requireSetter` (delete also `requireAdmin`) |
| GET/POST | `/api/admin/problems/[id]/test-cases` | `requireSetter`, 10 MB per field, ≤ 100 cases |
| PATCH/DELETE | `/api/admin/problems/[id]/test-cases/[caseId]` | `requireSetter` |
| POST | `/api/admin/problems/[id]/test-cases/bulk` | `requireSetter` |
| POST | `/api/admin/problems/import` | `requireSetter` — LeetCode/Codeforces/AtCoder/Polygon parsers |
| GET/POST | `/api/admin/contests` | `requireContestManager` |
| GET/PATCH/DELETE | `/api/admin/contests/[id]` | `requireContestManager` (legal transitions `draft→live→ended→archived`) |
| POST/DELETE | `/api/admin/contests/[id]/problems` | `requireContestManager` |
| GET | `/api/admin/users` | `requireAdmin` (role changes; self-change refused) |
| GET | `/api/admin/submissions` | `requireAdmin` |
| POST | `/api/admin/submissions/recover` | `requireAdmin` — marks stale `pending`/`running`; also safe for cron |
| GET | `/api/admin/metrics` | `requireAdmin` |

## FastAPI judge (`api/`)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{status, db, sandbox}` — `sandbox` is `rlimit` or `docker` ✅ |
| GET | `/` | `{service, docs}` |
| POST | `/judge` | Sync. Requires `X-Judge-Secret` (constant-time compare) ✅ 401 without. `language` ∉ the seven supported → 422 ✅ (older docs list only four; `go`/`rust`/`javascript` are live). Bounded by a semaphore; saturated → **503 + `Retry-After: 5`**. Hidden cases (`is_sample=false`) get redacted stdout/stderr ✅. |
| POST | `/judge-async` | `{submission_id}`. Loads the row (must be `running`), judges, writes the verdict back. Duplicate dispatch → dedupe/replay. Infra failure → `pending` + `judge_infra_error=true`, **never** a contestant `runtime_error`. 404 for unknown ids. |
| GET | `/metrics` | **404 — does not exist.** `docs/status.md` claims otherwise (D4). Do not depend on it. |

Notes for anyone touching the judge:

- `JUDGE_INTERNAL_SECRET` must match on both sides; empty disables judging (500).
- The same semaphore bounds `/judge` and `/judge-async`; `JUDGE_MAX_CONCURRENT` default 4.
- Cloud Run: `maxScale=5`, `cpu=2/memory=1Gi`, `containerConcurrency=4`, 4 uvicorn workers.
- Never log request bodies, source code, or case data (policy in `DEPLOYMENT_CONTRACT.md` §10).
