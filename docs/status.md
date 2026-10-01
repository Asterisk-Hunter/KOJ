# Implementation Status — `main` at `0c46728`

> This describes `main` at commit `0c46728`. It was derived from reading the code, not from other docs. Where a doc contradicts the code, the code wins and the contradiction is called out. Claims that could not be checked without live services are marked UNVERIFIED rather than guessed.
>
> **Last verified command results: none.** `node_modules` is not installed in this working copy, so no build, lint, or test has been run since the repo was acquired. The Definition of Done in `AGENTS.md` has NOT been satisfied for this snapshot.

---

## Stack (as it actually is)

| Layer | Reality |
|---|---|
| Frontend | Next.js 16.3.0 App Router, React 19.2.8, TypeScript, Tailwind v4 (no `tailwind.config.js`) |
| DB / ORM | Drizzle ORM + Neon Postgres (`db/schema.ts`) |
| Auth | Clerk (`proxy.ts` at root; `createRouteMatcher` still in use at `proxy.ts:1`, deprecated by Clerk but live; no `middleware.ts` — `proxy.ts` is the correct Next 16 filename) |
| Judge | Separate FastAPI service in `api/` |
| Cache (optional) | Upstash/Redis, read-side only, every call site falls back to Postgres |

---

## HTTP surface — 29 route handlers under `app/api/**/route.ts`

16 are admin/auth-gated. The rest:

| Method | Path | Gate | Notes |
|---|---|---|---|
| `GET` | `/api/problems` | Public | Published list |
| `GET` | `/api/problems/[id]` | Public | Samples only; drafts never leak; explanation hidden during a live contest |
| `GET` | `/api/contests` | Public | Contest list |
| `GET` | `/api/contests/[id]` | Public | Contest detail |
| `POST` | `/api/contests/[id]/register` | Signed in | scrypt invite code, with legacy-plaintext fallback |
| `GET` | `/api/rankings` | Public | ICPC/DOMjudge: penalty, first-to-solve, 60-min freeze, balloon colors |
| `GET` | `/api/health` | Public | Always HTTP 200; reports db + latency |
| `GET` | `/api/auth/me` | Signed in | Lazy-creates the Neon user row |
| `POST` | `/api/submissions` | Own gate | 30s rate limit under `pg_advisory_xact_lock`; 202 + fire-and-forget `/judge-async` |
| `GET` | `/api/submissions/[id]` | Own gate | Owner only |
| `POST` | `/api/judge/run` | Own gate | Sync; in-memory 2.5s cooldown; 100KB cap |
| `GET` | `/api/submissions/[id]/events` | Own gate | SSE stream (see Realtime) |
| `GET` | `/api/contests/[id]/events` | Own gate | SSE stream (see Realtime) |
| `POST` | `/api/webhooks/clerk` | svix HMAC | Handles `user.created` / `user.updated` / `user.deleted` |
| * | `/api/admin/*` (16 handlers) | `requireAdmin` / `requireSetter` / `requireStaff` / `requireContestManager` | See Roles |

---

## Pages — 14 `page.tsx`

Public per `proxy.ts`: `/`, `/sign-in/*`, `/sign-up/*`, `/problems*`, `/contests*`, `/rankings`, `/submissions*`.

Protected: `/dashboard` (also re-checks `auth()` server-side) and `/admin` (additionally requires Neon role in `{admin, setter}`, else redirects to `/dashboard`).

Two honest caveats:

- `/problems/create` and `/contests/[id]/arena` are **public at the proxy layer**. `/problems/create` is gated client-side via `/api/auth/me` `canAuthor` — that is not server-enforced on the route itself.

---

## Roles

Exactly three values: `contestant | setter | admin` (`db/schema.ts:46-50`). The legacy `problem_setter` / `contest_setter` values were dropped by `db/migrations/0005_setter_merge.sql`.

Authorization is decided by `app/api/admin/authz.ts`: a comma-separated `ADMIN_CLERK_IDS` env allowlist checked first, then Neon `users.role`.

**Clerk `org:admin` is NOT used anywhere** — there is no Clerk Organizations API call in the codebase. Whether Organizations are enabled in the Clerk dashboard is UNVERIFIED. Any doc claiming an `org:admin` gate describes intent, not code.

---

