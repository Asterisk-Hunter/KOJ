# KOJ context — 30-second orientation

Land here, then fan out. The working rules are in `AGENTS.md`; the honest
code-vs-claims snapshot is in `docs/status.md`. This file only orients and routes.

## 1. What this is

KOJ (Kottayam Online Judge): self-hosted contest-hosting platform + problem archive.
Next.js 16 frontend, a separate Python (FastAPI) judge service, Neon Postgres, Clerk auth.
Single-tenant, trusted-college trust model — **not hardened for the public internet**.
Grew out of a college course project; now personally owned as `Asterisk-Hunter/KOJ`.

## 2. Read in this order

1. `AGENTS.md` — working contract; wins over everything, including this file.
2. `docs/status.md` — honest snapshot: what is real vs claimed, with code refs.
3. `docs/architecture.md` — how the pieces fit (Next route → FastAPI judge).
4. `docs/features.md` — what is implemented vs planned.
5. `docs/stack.md` — versions, services, env wiring.
6. `docs/testing.md` — testing strategy behind the `npm test` + pytest runners.

## 3. The 8 facts that will bite you first

1. **Next 16, not 14.** Auth proxy is `proxy.ts` at root — creating `middleware.ts` fails the build. `createRouteMatcher` lives on at `proxy.ts:1` (Clerk-deprecated, still live).
2. **Auth = Clerk identity + Neon role, not Clerk orgs.** No Clerk Organizations API call exists anywhere. Roles are exactly `contestant | setter | admin` (`db/schema.ts:47`). The admin gate (`app/api/admin/authz.ts`) checks comma-separated `ADMIN_CLERK_IDS` first, then `users.role` — and `ADMIN_CLERK_IDS` is absent from `.env.example`.
3. **`/api(.*)` is public at the proxy layer** (`proxy.ts:11`), so every handler does its own auth — hence 16 admin handlers each calling a `requireX` gate.
4. **The judge is a separate process.** Next never runs Python; it `fetch()`es `FASTAPI_URL`. Run `cd api && uvicorn app.main:app --reload --port 8000` beside `npm run dev`. `api/Dockerfile` is the Cloud Run artifact; `.vercelignore` excludes root `/api/` (leading slash deliberate — `app/api/` is NOT excluded).
5. **`proxy.ts` marks `/problems(.*)` and `/contests(.*)` public**, incidentally exposing `/problems/create` (client-side `canAuthor` check via `/api/auth/me` only) and `/contests/[id]/arena`.
6. **Never write `.env*`.** Gitignored; `.env.example` / `api/.env.example` are the only tracked env files, both with empty values.
7. **Migration bookkeeping is broken.** Two `0002_*` + two `0003_*` in `db/migrations/`; `meta/_journal.json` registers only 4 of the 8 SQL files. Which migrations ran on live Neon is UNVERIFIED — see `docs/status.md`.
8. **Fresh clone has no `node_modules`.** Run `npm install` first. `npm test`'s Python leg calls `python3`, absent on stock Windows — there only the 2 TS suites run.

Dispatch hazard: if the 5s judge-dispatch timeout fires, the catch writes terminal `runtime_error` and the judge's guarded verdict UPDATE then discards the real verdict — see `docs/status.md` and "Open questions for the owner" in `docs/KOJ_ Plan to Make It a Solid Project.md` before touching dispatch.

## 4. Layout

```text
├── proxy.ts                  # Clerk auth proxy (NOT middleware.ts — Next 16)
├── app/                      # App Router
│   ├── api/                  # 29 route handlers: problems, contests, submissions, rankings, admin/*, webhooks/clerk
│   │   ├── body-guard.ts     # bounded JSON bodies (413 cap)
│   │   ├── contests/lifecycle.ts + invite-code.ts   # expiry settling, scrypt invite codes
│   │   └── submissions/recovery.ts  # marks stale pending/running terminal
│   ├── components/           # Navigation, StatCard, GlitchingTerminal, …
│   ├── sign-in/[[...sign-in]]/ + sign-up/[[...sign-up]]/  # Clerk catch-alls — do NOT flatten
│   └── problems/ contests/ dashboard/ admin/ rankings/ submissions/  # pages
├── api/app/                  # separate FastAPI judge service (own venv, own deploy)
│   ├── main.py               # /judge, /judge-async, /health endpoints
│   ├── judge.py              # judging + docker/rlimit sandbox backends
│   ├── config.py             # env settings (sandbox mode, images, limits)
│   └── db.py                 # psycopg pool (cache.py is DEAD — nothing imports it)
├── db/                       # schema.ts (Drizzle) · index.ts (pool) · migrations/ (8 SQL, journal tracks 4)
├── lib/                      # scoring.ts (ICPC logic + tests) · redis.ts (optional; null without REDIS_URL+TOKEN)
├── scripts/seed.ts           # seed via `npm run db:seed`
└── docs/                     # context.md (this) · status.md (truth) · architecture/features/stack/testing/deployment
```

