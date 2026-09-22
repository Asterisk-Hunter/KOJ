# KOJ — SRS Traceability

Every requirement from **SRS v1.0** (`KOJ_SRS.pdf` / `SRS.txt`, Group 3, 4 Aug 2026) mapped to
its real status as of **2026-09-22**, with the evidence that was actually checked.

Status vocabulary:

- **MET** — implemented and reproduced.
- **PARTIAL** — implemented with a known gap; the gap is named.
- **DEVIATION** — deliberately different from the SRS text; the rationale is recorded.
- **UNVERIFIED** — believed implemented, not reproduced. Treat as unknown.
- **NOT MET** — absent. Allowed only where the SRS marks the item Medium/Low/deferrable.

> The previous handoff claimed "all High priority requirements: MET". That was false — the
> judge was down for every language when that was written. This document is evidence-based;
> anything not reproduced is marked UNVERIFIED rather than assumed.

---

## 4.1 Authentication and User Management

| Req | Priority | Status | Evidence / gap |
|---|---|---|---|
| REQ-AUTH-01 email+password registration | High | MET | Clerk catch-all routes `app/sign-in/[[...sign-in]]`, `app/sign-up/[[...sign-up]]`; 7 production users exist |
| REQ-AUTH-02 OAuth GitHub + Google | High | **UNVERIFIED** | Buttons render; provider enablement is a dashboard setting nobody can inspect (no access — `BLOCKERS.md` #3). Must be confirmed in a browser before a contest. |
| REQ-AUTH-03 default `contestant` role | High | MET | `db/schema.ts` default `contestant`; 3 live contestant rows |
| REQ-AUTH-04 admin changes user roles | High | MET | `GET/PATCH /api/admin/users` (`requireAdmin`), `app/admin/UsersSection.tsx`; self-change refused (BR-03) |
| REQ-AUTH-05 Clerk sessions / JWT | High | MET | `proxy.ts` + `await auth()` on every write path; `/api/auth/me` returns live role |
| REQ-AUTH-06 duplicate email rejected | High | MET | unique email constraint applied to Neon; webhook dedupe in `app/api/webhooks/clerk/route.ts` |
| REQ-AUTH-07 password reset via email | Medium | UNVERIFIED | Clerk-provided; never exercised. Depends on Clerk email config (SRS TBD-05). |

## 4.2 Problem Management

| Req | Priority | Status | Evidence / gap |
|---|---|---|---|
| REQ-PROB-01 create with title/markdown/time/memory/difficulty | High | MET | `POST /api/admin/problems` (`requireSetter`), `app/admin/ProblemStudio.tsx` |
| REQ-PROB-02 test cases as input/output pairs | High | MET | `problem_test_cases`; 35 live rows; per-case + bulk + import routes |
| REQ-PROB-03 10 MB per-file cap | High | MET | `MAX_FILE_BYTES = 10 * 1024 * 1024` in both test-case routes |
| REQ-PROB-04 draft → contest_active → published | High | MET | `app/api/contests/lifecycle.ts` transitions + auto-publish on contest end |
| REQ-PROB-05 draft visible to author/admin only | High | MET | `GET /api/problems/[id]` 404s non-published for other roles |
| REQ-PROB-06 contest-active visible to registered participants | High | MET | arena route requires registration + live contest |
| REQ-PROB-07 published visible to all | High | MET | 9 published problems served publicly ✅ |
| REQ-PROB-08 markdown rendering | Medium | MET | `react-markdown` + `remark-math` + `rehype-katex` |
| REQ-PROB-09 edit problems while draft | High | MET | `PATCH /api/admin/problems/[id]` |
| REQ-PROB-10 no edits once a contest has started | High | MET | locked via contest state (BR-08) + UI badge |

## 4.3 Code Submission and Judge Pipeline

| Req | Priority | Status | Evidence / gap |
|---|---|---|---|
| REQ-JUDGE-01 accept submission, return id | High | MET | `POST /api/submissions` → 202 `{id}`; 401 unauthenticated ✅ |
| REQ-JUDGE-02 C, C++, Python, Java | High | MET | all four verified **live** (gcc/g++/javac/CPython). **Exceeds the requirement:** the SRS medium-priority TBD-03 set is also implemented — Go, Rust and JavaScript/Node — so all **seven** languages are live (AC + TLE each). |
| REQ-JUDGE-03 gcc/g++/javac compilation | High | MET | verified live; CE returns real compiler diagnostics |
| REQ-JUDGE-04 CPU limit via `setrlimit(RLIMIT_CPU)` | High | MET | implemented in the rlimit backend; CPU hog → SIGXCPU → TLE ✅ |
| REQ-JUDGE-05 wall-clock timeout | High | MET | `wall = time_limit_ms/1000 + 2s`, process-group kill; infinite loop → TLE ✅ |
| REQ-JUDGE-06 memory limit via `RLIMIT_AS` | High | **DEVIATION** | `RLIMIT_AS` applies to C/C++/Python ✅ (600 MB alloc under a 64 MB limit → MLE). Java has **no** address-space cap because the JVM reserves far more virtual space than its heap; `-Xmx` derived from the problem limit is the Java memory limit. Docker backend uses cgroup memory for all languages. |
| REQ-JUDGE-07 fork-bomb guard | High | PARTIAL | rlimit: `RLIMIT_NPROC` = host live task count + 64 (a fixed small value breaks `g++`/`javac` with EAGAIN — found and fixed today). Docker: `--pids-limit`. A forking program does not escape ✅, but the bound is headroom-based rather than exact. |
| REQ-JUDGE-08 isolated working directory | High | PARTIAL | Both backends run in a private `tempfile` workdir; the sandbox never receives a user-controlled path. **rlimit mode has no filesystem/network namespace** — contestant code shares the service filesystem and netns. The docker backend provides true isolation. |
| REQ-JUDGE-09 whitespace-normalised comparison | High | MET | `_outputs_equal` (rstrip lines, drop trailing blanks); WA reproduced live ✅ |
| REQ-JUDGE-10 all cases → single verdict | High | MET | loop aggregates first non-accepted verdict; `passed_tests/total_tests` recorded ✅ |
| REQ-JUDGE-11 all verdicts incl. PE | High | MET | `Verdict` includes `presentation_error` (whitespace-only diff); AC/WA/TLE/MLE/RE/CE all reproduced live ✅ |
| REQ-JUDGE-12 realtime verdict delivery | High | **DEVIATION** | Delivered over **SSE** (`/api/submissions/[id]/events`), not WebSocket. Same user-visible behaviour, fewer moving parts, works on Vercel serverless. |
| REQ-JUDGE-13 ≤10 concurrent judgements | High | UNVERIFIED | Architecturally plausible (Cloud Run `maxScale=5` × `containerConcurrency=4`, semaphore per worker). Never load-tested — `TASKS.md` P1-7. |
| REQ-JUDGE-14 log every result | High | MET | `submissions` rows carry status, passed/total, `execution_time_ms`, `error_message`, timestamps |
| REQ-JUDGE-15 custom checkers | Medium | NOT MET | Deferred by SRS (TBD-02). Safe to defer — nothing in v1 needs it. |
| REQ-JUDGE-16 per-problem time limit (default 2 s) | High | MET (with drift) | Live column default is `2000` ✅ — but `db/schema.ts` says `1000`. **Schema drift, defect D2.** |
| REQ-JUDGE-17 per-problem memory limit (default 256 MB) | High | MET | column default `256` in both schema and Neon |

## 4.4 Contest Management

| Req | Priority | Status | Evidence / gap |
|---|---|---|---|
| REQ-CONT-01 create with title/description/start/end/mode | High | MET | `POST /api/admin/contests` (`requireContestManager`); 4 live contests |
| REQ-CONT-02 open + invite-based registration | High | MET | `invite_code` (hashed) with `POST /api/contests/[id]/register` |
| REQ-CONT-03 admin adds problems to a contest | High | MET | `contest_problems` + `/api/admin/contests/[id]/problems` |
| REQ-CONT-04 auto-open at start, lock at end | High | MET | `settleExpiredContests()` on submit/read paths, legal state machine |
| REQ-CONT-05 one-click registration for open contests | High | MET | register CTA on `/contests/[id]`, gated on auth state |
| REQ-CONT-06 invite-code registration | High | MET | same route, code validated against the hash |
| REQ-CONT-07 no submissions after contest end | High | MET | submit path requires `contest.status === "live"` |
| REQ-CONT-08 countdown timer | Medium | MET | contest page + arena timer |
| REQ-CONT-09 team contest mode | Low | NOT MET | Deferred by SRS (TBD-04). |

## 4.5 Live Leaderboard

| Req | Priority | Status | Evidence / gap |
|---|---|---|---|
| REQ-LB-01 rank by solved desc, penalty asc | High | MET | `app/api/rankings/route.ts` ✅ returns real standings |
| REQ-LB-02 penalty = first AC + 20 × wrong before AC | High | MET | implemented; per-problem attempts exposed |
| REQ-LB-03 realtime push | High | MET | SSE `/api/contests/[id]/events` + Redis pub/sub when configured |
| REQ-LB-04 ≤2 s propagation | High | UNVERIFIED | 2 s client ticker + 8 s standings cache TTL. Ranking response measured at 1.4–1.9 s. Needs a live two-client test. |
| REQ-LB-05 visible to all users | High | MET | `/rankings` is public ✅ |
| REQ-LB-06 per-problem status | Medium | MET | `AC / WA / PENDING / --` + attempts + first-blood `★` |

## 4.6 Rate Limiting

| Req | Priority | Status | Evidence / gap |
|---|---|---|---|
| REQ-RATE-01 1 submission / 30 s / problem | High | MET | cooldown check + insert inside one transaction guarded by `pg_advisory_xact_lock` |
| REQ-RATE-02 429 + `Retry-After` | High | MET | returns 429 with the computed wait |
| REQ-RATE-03 visible countdown on the submit button | Medium | MET | `cooldown` state + progress bar on `/problems/[id]` |

## 5. Non-functional

| Req | Priority | Status | Evidence / gap |
|---|---|---|---|
| REQ-PERF-01 submission → id < 1 s | High | MET (local) | insert + dispatch is a single round trip; production cold start not measured |
| REQ-PERF-02 verdict < 5 s for simple problems | High | MET | live, 2 cases: python 0.47 s, C 1.10 s, C++ 2.18 s, Java 2.43 s, Go 0.95 s warm (16.2 s cold), Rust ~1.7 s, Node ~0.6 s. Multi-case TLE legitimately exceeds it (each case gets its own budget). Go's cold-start number is the one to watch. |
| REQ-PERF-03 50 concurrent users < 3 s | High | UNVERIFIED | no load test |
| REQ-PERF-04 leaderboard ≤ 2 s | High | UNVERIFIED | see REQ-LB-04 |
| REQ-PERF-05 problem list < 2 s | Medium | MET with caveat | warm 0.2–0.4 s; one observed ~25 s Vercel cold start (documented in `CONTEXT.md`) |
| REQ-PERF-06 10 concurrent judge tasks | High | UNVERIFIED | see REQ-JUDGE-13 |
| REQ-SAFE-01 no access outside the sandbox | High | PARTIAL | docker backend: MET (read-only root, `--network none`, cap-drop, seccomp). rlimit backend (production today): no namespace, so a submission can read the service's filesystem and reach the network. Accepted under SRS §2.5 for a trusted user base; the hardened path is `JUDGE_SANDBOX_MODE=docker` on a Docker host (`BLOCKERS.md` #5). |
| REQ-SAFE-02 kill processes over the time limit | High | MET | wall timeout + SIGKILL of the whole process group; verified no orphan processes remain |
| REQ-SAFE-03 bound child processes | High | PARTIAL | see REQ-JUDGE-07 |
| REQ-SAFE-04 source not exposed to other users | Medium | MET | `GET /api/submissions/[id]` is owner-scoped (404 otherwise); hidden-case output redacted |
| REQ-SEC-01 HTTPS everywhere | High | MET | Vercel + Cloud Run, TLS only |
| REQ-SEC-02 password hashing | High | MET | delegated to Clerk |
| REQ-SEC-03 JWT validation on authenticated routes | High | MET | `auth()` on every write; 401 verified ✅ |
| REQ-SEC-04 admin endpoints verify the admin role | High | MET | `authz.ts` gates; `/api/admin/summary` → 401 anonymous ✅ |
| REQ-SEC-05 CSRF protection | Medium | PARTIAL | state-changing calls are Clerk-authenticated same-site POSTs; no explicit token. Low risk with the current architecture, not a deliberate control. |
| REQ-SEC-06 sanitise input (SQLi/XSS) | High | MET | parameterised Drizzle everywhere; React escaping; ReactMarkdown without raw HTML |
| §5.4 Availability / Reliability | — | UNVERIFIED | no uptime measurement; correctness now verified per language |
| §5.4 Maintainability | — | MET | modular, layered, documented |
| §5.4 Testability (40+ judge unit tests) | — | **NOT MET** | no test runner installed; `AGENTS.md` rule 5 forbids leaving tests behind. Requires an explicit policy change (`TASKS.md` P2). |
| §5.4 Usability | — | PARTIAL | the flows exist; the visual pass is `UI-SPEC.md` |
| §5.4 Portability | — | MET | rlimit path runs on any Linux; docker path on any container host |

## Business rules

| Rule | Status | Evidence |
|---|---|---|
| BR-01 only admins create contests | MET* | `requireContestManager` also admits `contest_setter` (Sprint-2 role decision, recorded in `docs/status.md`) |
| BR-02 only setters/admins create problems | MET | `requireSetter` |
| BR-03 only admins change roles | MET | `requireAdmin`, self-change refused |
| BR-04 draft before adding to a contest | MET | contest-problem routes validate problem state |
| BR-05 submissions locked after contest end | MET | submit path requires `status="live"` |
| BR-06 registration only before the contest starts | MET | register route rejects finished contests |
| BR-07 penalty only after the first AC | MET | rankings logic |
| BR-08 no edits to problems in an active contest | MET | lifecycle lock + UI badge |

## §6 Other requirements

| Item | Status | Evidence |
|---|---|---|
| Schema contains users/problems/test_cases/submissions/contests/contest_problems/contest_registrations | MET | live tables confirmed |
| …and `leaderboards` | **DEVIATION** | standings are computed on demand from submissions (+ optional 8 s Redis cache) instead of a materialised table. Same user-visible behaviour, no stale-scoreboard risk. |
| Logging of judge executions | MET | DB rows + structured JSON logs; bodies never logged |
| One-command deployment | MET | Vercel for web, `gcloud run deploy --source api` for the judge |
| Git feature-branch workflow | DEVIATION (approved) | owner exception 2026-09-21 allows direct commits to `main` on `Prajwal-k-tech/KOJ`; PRs elsewhere |
| v2 items (custom checkers, interactive problems, Docker sandbox, per-language limits, Redis caching, test-case validation) | Partial | Redis caching implemented (optional); Docker sandbox implemented behind `JUDGE_SANDBOX_MODE`; **Go/Rust/JavaScript judge support (TBD-03) implemented and verified live**; custom checkers, interactive problems, per-language multipliers and test-case validation deferred |

## Scoreboard

| | High | Medium | Low |
|---|---|---|---|
| MET / DEVIATION | 45 | 7 | 0 |
| PARTIAL | 5 | 0 | 0 |
| UNVERIFIED | 8 | 1 | 0 |
| NOT MET (deferrable per SRS) | 0 | 1 | 1 |

The Medium column improved by one because TBD-03 (Go/Rust/JavaScript) moved from
"not implemented" to MET — verified live for all three, AC and TLE.

Remaining High-priority gaps are all **verification or hardening**, not missing features:
load/perf measurement (2), OAuth proof (1), rlimit filesystem isolation + fork bound (3),
`RLIMIT_AS`-for-Java deviation (1), Realtime transport deviation (1), plus the uncommitted
diff (D1) making everything above describe production rather than `main`.
