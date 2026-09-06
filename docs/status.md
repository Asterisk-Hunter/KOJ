# Implementation Status — `feat/sprint1-backend` (as of 2026-09-06)

> Single source of truth for what is implemented vs planned on branch `feat/sprint1-backend`. Factual as of the current commit (`57d9425` "giga commit"). See also `docs/overview.md` for project context.

---

## Summary

Sprint 1 backend is implemented and verified locally. Next.js + Clerk + Neon (Drizzle) is authoritative. FastAPI judge is functional for Python. Redis/SSE realtime, contest CRUD, and role expansion are explicitly not implemented.

- `npx tsc --noEmit` — pass
- `npm run lint` — pass (no new errors)
- `npm run build` — pass
- FastAPI `POST /judge` — verified AC/WA/TLE/CE
- API smoke — problem/contest/ranking counts returned correctly
- `npm audit` — 1 high / 4 moderate unresolved; fixes require breaking Drizzle upgrades, deferred intentionally

---

## Implemented routes / pages

All routes are functional against live Neon data (no mocks). Auth is via Clerk `proxy.ts`; public vs protected as documented in `AGENTS.md`.

| Route | File | Access |
|---|---|---|
| `/` landing | `app/page.tsx` | Public |
| `/dashboard` | `app/dashboard/page.tsx` | Protected (requires sign-in); does **not** auto-redirect admins to `/admin` |
| `/problems` archive | `app/problems/page.tsx` | Public; lists only `published` problems with search/difficulty/category filters |
| `/problems/[id]` detail | `app/problems/[id]/page.tsx` | Public; code editor + Run (samples) / Submit (all cases) flows |
| `/contests` list | `app/contests/page.tsx` | Public; status derived from `contests.status` + time window |
| `/contests/[id]` detail | `app/contests/[id]/page.tsx` | Public; register CTA, problem list for live contests |
| `/contests/[id]/arena` | `app/contests/[id]/arena/page.tsx` | Protected + requires registration; contest-scoped problem view |
| `/rankings` | `app/rankings/page.tsx` | Public; contest-scoped standings (requires `?contestId=`) |
| `/submissions/[id]` detail | `app/submissions/[id]/page.tsx` | Protected; owner-only fetch via `GET /api/submissions/[id]` |
| `/admin` | `app/admin/page.tsx` | Protected; calls `GET /api/admin/summary` + `POST /api/admin/problems`; returns 403 UI for non-admins |
| `/sign-in/[[...sign-in]]` | `app/sign-in/[[...sign-in]]/page.tsx` | Clerk catch-all |
| `/sign-up/[[...sign-up]]/page.tsx` | `app/sign-up/[[...sign-up]]/page.tsx` | Clerk catch-all |

All pages reuse the neon-terminal theme (`app/globals.css`, `Navigation.tsx`, `StatCard.tsx`).

---

## Implemented APIs

### Next.js Route Handlers (`app/api/*`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | `select 1` DB check; returns `{status, db, latencyMs}` |
| `GET` | `/api/problems` | Public (user-aware) | Lists `published` problems; `?q=&difficulty=&category=` filters; computes acceptance from non-pending submissions |
| `GET` | `/api/problems/[id]` | Public | Single problem + sample cases + acceptance; includes `userStatus` if signed in |
| `GET` | `/api/contests` | Public (user-aware) | All contests ordered by `startsAt`; maps `dbStatus` → UI status; includes `registered` flag per user |
| `GET` | `/api/contests/[id]` | Public (user-aware) | Contest by slug or numeric id; returns contest + ordered problems + registration flag |
| `POST` | `/api/contests/[id]/register` | `auth()` required | Registers signed-in user; validates contest exists and is not finished |
| `GET` | `/api/rankings?contestId=` | Public | Computes standings for `live|ended|archived` contests; ICPC penalty: `minutes_to_first_AC + 20*wrong_before_AC` |
| `GET` | `/api/admin/summary` | `auth()` + `org:admin` or `users.role=admin` | Counts for users/problems/contests/submissions + 5 recent rows each |
| `POST` | `/api/admin/problems` | `auth()` + `org:admin` or `users.role=admin` | Creates problem (`draft` by default); validates title/statement/formats/tags/limits |
| `POST` | `/api/submissions` | `auth()` required | Validates `problemId/language/code/mode`; enforces contest-vs-practice rules; inserts `pending→running`, calls FastAPI `/judge`, persists verdict |
| `GET` | `/api/submissions?problemId=&contestId=` | `auth()` required | Lists caller's submissions for a problem (optionally contest-scoped) |
| `GET` | `/api/submissions/[id]` | `auth()` required | Returns one submission if `userId` matches; 404 otherwise |