## Judge (`api/app/judge.py`, `api/app/main.py`)

**7 languages, not 4:** python, c, c++, java, go, rust, javascript (`api/app/judge.py:60-68`, corroborated by the toolchain table, the compile branches, the Dockerfile packages, and the Next-side allow-list).

**7 verdicts:** `accepted`, `wrong_answer`, `time_limit_exceeded`, `memory_limit_exceeded`, `runtime_error`, `compilation_error`, `presentation_error` (whitespace-only diff). Plus an orthogonal `infra_error` flag: sandbox failure is reported as `runtime_error` + `infra_error=true`, never blamed on the contestant. A problem with zero test cases can never produce a free AC.

| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /judge` | `X-Judge-Secret` via `hmac.compare_digest` | Synchronous judging |
| `POST /judge-async` | Same | Loads from DB, `pg_try_advisory_lock` dedupe, writes verdict back, returns 202 |
| `GET /health` | None | Reports db + `sandbox` mode |

`BoundedSemaphore` limits concurrency (default 4); returns 503 + `Retry-After` when saturated.

Isolation is selected by `JUDGE_SANDBOX_MODE` ∈ `{auto, docker, rlimit}`:

- `rlimit`: `resource.setrlimit` (`RLIMIT_CPU`/`AS`/`FSIZE`/`NPROC`/`CORE=0`) + wall timeout + `os.killpg(SIGKILL)`. `RLIMIT_AS` is skipped for java/go/javascript in favour of `-Xmx` / `GOMEMLIMIT` / `--max-old-space-size`.
- `docker`: fixed non-user-controlled argv with `--network none --read-only --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges --security-opt seccomp=/etc/koj/seccomp-koj.json --pids-limit --memory --cpus`. Fails closed if the daemon, seccomp profile, or toolchain is missing.

There is deliberately **no filesystem or network namespace** in rlimit mode. The trust model is a trusted single-tenant college deployment, not the public internet.

---

## Database

8 tables: `users`, `problems`, `contests`, `problem_test_cases`, `contest_problems`, `contest_registrations`, `submissions`, `notes`.

5 enums: `contest_status`, `problem_difficulty`, `problem_status`, `submission_status` (9 values), `user_role` (3 values).

`submissions.case_results` is jsonb, with 4 partial/composite indexes.

---

## Migration bookkeeping is broken

8 `.sql` files exist in `db/migrations/`, but `meta/_journal.json` registers only 4: `0000_init`, `0001_young_kylun`, `0002_invite_code_hash`, `0003_judge_hardening`.

Orphaned from Drizzle's bookkeeping: `0002_confused_boomerang`, `0003_vengeful_sumo`, `0004_steady_talisman`, `0005_setter_merge`. They are hand-written and idempotent (`IF NOT EXISTS`), and `0005` states it was "applied manually to Neon (no `__drizzle_migrations` bookkeeping)". Index prefixes are duplicated (`0002_*` ×2, `0003_*` ×2). **Which migrations are actually applied to the live DB is UNVERIFIED** (no DB access during the audit).

### Known schema drift

- `time_limit_ms` default is 1000 in `db/schema.ts:86` but 2000 in `0002_confused_boomerang.sql`.
- `users_email_unique` exists in that migration but `.unique()` is absent from `db/schema.ts:57`.
- `0004_steady_talisman.sql` creates 6 indexes absent from `db/schema.ts`.

---

## Realtime

SSE is genuinely implemented end-to-end in Next.js: `app/api/submissions/[id]/events/route.ts` (1s ticks, 55 max) and `app/api/contests/[id]/events/route.ts` (2s ticks, 150 max), both `text/event-stream`, consumed by `EventSource` in the submissions, rankings, and problem-detail pages.

Redis is OPTIONAL and read-side only: `lib/redis.ts` returns `null` unless both `REDIS_URL` and `REDIS_TOKEN` are set, and every call site falls back to Postgres. Two uses only: an 8s standings cache in `app/api/rankings/route.ts` and a 3s version cache in the contests SSE route.

**One link is dead:** the FastAPI→Redis verdict publish lives in `api/app/cache.py`, which is never imported by anything and whose `redis` dependency is not even in `api/requirements.txt`. The `verdict:{id}` key read by the submissions SSE route can never be written, so that branch always falls through to the DB poll. There is NO Redis queue and NO pub/sub fan-out anywhere.

---

## Tests — 107 cases, all hermetic

No network, DB, Docker, or filesystem side effects.

| Suite | Count | Runner |
|---|---|---|
| `lib/scoring.test.ts` | 13 | node:test |
| `app/api/contests/invite-code.test.ts` | 11 | node:test |
| `api/tests/test_judge_units.py` | 83 | pytest — normalizer, PE detection, CE/sandbox-unavailable responses, redaction, memory clamps, OOM heuristics, SIGXCPU, Java `Solution` detection, language table |

Run: `npm test` = `node --experimental-strip-types --test lib/*.test.ts 'app/api/**/*.test.ts' && cd api && python3 -m pytest -q`.

