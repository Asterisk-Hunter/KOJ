# KOJ — Ultimate Viva & Demo Prep (read this the night before)

## 0. Facts to never get wrong

- Live site: **https://koj-peach.vercel.app**.
- Stack: Next.js 16 + React 19 + TypeScript + Tailwind v4 · FastAPI judge · Neon Postgres + Drizzle · Clerk auth · Upstash Redis (optional cache).
- Judge sandbox on production: **OS-isolated subprocess with kernel-enforced CPU, memory, process, and output caps** — prove it any time, `/health` returns `"sandbox":"rlimit"`.
- Auth truth is **Neon `users.role`**, not Clerk. Clerk = identity only.
- 7 languages live (Python/C/C++/Java/Go/Rust/JS — SRS asked 4 v1 + 3 v2; all verified AC+TLE), verdicts AC/WA/TLE/MLE/RE/CE/PE, ICPC scoring, SSE realtime push.
- Repo: `Prajwal-k-tech/KOJ`, `main` branch.

## 1. Explain KOJ in 30 seconds

KOJ is a self-hosted online programming contest platform for IIIT Kottayam: staff author problems and run timed contests, students register and submit code, an isolated judge service executes it safely, and everyone sees an ICPC leaderboard. The point is institutional control — own problems, own users, own rules — and every contest becomes reusable practice material afterward.

## 2. Roles — who can do what (memorize this table)

| Role | Default? | Can do | Cannot do |
|---|---|---|---|
| `contestant` | **yes, every new signup** | browse, register, submit, own history, public rankings | everything staff |
| `setter` | by admin grant | create problems, edit **own** problems, manage their test cases, import, publish own, create/manage contests, attach/remove problems, publish/unpublish/archive, invite codes | delete problems, manage users, see metrics |
| `admin` | by admin grant (or `ADMIN_CLERK_IDS` bootstrap) | everything: users/roles/suspend, delete, metrics, submissions browser | — (cannot demote self) |

Enforcement is triple-layered: server gates on every route (`requireAdmin`/`requireContestManager`/`requireSetter`/`requireStaff`), a layout gate that redirects non-staff away from `/admin`, and UI that hides unauthorized controls entirely. Verified by full isolation audit: zero leaks. Suspended users get 403 on submit.

## 3. Architecture in one breath + diagram talk

Browser → Next.js Route Handlers (auth, validation, contest rules) → `POST /api/submissions` returns 202 → fire-and-forget `POST /judge-async` (secret header) → Cloud Run judge: semaphore slot → advisory lock → load code+cases → compile → run per case under limits → compare → verdict persisted to Neon → browser learns via SSE. DB is always the source of truth; Redis only accelerates.

Styles to name-drop: **Layered** (presentation/API/data), **Pipe-and-Filter** (receive→compile→execute→check→verdict), **Event-Driven** (SSE push), **Master-Slave** (API dispatches, subprocess executes unaware of the web).

Problem flow: `draft → contest_active → published`. Contest flow: `draft → live → ended → archived` (lazy settlement, no cron). Submission: `pending → running → terminal verdict`.

## 4. Judge internals (if pressed)

- Per-run temp dir; `RLIMIT_CPU/AS/NPROC`; wall-clock timeout; peak-memory sampling.
- gcc `-O2 -std=c11`, g++ `-O2 -std=c++17`, javac (Solution/Main auto-detect, `-Xmx` capped), Python interpreted.
- Output compared whitespace-normalized; whitespace-only diffs get PE, not WA.
- Failure philosophy: infra failure → `pending` + flag (retryable), NEVER a false contestant verdict.
- Concurrency: 4 uvicorn workers, semaphore cap, 503 + Retry-After when saturated; DB pool hardened against Neon idle-kill (proven over a 7-minute idle).
- Per-test results persisted (`case_results`) and shown per case on the submission page.

## 5. Realtime, scoring, rate limits

- SSE poll-push: 2s leaderboard ticker, 1s submission stream with auto-reconnect; Redis (8s standings TTL) accelerates, DB fallback always correct.
- Penalty per solved problem = minutes to first AC + 20 × wrong attempts before it (CE excluded, standard ICPC). Sort: solved desc, penalty asc. Freeze masks the last 60 live minutes.
- 1 submission / 30s / problem → 429 + Retry-After + visible cooldown.

## 6. Likely viva questions + model answers