All handlers: `runtime="nodejs"`, `dynamic="force-dynamic"`, validation returns 400/401/403/404 as appropriate. `POST /api/submissions` sets `maxDuration=60`.

### FastAPI (`api/app/main.py` + `api/app/judge.py`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Liveness + DB check; mirrors Next `/api/health` shape but for FastAPI |
| `POST` | `/judge` | `X-Judge-Secret` | Internal only; validates `language=="python"` (422 otherwise); compiles via `py_compile`, executes per case with `subprocess.run`, compares outputs |

CORS: `allow_origins=[http://localhost:3000, FASTAPI_URL, FRONTEND_URL]` — never `*`. `JUDGE_INTERNAL_SECRET` must match on both sides.

---

## Database — actual schema (Neon authoritative)

**Provider:** Neon Postgres via `drizzle-orm@0.36.4` + `pg@8.13.1`. Schema source: `db/schema.ts`. Migrations in `db/migrations/`.

### Enums

```ts
contestStatus: "draft" | "live" | "ended" | "archived"
problemDifficulty: "easy" | "medium" | "hard"
problemStatus: "draft" | "contest_active" | "published"
submissionStatus: "pending" | "running" | "accepted" | "wrong_answer" | "time_limit_exceeded" | "memory_limit_exceeded" | "runtime_error" | "compilation_error"
userRole: "contestant" | "problem_setter" | "admin"
```

No `contest_setter` value exists yet — see Role gap below.

### Tables

| Table | PK | Notable columns / constraints |
|---|---|---|
| `users` | `clerk_id` (text) | `username` unique, `email`, `role` default `contestant`, `created_at`, `updated_at` |
| `problems` | `id` serial | `author_id→users.clerkId`, `title`, `statement`, `input_format`, `output_format`, `constraints`, `explanation`, `difficulty`, `tags text[]`, `time_limit_ms` default 1000, `memory_limit_mb` default 256, `status` default `draft` |
| `problem_test_cases` | `id` serial | `problem_id→problems.id CASCADE`, `input`, `expected_output`, `is_sample` default false, `position` |
| `contests` | `id` serial | `created_by→users.clerkId`, `slug` unique, `title`, `description`, `starts_at`, `ends_at`, `status` default `draft` |
| `contest_problems` | `(contest_id, problem_id)` composite | `contest_id→contests.id CASCADE`, `problem_id→problems.id CASCADE`, `position` |
| `contest_registrations` | `(contest_id, user_id)` composite | `contest_id→contests.id CASCADE`, `user_id→users.clerkId CASCADE`, `registered_at` |
| `submissions` | `id` serial | `user_id→users.clerkId`, `problem_id→problems.id`, `contest_id→contests.id` nullable, `language` (currently `python` only), `code`, `status` default `pending`, `execution_time_ms`, `memory_used_mb`, `passed_tests`, `total_tests`, `error_message`, `submitted_at`, `started_at`, `completed_at` |
| `notes` | `id` serial | Legacy starter table; not used by KOJ features |

### Seeded data (via `scripts/seed.ts`)

Idempotent upsert by title/slug. Requires `SEED_USER_CLERK_ID` + `SEED_USER_EMAIL` (real Clerk user); safe to re-run.

- **8 problems** — all `published`, 4 test cases each (2 sample + 2 hidden) = **32 test cases**
- **4 contests** — linked via `contest_problems` = **16 links**
- **Zero fake submissions / registrations** — those are created only by real user actions

