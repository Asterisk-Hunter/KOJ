# Features

> Status as of `feat/sprint1-backend` — see `docs/status.md` for authoritative counts and verification. Items marked **[Implemented]** are live against Neon; **[Planned]** are not yet built.

## MVP features

### Authentication & Authorization — [Implemented]
- Clerk Organizations enabled; `proxy.ts` gates `/dashboard` + `/admin` (public: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/problems(.*)`, `/contests(.*)`, `/rankings(.*)`, `/submissions(.*)`, `/api(.*)`)
- DB roles: `contestant` | `setter` | `admin` (`user_role` enum). `org:admin` (Clerk) accepted for admin APIs (`/api/admin/*`); DB `admin` also accepted. 403 for unauthorized.
- Dashboard does not auto-redirect admins — `/admin` is a separate page.
- **Setters** (problems + contests): `requireSetter` for problem CRUD/test cases/import, `requireContestManager` for contest CRUD; own problems only (admins exempt). User/role management, metrics, and problem hard-delete stay admin-only.

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
- **Contest creation / editing / publishing:** [Implemented on `feat/srs-high-priority`] admin-only `POST/GET /api/admin/contests`, `PATCH/DELETE /api/admin/contests/[id]` (publish/unpublish/end/archive transitions), add/remove problems via `/api/admin/contests/[id]/problems`, contest manager UI in `/admin`. Past-due `live` contests auto-flip to `ended` (lazy settle on contest reads/writes) and linked problems publish to the archive.

### Code Submission & Judging — [Implemented: Python, C, C++, Java, Go, Rust, JavaScript]
- **Submission UI:** `app/problems/[id]/page.tsx` and `app/contests/[id]/arena/page.tsx` — language selector (python/c/c++/java/go/rust/javascript), CodeMirror, Run (samples) vs Submit (all cases). All seven languages are verified live against production (AC + TLE each).
- **Codeforces Interactive Workspace:**
  - **Custom Test Runner (`POST /api/judge/run`):** Non-persisted real-time interactive testing with arbitrary user-supplied `stdin` and optional expected output diffing. Execution time, memory, stdout, and stderr displayed immediately.
  - **Sample Cases Runner:** Multi-tab sample testing with per-case pass/fail badges, expected vs actual stdout diffs, and execution metrics.
  - **In-Workspace Submissions Drawer:** Tab showing recent submissions on the problem with real-time SSE verdict streaming.
  - **Fast I/O Starter Templates:** Preloaded CP templates for C++ (`bits/stdc++.h` + fast I/O), Python 3.11, Java, and C with one-click reset and copy buttons.
- **Submission flow:** `POST /api/submissions` validates auth/ids/code/mode → inserts `pending→running` → calls FastAPI `POST /judge` → persists verdict to Neon → returns result (see `docs/status.md` pipeline)
- **Judge module:** `api/app/judge.py` — two backends selected by `JUDGE_SANDBOX_MODE` (`docker` = container sandbox; `rlimit` = host toolchain, the isolation level SRS §2.5 sanctions and what production/Cloud Run runs). Per-language prepare (py_compile / gcc / g++ / javac / `go build` / `rustc` / node), isolated temp workdir per submission, `RLIMIT_CPU/AS/NPROC/FSIZE` + wall timeout `time_limit_ms+2s`, whitespace-normalized comparison, verdicts `AC/WA/TLE/MLE/RE/CE/PE`. `RLIMIT_AS` does not describe the JVM/Go/Node, so those are bounded by `-Xmx`/`GOMEMLIMIT`/`--max-old-space-size`; `/health` reports the active backend as `sandbox`.
- **Verdict types:** `accepted`, `wrong_answer`, `time_limit_exceeded`, `memory_limit_exceeded`, `runtime_error`, `compilation_error` — mapped to `submission_status`
- **Multiple submissions:** all stored; `GET /api/submissions?problemId=&contestId=` lists caller's history

### Real-Time Submission Status — [Implemented]
- Live verdict updates via Server-Sent Events (`GET /api/submissions/[id]/events`) and contest leaderboard updates (`GET /api/contests/[id]/events`).
- Interactive submission drawer in problem workspace streams live verdict transitions (`pending` → `running` → `verdict`).

### Leaderboard & DOMjudge Scoreboard — [Implemented]
- **Ranking:** `GET /api/rankings?contestId=` — ICPC style: `solved_count DESC, penalty ASC` where `penalty = minutes_to_first_AC + 20*wrong_before_AC`. Compilation errors (`CE`) do not incur penalties.
- **12-Color Balloon Palette:** Distinct DOMjudge balloon colors associated with problems across problem letters, arena header, and scoreboard columns.
- **First-to-Solve (First Blood):** Earliest AC submission on each problem is highlighted with a gold star badge (`★`) and dark green cell styling.
- **Scoreboard Freeze:** Standings in the final 60 minutes of live contests are frozen (`?` pending indicator) to preserve suspense without leaking post-freeze solve times.
- **Problem Summary Footer:** DOMjudge-style bottom row displaying total solves, total attempts, and acceptance percentage per problem.
- **Contestant Search Filter:** Client-side real-time filter by contestant username.

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

- ~~Support for additional languages~~ — done: all seven languages (python/c/c++/java/go/rust/javascript) are implemented and verified live.
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
