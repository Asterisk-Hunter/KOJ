# Architecture

> Status note: diagram reflects current `feat/sprint1-backend` plus planned realtime. For authoritative status see `docs/status.md`.

## System diagram (current + planned)

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 16 + React)             │
│  Landing │ Dashboard │ Problems │ Contests/Arena │ Rankings  │
│  Submissions/[id] │ Admin (problem create + summary)         │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (fetch) + Clerk auth
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│              Next.js Route Handlers (`app/api/*`)            │
│  POST /submissions │ GET /problems │ GET /contests │ etc.   │
│  GET /rankings │ GET/POST /admin/* │ GET /health             │
└──────────────────────────┬──────────────────────────────────┘
                           │ SQL (Drizzle) + HTTP (FastAPI)
         ┌─────────────────┼──────────────────┐
         ▼                 ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Auth (Clerk)│   │ Problem /    │   │Contest +     │
│  Organizations│  │ Submission   │   │Rankings API  │
│  proxy.ts    │   │ API (Next)   │   │ (Next)       │
└──────────────┘   └──────┬───────┘   └──────────────┘
                          │  POST /judge  (X-Judge-Secret)
                          ▼
                   ┌──────────────────┐
                   │  Judge Service   │
                   │  FastAPI (Python)│
                   │  py_compile +    │
                   │  subprocess.run  │
                   │  + setrlimit     │
                   └────────┬─────────┘
                            │ SQL (psycopg)
                            ▼
                     ┌──────────────────┐
                     │  Postgres (Neon) │
                     │  users           │
                     │  problems        │
                     │  problem_test_cases│
                     │  contests        │
                     │  contest_problems│
                     │  contest_registrations│
                     │  submissions     │
                     └──────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Planned: Redis (Caching & Pub/Sub) → Next.js SSE           │
│  Leaderboard cache (invalidate on AC) · submission events   │
│  Status: NOT IMPLEMENTED — see docs/status.md               │
└─────────────────────────────────────────────────────────────┘
```

Previous diagram referencing Supabase Postgres/Realtime is superseded — Neon is authoritative and realtime is Redis→SSE (planned).

---

## Architectural styles

| Style | Where | Why | Concrete example | Status |
|---|---|---|---|---|
| **Layered** | Entire system | Separation of concerns | Next UI → Route Handlers → Drizzle/Neon; Next → FastAPI → Neon | Implemented |
| **Pipe-and-Filter** | Judge module | Single-responsibility stages | Read code → py_compile → Execute per test → Compare (normalized) → Aggregate verdict | Implemented (`api/app/judge.py`) |
| **MVC** | Frontend | Model (problem/contest state), View (React), Controller (page handlers + Route Handlers) | Problem detail loads from `GET /api/problems/[id]`, renders statement, handles Run/Submit | Implemented |
| **Event-Driven / Broker** | Realtime leaderboard | DB event triggers broadcast; UI subscribes | Planned: submission verdict → Redis pub/sub → SSE → live leaderboard | **Planned, not implemented** |
| **Master-Slave** | Judge execution | Master (Next handler) dispatches to slave (FastAPI subprocess) | `POST /api/submissions` spawns judge via HTTP, collects verdict | Implemented (HTTP, not in-process thread pool) |

---

## Module decomposition

### Module 1: Judge Module (Python) — [Implemented]

**Responsibility:** Execute untrusted Python code safely, return verdicts.

**Entry:** `POST /judge` (`api/app/main.py` → `api/app/judge.py:execute_judge`)

```python
execute_judge(req: JudgeRequest) -> JudgeResponse  # language, code, cases, time_limit_ms, memory_mb
```

**Isolation:**
- Syntax check via `py_compile.compile(doraise=True)` — CE on `PyCompileError`/`SyntaxError`
- Per-case `subprocess.run([sys.executable, tmp.py], input=stdin, timeout=wall_timeout, preexec_fn=setrlimit(RLIMIT_AS, memory_mb*1024*1024))`
- Wall timeout = `time_limit_ms/1000 + 2.0` s; `RLIMIT_AS` skipped on Windows (no `resource` module)
- Stdout/stderr truncated 4KB per case; error_message truncated 2KB

**Honest limitations:** No fork-bomb protection, no seccomp, timing variance under load — documented in `docs/hard-problems.md` and `docs/status.md`.

---

### Module 2: Problem API (Next) — [Implemented]

**Responsibility:** List/get problems, compute acceptance/status.

**Routes:**
```
GET  /api/problems          List published problems (?q=&difficulty=&category=)
GET  /api/problems/[id]     Fetch problem + sample cases + stats
POST /api/admin/problems    Create problem (admin only) — Module 6
```

**State machine (intended):**
```
Draft ──(problem setter submits to contest)──> Contest-Active ──(contest ends)──> Published
```
Seed creates 8 `published` problems directly; transitions via contest lifecycle are future work.

---

### Module 3: Submission API (Next + FastAPI) — [Implemented]

**Responsibility:** Accept submissions, call judge, persist verdicts.

**Routes:**
```
POST /api/submissions              Submit (mode run|submit)
GET  /api/submissions?problemId=&contestId=  List caller's submissions
GET  /api/submissions/[id]         Fetch one (owner-only)
POST /judge (FastAPI)              Internal judge
```

**Lifecycle (actual):**
```
Pending (INSERT) ──> Running (UPDATE startedAt) ──> Verdict via FastAPI ──> persisted (completedAt)
```
No background queue — synchronous HTTP with 55s abort, `maxDuration=60`. Background thread pool / Redis queue is future work.

---

### Module 4: Contest Engine (Next) — [Partially implemented]

**Responsibility:** List/get contests, register, enforce submission windows.

**Routes:**
```
GET  /api/contests              List all contests (with problem/registration counts, registered flag)
GET  /api/contests/[id]         Fetch contest by slug|id + problems
POST /api/contests/[id]/register Register (auth required)
```

**State machine (DB enum):**
```
draft ──> live ──> ended ──> archived
```
UI status derived from `status` + `startsAt/endsAt` (`deriveUiStatus`). No create/start/end/publish endpoints yet — requires role decision (see `docs/status.md`). Seed provides 4 contests.

---

### Module 5: Leaderboard (Next) — [Implemented, on-demand]

**Responsibility:** Compute contest rankings.

**Route:** `GET /api/rankings?contestId=` — requires `live|ended|archived`, sorts by `solved DESC, penalty ASC`.

**Algorithm:**
```
For each contestant:
  solved_count = problems with first AC
  penalty = sum over solved problems:
    minutes(first_AC - contest.startsAt) + 20 * wrong_before_first_AC
Sort by (solved DESC, penalty ASC)
```

**Live updates:** computed per request from `submissions`; Redis cache invalidation + SSE is planned, not implemented.

---

### Module 6: Admin (Next) — [Implemented]

**Responsibility:** Admin-only overview and problem creation.

**Routes:**
```
GET  /api/admin/summary     Counts + recent problems/users (admin: org:admin or users.role=admin)
POST /api/admin/problems    Create problem (same gate)
```

UI: `app/admin/page.tsx` — fetches summary, shows 403 for non-admins, form to create problems. No contest management or user role editing yet.

---

### Module 7: Frontend (Next.js + React) — [Implemented]

**Pages (see `docs/status.md` for access):**
- `app/page.tsx` — landing
- `app/dashboard/page.tsx` — dashboard (no auto-redirect)
- `app/problems/page.tsx` / `app/problems/[id]/page.tsx` — archive + detail with Run/Submit
- `app/contests/page.tsx` / `app/contests/[id]/page.tsx` / `app/contests/[id]/arena/page.tsx` — list/detail/arena
- `app/rankings/page.tsx` — rankings
- `app/submissions/[id]/page.tsx` — submission detail
- `app/admin/page.tsx` — admin dashboard
- `app/sign-in/[[...sign-in]]/page.tsx` / `app/sign-up/[[...sign-up]]/page.tsx` — Clerk catch-alls

---

## DB reference (authoritative)

Neon Postgres via Drizzle — `db/schema.ts`. Enums: `contest_status`, `problem_difficulty`, `problem_status`, `submission_status`, `user_role` (`contestant|problem_setter|admin`). Tables: `users`, `problems`, `problem_test_cases`, `contests`, `contest_problems`, `contest_registrations`, `submissions` (+ legacy `notes`). Seeded: 8 problems, 32 cases, 4 contests, 16 links, zero fake submissions/registrations. See `docs/status.md` for full DDL summary.