Run: `SEED_USER_CLERK_ID=user_xxx SEED_USER_EMAIL=you@example.com npm run db:seed` (Node 22+, `dotenv` loads `.env.local`).

---

## Submission pipeline

```
Browser (problem detail / arena)
  → POST /api/submissions {problemId, contestId?, language, code, mode:"run"|"submit"}
    → auth() + validation (ids, 100KB limit, python-only, mode)
    → load problem + contest/registration checks
      - contest mode: contest.status=="live" && registered && problem in contest
      - practice mode: problem.status=="published"
    → ensure users row (lazy create from Clerk)
    → load test cases (run=sample only, submit=all) ordered by position
    → INSERT submissions (pending) → UPDATE running + startedAt
    → fetch(`${FASTAPI_URL}/judge`, {language, code, cases:[{stdin, expected_stdout}], time_limit_ms, memory_mb}, {X-Judge-Secret, AbortSignal 55s})
      → FastAPI POST /judge
        → verify X-Judge-Secret (401) / language check (422)
        → py_compile.compile (compilation_error on PyCompileError/SyntaxError)
        → per-case: subprocess.run([sys.executable, tmp.py], input=stdin, timeout=wall_timeout=(time_limit_ms/1000+2s), preexec_fn=setrlimit(RLIMIT_AS, memory_mb) on POSIX)
          - stdout/stderr truncated 4KB per case
          - heuristic: MemoryError in stderr → memory_limit_exceeded
          - elapsed > time_limit_ms → time_limit_exceeded
          - output compare: whitespace-normalized line-by-line (rstrip per line, drop trailing empty lines) → accepted / wrong_answer
        → aggregate: first non-accepted verdict, max runtime, passed/total counts, error_message truncated 2KB
      ← {status, passed_tests, total_tests, execution_time_ms, error_message, cases[]}
    → UPDATE submissions {status, passedTests, totalTests, executionTimeMs, errorMessage, completedAt}
  ← {id, status, passedTests, totalTests, executionTimeMs, errorMessage}  or  {error} 502 if judge unavailable
```

Timeouts: judge wall `time_limit_ms + 2000ms`, Next abort 55s, Vercel `maxDuration=60`. Resource limits: `RLIMIT_AS` on POSIX (skipped on Windows dev). Only `python` is supported end-to-end (CoW).

---

## Authorization

- **Clerk Organizations: enabled.** Previous docs stating "organizations DISABLED" were outdated.
- **DB roles (`user_role`)**: `contestant` | `problem_setter` | `admin` — source `db/schema.ts`.
- **Admin API gate** (`/api/admin/*`): `auth().has({role:"org:admin"})` OR `users.role=="admin"` in Neon. Returns 401 if not signed in, 403 if not admin. `proxy.ts` public routes allow `/api/*` through but handlers enforce authorization.
- **Proxy** (`proxy.ts`): public = `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/problems(.*)`, `/contests(.*)`, `/rankings(.*)`, `/submissions(.*)`, `/api(.*)`; everything else (e.g. `/dashboard`, `/admin`) requires auth.
- **Dashboard**: does **not** auto-redirect admins to `/admin`. Both pages exist separately; admin navigates manually.
- **`/admin` UI**: fetches `/api/admin/summary`; renders 403 message (`not authorized — admin role required`) if forbidden; otherwise shows live counts + create-problem form.

---

## Explicit role gap — `contest_setter` does not exist

- **Current state**: there is **no** `contest_setter` role in the DB enum or Clerk custom roles, and **no** contest creation endpoint or UI. `POST /api/admin/problems` exists, but there is no `POST /api/contests` or `PATCH /contests/[id]` for creating/editing/publishing contests.
- **Planned**: contest creation is admin-only for now.
- **Recommended next decision** (requires explicit choice before implementation):
  1. **Option A — admin-only contests**: let `org:admin` (Clerk) / `admin` (DB) create contests via a new `POST /api/admin/contests` (or `POST /api/contests` gated to admin). No schema change needed. Fastest path.
  2. **Option B — dedicated setter role**: add `contest_setter` to Clerk custom roles **and** to `userRole` enum (`db/schema.ts` + migration), then gate contest create/edit/publish APIs/UI on `contest_setter` OR `admin`. Requires enum migration + Clerk dashboard role config + UI role checks.
