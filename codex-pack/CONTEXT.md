# KOJ — Live Context (verified 2026-09-21, Asia/Kolkata)

## What's live

| Piece | Where | Health |
|---|---|---|
| Website | https://koj-peach.vercel.app | `/api/health` 200 |
| Judge (FastAPI) | https://koj-judge-189400571693.asia-south1.run.app | `/health` `{"status":"ok","db":true}`, `/metrics` 200 |
| Database | Neon Postgres, `KOJ` project, ap-southeast-1 (Asterisk-Hunter org — location only) | fully migrated: email-unique, `case_results`, `judge_infra_error`, 12 indexes (6 app + 6 worker, non-overlapping) |
| Auth | Clerk, Asterisk-Hunter → KOJ app, dev/test instance (no prod instance exists yet) | GitHub + Google SSO on; org-creation prompt disabled via API; `/api/auth/me` is DB-only; admin layout redirects non-staff |
| Cache | Upstash Redis `koj-cache`, Mumbai | proven live (`standings:3` key observed after rankings hit) |
| Webhooks | Clerk → `/api/webhooks/clerk`, secret in Vercel prod | unsigned probe returns 400 (signature path active) |
| Repo | `Prajwal-k-tech/KOJ`, `main` is delivery branch, all PRs merged | tsc + lint + build green |

## Architecture in 30 seconds

- Next.js owns auth/validation/DB reads + all UI. FastAPI (`api/`) owns code execution only.
- Submit flow: `POST /api/submissions` → 202 + ID → fire-and-forget `POST /judge-async`
  (Cloud Run, secret header) → judge runs → verdict written to Neon → client learns via
  SSE (`/api/submissions/[id]/events`) or 2s leaderboard ticker.
- Judge: per-submission temp dir, `RLIMIT_CPU/AS/NPROC`, wall-clock timeout, C/C++/Python/Java.
- Scoring: ICPC — solved desc, penalty = first-AC minutes + 20 × wrong attempts before first AC.
- Problems: `draft → contest_active → published` state machine; contest end auto-publishes.
- Leaderboard: SSE ticker + optional Redis cache (8s standings TTL). Realtime is poll-push, not sockets.

## Decisions you should not revisit without asking

- DB roles are auth truth; Clerk org path was deliberately removed (it once granted admin broadly).
- Hide unauthorized UI, never rely on 403s (user complaint → fixed pattern in `/problems/create`).
- Redis is optional acceleration; DB-only is always correct.
- Test Clerk keys everywhere; no production Clerk instance yet (create before any real contest + custom OAuth creds).
- No test runner in repo (verify-then-delete scratch files only).
- Never push to Asterisk-Hunter; code lives on Prajwal-k-tech.

## Known gaps (honest)

- Signed-in end-to-end smoke never executed by an agent (script: ask user for `/tmp/koj-smoke/SMOKE-SCRIPT.md` equivalent or re-derive from `docs/`).
- No load test (10-concurrent-judge and ≤2s leaderboard are architecturally sound, unverified under load).
- Duplicate migration filename pairs (`0002_*`, `0003_*`) exist from parallel workers — see AGENT.md.
- Deferred per SRS: custom checkers, Go/Rust/JS, team mode, rating, scoreboard freeze, clarifications.

## Ask the user for (don't guess)

Prod Clerk keys, Upstash changes, Neon branch ops, Vercel/Cloud Run deploy approvals,
test accounts, scope changes (rating/freeze/teams/checkers), test-runner adoption.
