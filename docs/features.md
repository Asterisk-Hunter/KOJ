# Features

> Status as of `feat/sprint1-backend` — see `docs/status.md` for authoritative counts and verification. Items marked **[Implemented]** are live against Neon; **[Planned]** are not yet built.

## MVP features

### Authentication & Authorization — [Implemented]
- Clerk Organizations enabled; `proxy.ts` gates `/dashboard` + `/admin` (public: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/problems(.*)`, `/contests(.*)`, `/rankings(.*)`, `/submissions(.*)`, `/api(.*)`)
- DB roles: `contestant` | `problem_setter` | `admin` (`user_role` enum). `org:admin` (Clerk) accepted for admin APIs (`/api/admin/*`); DB `admin` also accepted. 403 for unauthorized.
- Dashboard does not auto-redirect admins — `/admin` is a separate page.
- **Gap:** no `contest_setter` role; contest creation is admin-only and not yet exposed as an API/UI. See `docs/status.md` for the recommended next decision (add `contest_setter` or keep admin-only).

### Problem Authoring System — [Implemented]
- **Problem creation:** `POST /api/admin/problems` (admin only) — title, statement (Markdown), input/output formats, constraints, difficulty `easy|medium|hard`, tags, time/memory limits. UI form in `/admin`.
- **Test case management:** stored in `problem_test_cases` (`input`, `expected_output`, `is_sample`, `position`); samples shown to contestants, hidden cases used during judging
- **Time and memory limits:** configurable per-problem, defaults `1000ms` / `256MB`
- **Problem status:** `draft` → `contest_active` → `published` (`problem_status` enum). Public archive (`GET /api/problems`) lists only `published`; seed has 8 published problems.

### Contest Engine — [Partially implemented]
- **Contest listing/detail:** `GET /api/contests`, `GET /api/contests/[id]` (by slug or numeric id) — implemented, derives UI status from `contests.status` + time window
- **Registration:** `POST /api/contests/[id]/register` — implemented, requires sign-in and live contest
- **Visibility rules:** before start / during / after derived per contest; enforcement in `POST /api/submissions` (live + registered + problem in contest)
- **Timed enforcement:** submissions rejected if contest not `live` — implemented
- **[Planned] Contest creation / editing / publishing:** no `POST /api/contests` or `PATCH /contests/[id]/start|end` yet; contests come from seed (4 contests, 16 links) and direct DB. Requires role decision above.

### Code Submission & Judging — [Implemented, Python only]
- **Submission UI:** `app/problems/[id]/page.tsx` and `app/contests/[id]/arena/page.tsx` — language selector (python only), code editor, Run (samples) vs Submit (all cases)
- **Submission flow:** `POST /api/submissions` validates auth/ids/code/mode → inserts `pending→running` → calls FastAPI `POST /judge` → persists verdict to Neon → returns result (see `docs/status.md` pipeline)
- **Judge module:** `api/app/judge.py` — `py_compile` check, `subprocess.run` per case with `RLIMIT_AS` (POSIX) + wall timeout `time_limit_ms+2s`, whitespace-normalized comparison, verdicts `AC/WA/TLE/MLE/RE/CE`
- **Verdict types:** `accepted`, `wrong_answer`, `time_limit_exceeded`, `memory_limit_exceeded`, `runtime_error`, `compilation_error` — mapped to `submission_status`
- **Multiple submissions:** all stored; `GET /api/submissions?problemId=&contestId=` lists caller's history

### Real-Time Submission Status — [Planned]
- Intended: Redis pub/sub → Next.js SSE for live `Pending → Running → Verdict` updates
- Current: synchronous judge call (55s abort, `maxDuration=60`); status transitions `pending→running→final` persisted before response. No WebSocket/Realtime.
- Previous wording referencing Supabase Realtime subscriptions is obsolete and removed.

### Leaderboard — [Implemented, on-demand]
- **Ranking:** `GET /api/rankings?contestId=` — ICPC style: `solved_count DESC, penalty ASC` where `penalty = minutes_to_first_AC + 20*wrong_before_AC`
- **Live updates:** not yet realtime — computed from `submissions` on each request; Redis cache + SSE is planned
- **Post-contest:** standings available for `live|ended|archived` contests; no freeze distinction yet

### Problem Archive — [Implemented]
- Published problems remain available 24/7 for practice via `GET /api/problems` and `GET /api/problems/[id]`
- Practice submissions (`contestId=null`) allowed only for `published` problems and judged identically
- Submission history visible via `GET /api/submissions`

### Submission History — [Implemented]
- `GET /api/submissions` and `GET /api/submissions/[id]` (owner-only); UI at `/submissions/[id]`

---

## Non-Functional Requirements

| Requirement | Target | Current status |
|---|---|---|
| Verdict latency | ≤10s from submission to verdict | Judge wall timeout `time_limit_ms+2s`, Next abort 55s; typical Python cases <1s (verified AC/WA path) |
| Leaderboard update latency | ≤5s from AC to rank change | On-demand today (no cache); Redis/SSE planned to meet target |
| Concurrent submissions | 30 simultaneous without timeout | Not stress-tested yet; `maxDuration=60` and single FastAPI worker currently |
| Judge accuracy | 100% verdicts match manual | Verified AC/WA/TLE/CE via `POST /judge` smoke tests |
| Submission throughput | 60/min sustained | Not load-tested |
| Uptime during contest | No unplanned downtime | Depends on Vercel + Neon + FastAPI deployment (FastAPI not yet in production) |

---

## Stretch goals — all [Planned]

- Support for a third language (C++/Java) — judge currently python-only
- Syntax highlighting in code editor
- Discussion/editorial threads per problem, unlocked after contest ends
- Code similarity / plagiarism detection
- Email notifications for contest start/end
- Codeforces-style rating system
- Problem difficulty tags and filterable archive — tags/difficulty implemented for problems, rating not
- "Hack-a-submission" feature

---

## Explicitly out of scope

### 1. Production-Grade Code Sandboxing
- **What we don't do:** Docker-per-submission, gVisor/Firecracker microvms, seccomp, chroot
- **What we do:** `resource.setrlimit(RLIMIT_AS)` on POSIX + wall timeout + `py_compile` check; `RLIMIT_AS` skipped on Windows dev
- **Why:** Trusted college user base; process-level isolation sufficient for Sprint 1

### 2. Plagiarism Detection at Scale
- **What we don't do:** AST/mosaic/ML models
- **Why:** Manual review scales for college contests

### 3. Interactive Problems
- **What we don't do:** bidirectional piped communication
- **Why:** Covers 5% of problems; adds sandbox complexity

### 4. Custom Checkers / Special Judges
- **What we don't do:** untrusted checker programs
- **Why:** Recursive sandboxing complexity; single-output covers 95%

### 5. Distributed Judge Workers
- **What we don't do:** Redis queue, multi-machine workers
- **Why:** Single FastAPI worker + synchronous judge sufficient for Sprint 1; Redis queue is future work

### 6. Floating-Point Checker
- **What we don't do:** epsilon comparison
- **Why:** Problem setter phrases outputs as integer/string

---

## Obsolete wording removed

Previous versions referenced **Supabase Auth** and **Supabase Realtime** — both are not used. KOJ uses **Clerk** for auth (Organizations enabled) and plans **Redis + SSE** for realtime (not yet implemented). See `docs/stack.md` and `docs/status.md`.
