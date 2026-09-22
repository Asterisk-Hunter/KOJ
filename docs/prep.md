# KOJ — Viva & Demo Prep (read this the night before)

## 0. Facts to never get wrong

- Live site: **https://koj-peach.vercel.app** (not koj.iiitk.ac.in — that's a placeholder).
- Stack: Next.js 16 + React 19 + TypeScript + Tailwind v4 · FastAPI judge · Neon Postgres + Drizzle · Clerk auth · Upstash Redis (optional cache).
- Judge sandbox is the **rlimit subprocess backend on production**: per-run temp dir, kernel CPU/memory/process/output caps — prove it any time, `/health` returns `"sandbox":"rlimit"`. (A Docker container backend exists in code for self-hosted hosts with a daemon; Cloud Run has none, so prod never uses it.) Never claim containers run on Cloud Run.
- Auth truth is **Neon `users.role`**, not Clerk org roles (that path was deliberately removed after it over-granted). Clerk = identity only.
- 4 languages (C, C++, Python, Java), 7 verdicts, ICPC scoring, SSE realtime (poll-push, 2s ticker).
- Repo: `Prajwal-k-tech/KOJ`, `main` branch. Never mention Asterisk-Hunter (infra-only location of the Neon project).

## 1. Demo script (~12 min, two accounts: admin + contestant, two browsers)

1. **Problems** (1 min): open `/problems`, filter by difficulty, open Two Sum. Point out samples, limits, editor.
2. **Contest** (2 min, admin): `/admin` → show contest list → open a live contest → countdown, problem list, invite-code field if private.
3. **Register** (1 min, contestant): `/contests/<slug>` → REGISTER → arena appears.
4. **Submit** (3 min, contestant): paste a correct Python solution → SUBMIT → verdict streams live (no refresh) → open submission → **per-test table** shows each case.
5. **Wrong answer** (2 min): submit a buggy version → WA with the failed test visible → fix → resubmit → AC. Mention the 30s rate limit if it triggers (429 + cooldown UI).
6. **Standings** (2 min): `/rankings?contestId=<slug>` → row appears, penalty = AC minutes + 20 × wrongs. Refresh-free update.
7. **Admin close** (1 min): `/admin` → users/roles, observability metrics, problem lifecycle draft → contest_active → published.
8. Buffer (3 min): questions during demo.

Rehearse twice. Pre-create both accounts. Have a known-good solution pasted in a scratch file (network hiccups happen).

## 2. Architecture (one breath + diagram talk)

Browser → Next.js Route Handlers (auth, validation, contest rules) → `POST /api/submissions` returns 202 → fire-and-forget `POST /judge-async` (secret header) → Cloud Run judge: semaphore slot → advisory lock → load code+cases → compile → run per case under limits → compare → verdict persisted to Neon → browser learns via SSE. DB is always the source of truth; Redis only accelerates.

Styles to name-drop: **Layered** (presentation/API/data), **Pipe-and-Filter** (receive→compile→execute→check→verdict), **Event-Driven** (SSE push), **Master-Slave** (API dispatches, subprocess executes unaware of the web).

## 3. RBAC (examiners love this)

Four DB roles: `contestant` (default) / `problem_setter` / `contest_setter` / `admin`. Enforced server-side on every route (`requireAdmin`/`requireContestManager`/`requireSetter`/`requireStaff`) + layout gate redirects non-staff + UI mirrors gates ( hide-don't-403: unauthorized controls don't render). `ADMIN_CLERK_IDS` env bootstraps the first admin. Verified: full isolation audit, zero leaks; setters can't delete, touch contests, or see admin sections.

## 4. Judge internals (if pressed)

- Dual backend selected by `JUDGE_SANDBOX_MODE` (`auto` = Docker CLI present? containers : rlimit).
- Docker path: one container per case, no network, non-root, read-only FS, seccomp, CPU/PID/output caps, forced `rm -f` cleanup.
- rlimit path: temp dir per run, `RLIMIT_CPU/AS/NPROC`, wall-clock timeout, peak-RSS sampling.
- Verdicts: AC/WA/TLE/MLE/RE/CE + PE (whitespace-only diff flagged separately so students fix formatting, not logic).
- Failure philosophy: infra failure → `pending` + flag (retryable), NEVER a false contestant verdict.
- Concurrency: 4 uvicorn workers, semaphore cap, 503 + Retry-After when saturated; connection pool hardened against Neon idle-kill (lifetime/check/retry, proven over a 7-minute idle).

## 5. Likely viva questions + model answers

- *Why a separate judge service?* Blast radius (untrusted code never touches web/DB creds), independent scaling, site survives judge outage.
- *Why rlimit on prod instead of Docker?* Cloud Run has no Docker daemon; the code auto-selects. Constraint-driven, documented, honest.
- *Why SSE, not WebSockets?* One-way status flow; serverless-friendly (60s function cap with auto-reconnect); no connection state to manage.
- *How do you stop cheating?* Hidden tests (never leave the server), editorial hidden during live contests, rate limits, isolated execution, invite codes hashed with scrypt.
- *What if two judges race on one submission?* Advisory lock per submission id; loser gets 503 + retries.
- *What if the judge crashes mid-run?* Submission stays `pending` with infra flag; redispatch recovers; contestant never sees a false verdict.
- *Why Neon + Drizzle + Clerk?* Managed Postgres with branching (safe migrations), type-safe queries (no SQL injection class), auth you don't hand-roll (bcrypt/sessions/OAuth/JWT).
- *Scale to 500 users?* Stateless front (scale horizontally), judge concurrency cap + Cloud Run max-instances, Redis cache already wired, DB indexes in place. Load test is the honest gap.
- *Custom checkers / more languages?* Explicitly deferred (documented); checker interface point exists in pipeline design.
- *Testing?* 45-check E2E sweep, 0 critical issues; tsc + lint + build gates on every change; independent review gates per phase.

## 6. Traps — do NOT say these

- Never claim Docker runs on Cloud Run (health says rlimit).
- Never claim Clerk org roles control access (removed; DB roles do).
- Never claim load testing was done (architecturally ready, unexecuted).
- Never read from the PPT — explain, don't recite.
- Every member must be able to whiteboard the submit→verdict flow. If one person only memorized their slice, the viva will find it.