## 5. Commands

| Command | Notes |
|---|---|
| `npm run dev` | Next.js on :3000; run the judge alongside: `cd api && uvicorn app.main:app --reload --port 8000` |
| `npm run build` | Production build — must pass before push |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck (no `tsc` script exists — invoke directly) |
| `npm test` | 2 TS suites + `python3 -m pytest -q` in `api/`; `python3` missing on stock Windows |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle workflow (but the journal is broken — see §3.7) |
| `npm run db:seed` | Runs `scripts/seed.ts` (8 published problems + 4 contests) |

Hosting is three deployables: Next + `app/api/*` → Vercel (`npm run build`); FastAPI judge → a container host from `api/Dockerfile`; DB → Neon. Root `/api/` stays off Vercel via `.vercelignore` (leading slash deliberate); Next reaches the judge via `fetch(process.env.FASTAPI_URL)` (`app/api/submissions/route.ts:285`, `app/api/judge/run/route.ts:154`).

## 6. Data model

8 tables in `db/schema.ts`: `users`, `problems`, `contests`, `problem_test_cases`,
`contest_problems`, `contest_registrations`, `submissions`, `notes`.
5 enums: `contest_status`, `problem_difficulty`, `problem_status`,
`submission_status` (9 values), `user_role` (3 values).
Two legacy artifacts: `notes` is dead (created by `0000_init.sql`, referenced nowhere);
`contests.invite_code` is legacy plaintext kept read-only — the live field is
`invite_code_hash` (scrypt, `db/schema.ts:108-111`). `submissions.case_results` is jsonb
with 4 partial/composite indexes. `judge_infra_error` is a flag plus a partial index
(`submissions_infra_error_idx`) so infra failures stay **findable** — it does not trigger
any automatic retry. Judge-side infra failures persist as `pending` + the flag
(`api/app/main.py:478`); the stale-running sweep (`app/api/submissions/recovery.ts`) then
marks anything still `pending`/`running` after 10 min terminal as `runtime_error`.

## 7. Submission lifecycle

`POST /api/submissions` → validate → 30s per-problem cooldown under
`pg_advisory_xact_lock` (`app/api/submissions/route.ts:239`) → insert `pending`,
flip to `running` → fire-and-forget `POST {FASTAPI_URL}/judge-async` (5s timeout)
→ 202 returned immediately. The judge then judges synchronously inside its own
request, writes the verdict back to Postgres, and the browser polls
`GET /api/submissions/[id]/events` (SSE, 1s ticks, 55 max —
`app/api/submissions/[id]/events/route.ts:13-14`). Judge unreachable → row lands on
`runtime_error` with "judge unavailable" (502). `judge_infra_error` exists so sandbox
failures are never blamed on the contestant.

## 8. Judge

7 languages (`api/app/judge.py:60-68`): python, c, c++, java, go, rust, javascript.
7 verdicts: accepted, wrong_answer, time_limit_exceeded, memory_limit_exceeded,
runtime_error, compilation_error, presentation_error (whitespace-only diff) —
plus an orthogonal `infra_error` flag. `JUDGE_SANDBOX_MODE` ∈ `{auto, docker, rlimit}`
(`api/app/config.py:112`): `rlimit` enforces `setrlimit` CPU/AS/FSIZE/NPROC/CORE caps +
wall timeout + `killpg`; `docker` enforces `--network none --read-only --user
65534:65534 --cap-drop ALL --security-opt no-new-privileges` + seccomp + pids/memory/cpu
limits. `rlimit` mode has no filesystem or network namespace — trusted-college only.
`BoundedSemaphore` (`api/app/main.py:58`) → 503 + `Retry-After` when saturated.

## 9. Where the truth is

When code and a doc disagree, the code wins. The three known doc-vs-code
contradictions live in `docs/status.md` under "Known gaps" — worst two:
`api/app/main.py:56-57` comments "single worker intentional" while
`api/Dockerfile:28` runs `--workers 4`; `api/Dockerfile:1` claims 4 languages
while the image installs all 7 toolchains.

## 10. Current state

107 hermetic unit tests: 13 `lib/scoring.test.ts` + 11
`app/api/contests/invite-code.test.ts` + 83 `api/tests/test_judge_units.py`
(no network, DB, Docker, or filesystem side effects). No CI, no `.github/`.
Deploy: Vercel (frontend) + Cloud Run (judge, from `api/Dockerfile`) + Neon (DB).
No build/lint/test has been run in this checkout (`node_modules` absent).
For the honest gap list — dead `api/app/cache.py`, seccomp provisioning, schema
drift, in-memory rate limits — read `docs/status.md`, not this file.