- Until a decision is made, contest lifecycle (`draft→live→ended→archived`) and seed data remain the only contest mutation path.

---

## Realtime plan (not implemented)

- **Intended**: Redis cache + pub/sub → Next.js SSE (`/api/contests/[id]/events` or similar) for live leaderboard and submission status. Invalidation on new `accepted` verdict.
- **Current**: no Redis client, no SSE route, no pub/sub, no cache. Leaderboard and submission status are fetched on demand (poll/refresh). Architecture docs and `hard-problems.md` that referenced Supabase Realtime describe the **planned** design, not current behavior.
- **Why deferred**: college-scale polling is acceptable for Sprint 1; realtime is Sprint 2 work.

---

## Verification evidence

Run on `feat/sprint1-backend` at `57d9425` (local dev, Node 22+, Python 3.11+):

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | Pass |
| Lint | `npm run lint` | Pass (no new errors) |
| Build | `npm run build` | Pass |
| FastAPI judge — AC | `POST /judge` with correct Python solution | `accepted`, `passed_tests==total_tests` |
| FastAPI judge — WA | correct program, wrong expected output | `wrong_answer` |
| FastAPI judge — TLE | `while True: pass` with `time_limit_ms=1000` | `time_limit_exceeded` (wall timeout) |
| FastAPI judge — CE | syntax error (`def foo(`) | `compilation_error` with truncated `PyCompileError` |
| Next APIs — smoke | `GET /api/problems`, `GET /api/contests`, `GET /api/rankings?contestId=` | Returned seeded counts: 8 problems, 4 contests, standings computed |
| Auth — admin gate | `GET /api/admin/summary` as non-admin | 403 `forbidden` |
| Auth — submissions | `POST /api/submissions` without session | 401 `unauthorized` |
| Audit | `npm audit` | 1 high / 4 moderate unresolved |

**`npm audit` note**: `npm audit fix` requires breaking upgrades of `drizzle-orm`/`drizzle-kit` major versions; deferred to avoid schema churn mid-sprint. Not ignored — tracked as remaining work.

---

## Remaining work

Explicitly not implemented on this branch:

1. **Redis + SSE realtime** — add Redis client, leaderboard cache, pub/sub, SSE route, client subscription; update `architecture.md` when done
2. **Contest CRUD** — `POST/PATCH /api/contests` (or `/api/admin/contests`), publish/visibility transitions, UI forms; blocked on role decision above
3. **Role decision** — choose Option A (admin-only) or Option B (add `contest_setter`); then migrate `userRole` + configure Clerk custom roles if B
4. **Real submissions with auth session** — current pipeline works but production needs `FASTAPI_URL` + `JUDGE_INTERNAL_SECRET` set on both sides; wire through Vercel env
5. **Production FastAPI deployment** — host FastAPI separately (Render/Railway/Fly); set `FRONTEND_URL` for CORS; replace localhost fallback
6. **Webhook syncing** — Clerk webhooks to sync `users` and org memberships into Neon (lazy-create covers Sprint 1 but not org role changes)
7. **Tests** — no test runner installed (`package.json` has no Jest/Vitest/Playwright); `docs/testing.md` describes intended strategy but no tests exist yet; add unit (judge), integration (submit→judge→DB), and E2E (Clerk) suites
8. **Language expansion** — C++/Java support in judge (currently `python` only, validated at both layers)
9. **Audit fixes** — resolve 1 high / 4 moderate via coordinated Drizzle upgrade

---

## Links

- Overview: `docs/overview.md`
- Architecture: `docs/architecture.md`
- Features (implemented vs planned): `docs/features.md`
- Stack: `docs/stack.md`
- Testing: `docs/testing.md`
- Deployment (incl. Vercel + FastAPI): `docs/deployment.md`
- Project management (sprint progress): `docs/project-management.md`
- Glossary: `docs/glossary.md`