Honest flags: the Python leg invokes `python3`, which does not exist on stock Windows, so on this host only the two TS suites run. And with `node_modules` absent, none of this has been run in this working copy.

---

## Deployment

- Frontend → Vercel (`npm run build`). `.vercelignore` excludes only the root `/api/` — the leading slash is deliberate so `app/api/` is NOT excluded, and Vercel gets the Next app alone.
- Judge → Google Cloud Run or any container host built from `api/Dockerfile`.
- DB → Neon Postgres.
- Next reaches the judge server-side via `fetch(process.env.FASTAPI_URL)`.
- `next.config.ts` only sets Clerk `remotePatterns` plus security headers (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) — no rewrites, no proxy.
- No CI: no `.github/` directory, no workflow YAML, no `vercel.json`.

---

## Known gaps and contradictions

- `api/app/main.py:56-57` comments "Single uvicorn worker is intentional" while `api/Dockerfile:28` runs `--workers 4` — directly contradictory. With `JUDGE_MAX_CONCURRENT=4` per worker that is 16 concurrent judging slots per instance, not the 4 the Dockerfile header claims.
- `api/Dockerfile:1` says "python, c, c++, java"; the image installs all 7 toolchains.
- `api/Dockerfile` never copies `api/seccomp-koj.json`, yet docker mode requires `JUDGE_SECCOMP_PROFILE=/etc/koj/seccomp-koj.json` and fails closed without it. Provisioning is a manual step nobody documented.
- `api/app/cache.py` is fully dead code (see Realtime).
- The `notes` table plus its `Note`/`NewNote` types are dead — created by `0000_init.sql`, referenced nowhere.
- `ADMIN_CLERK_IDS` and `CRON_SECRET` are both consumed by code but absent from `.env.example`. `app/api/admin/submissions/recover/route.ts` exists to mark stale `pending`/`running` submissions terminal (admin auth OR `x-cron-secret`) but no scheduler invokes it.
- `app/api/judge/run/route.ts` rate-limits with an in-memory Map, so it resets per serverless instance and is not durable across instances.
- `app/api/admin/problems/import/route.ts` performs real outbound server-side requests to leetcode.com, codeforces.com, and atcoder.jp — real network egress from the Next server, which sits awkwardly against the hermetic-unit-test policy.
- `JUDGE_DOCKER_IMAGE_GO/RUST/NODE` are implemented but missing from `api/.env.example`, so an operator cannot see them.
- No TODO/FIXME/HACK markers anywhere in ts/tsx/py/sql. No commented-out code blocks of 4+ lines.

---

## Secrets — clean

Only `.env.example` and `api/.env.example` are tracked, both with empty values. No `.env*` on disk or in git. Credential-shape scan across all tracked files returns 3 hits, all documentation placeholders: `api/README.md:49`, `api/app/config.py:28`, `api/tests/conftest.py:15`.

---

## UNVERIFIED

1. Whether Clerk Organizations are enabled in the Clerk dashboard.
2. Which of the 8 migration files are actually applied to the live Neon DB.

---

## Suggested next work

- Reconcile the Drizzle journal with the 4 orphaned migrations and resolve the schema drift.
- Wire or delete `api/app/cache.py`.
- Fix the Dockerfile worker/language-count comments and document seccomp provisioning.
- Add a `pytest` invocation that works on Windows.
- Document `ADMIN_CLERK_IDS` / `CRON_SECRET` in `.env.example`.
- Add CI (there is none).
- Delete or use the `notes` table.