- *Why a separate judge service?* Blast radius (untrusted code never touches web/DB creds), independent scaling, site survives judge outage.
- *Why not containers?* Our host (Cloud Run) has no container daemon; kernel rlimits give equivalent caps with zero orchestrator. Honest constraint-driven call, proven live.
- *Why SSE, not WebSockets?* One-way status flow; serverless-friendly with auto-reconnect; no connection state.
- *How do you stop cheating?* Hidden tests never leave the server, editorial hidden during live contests, rate limits, isolated execution, scrypt-hashed invite codes.
- *Two judges race one submission?* Advisory lock per submission id; loser gets 503 + retries.
- *Judge crashes mid-run?* Row stays `pending` with infra flag; redispatch recovers; contestant never sees a false verdict.
- *Why Neon + Drizzle + Clerk?* Managed Postgres with branching, type-safe queries (no SQL-injection class), auth never hand-rolled.
- *Scale to 500 users?* Stateless front, capped judge concurrency + Cloud Run max-instances, Redis cache wired, DB indexes in place. Load test is the honest gap.
- *Auth vs auth?* Clerk answers who-you-are; Neon roles answer what-you-may-do. Never mixed.
- *Testing?* 107 committed unit tests, green (`npm test`: 83 judge pytest + 24 TS scoring/invite); tsc + lint + build gate every push; load test is the honest gap.

## 7. Traps — do NOT say these

- Never claim containers run on Cloud Run (health says rlimit).
- Never claim Clerk roles control access (DB roles do).
- Never claim load testing was done (architecturally ready, unexecuted).
- Never claim a production-tier Clerk instance (shared Development instance `singular-longhorn-70`; same keys on Vercel and dashboard — say so if asked).
- Never read from the PPT — explain, don't recite.
- Every member must whiteboard the submit→verdict flow. Never say "that was my teammate's part" for core questions.

## 7b. Sanctioned deviations — own these confidently if asked

- **REQ-JUDGE-12 WebSocket → SSE.** Verdicts flow server→client only; SSE gives the same push semantics on serverless with auto-reconnect and zero connection state. Call it "real-time push (SSE)".
- **BR-01 contests.** SRS says admin-only; staff (`setter`) can also run contests. Rationale: college workflow; BR-03 (only admins touch users/roles) is fully intact.
- **BR-06 registration.** SRS says pre-start only; live contests accept joins until `endsAt` (documented in-code supersede). Rationale: late joiners are standard in college contests.
- **Roles.** SRS names Contestant/Problem Setter/Admin; ours is contestant/setter/admin — same three tiers, staff side merged.
- **Deferred per SRS itself:** team mode (REQ-CONT-09, Low), custom checkers (REQ-JUDGE-15, Medium→v2), interactive problems. Say "v2, as the SRS schedules".
- **Exceeded:** all 7 languages live (TBD-03 closed early), PE verdict, empty-problem free-AC guard, duplicate-username handling.
- **Deployment:** GCP Cloud Run = the SRS fallback (Azure primary needed student credits); portability requirement explicitly allows it.

## 8. Team checklist (tonight)

- Rehearse the demo twice on the presentation network with two accounts (admin + contestant).
- Pre-create both accounts; keep a known-good and a known-bad solution in a scratch file.
- Screenshots/recording of the happy path as backup (labeled with date), attempt live first.
- Each member: 30-second pitch, architecture sketch, scoring formula, one trade-off, one limitation — without notes.
- Agree handoff order, but everyone answers core questions first.

## 8b. Who studies what (swap names freely, cover everything)

- **Everyone, no exceptions:** 30-second KOJ pitch · submit→verdict whiteboard flow · penalty formula · 3 roles and their gates · one trade-off + one limitation each.
- **Speaker 1 (title/problem):** §1.4 product scope, external-platform pain points, user classes (§2.3).
- **Speaker 2 (requirements/architecture):** REQ IDs by section, §7b deviations, four architecture styles + where each lives, rlimit sandbox story.
- **Speaker 3 (demo):** full click path rehearsed twice, both C++ solutions from memory, fallback line, 429/403/BR-08 moments narrated as features.
- **Speaker 4 (testing/close):** 107-test breakdown, gate pipeline (tsc/lint/build/test), honest gaps (load test, v2 items), deployment map (Vercel/Cloud Run/Neon/Clerk).
