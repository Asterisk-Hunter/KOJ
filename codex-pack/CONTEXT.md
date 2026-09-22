# KOJ — Verified Live Context

Snapshot taken **2026-09-22** (Asia/Kolkata) by direct probing of production, the database,
Cloud Run, Vercel, and the repo. Where this file and `docs/` disagree, **this file wins** —
every claim here was reproduced with a command.

> **The single most important thing in this pack.** The judge was fixed and expanded and *is
> live* (deployed with `gcloud run deploy --source api`, which bypasses git). The **frontend
> de-slop is NOT live** — Vercel builds from git and those changes are uncommitted, so the
> public site still shows the fake terminal, the glitch CSS, the "IIITK Judge" brand and the
> fabricated anonymous problem status. See "Deployed vs working tree" below, then
> `TASKS.md` P0-1.

## Deployed vs working tree (verified 2026-09-22)

| Change | Deployed? | How it was verified |
|---|---|---|
| Judge: rlimit restore + 7 languages + 5 hardening fixes | ✅ **LIVE** (`koj-judge`, revision `00015`) | `scripts/judge-smoke.py` → 18/18 PASS; `/health` → `"sandbox":"rlimit"` |
| Frontend de-slop, brand fix, anonymous-status fix, language selector | ❌ **NOT LIVE** — working tree only | `curl https://koj-peach.vercel.app/` still contains `terminalGlitch`, `terminal-crt-glow`, `scanline`, `text-glow`, `bg-grid` and `IIITK Judge` ×2; `/api/problems` (anonymous) still returns `"status":"unsolved"` |
| Repo docs correction (features/status/qa) | ❌ not committed | `git status` |
| This pack | ❌ untracked | `git status` |

The judge is deployed because Cloud Run deploys from source, not from git. The web app is not,
because Vercel builds from the git repository. **This asymmetry is the trap:** the site can look
fixed locally while production serves the old UI. After committing and pushing, re-run the
`curl` above and confirm the artifacts and `IIITK Judge` are gone before claiming the de-slop is
live.

---

## Live system

| Piece | Where | Verified state |
|---|---|---|
| Web app | https://koj-peach.vercel.app | `/api/health` → `200 {"status":"ok","db":true}`. **Serving the pre-de-slop UI** — see "Deployed vs working tree" below |
| Judge (FastAPI) | https://koj-judge-189400571693.asia-south1.run.app | `/health` → `{"status":"ok","db":true,"sandbox":"rlimit"}` |
| Judge revision | `koj-judge-00015-*` | deployed 2026-09-22: rlimit restore + 7-language expansion. `GET /health` reports `"sandbox":"rlimit"` |
| Database | Neon Postgres, project `KOJ`, `ap-southeast-1` | 8 tables, 23 indexes |
| Clerk | instance `singular-longhorn-70.clerk.accounts.dev` | what the **production** build uses (see below) |
| Repo | `Prajwal-k-tech/KOJ`, branch `main` | HEAD `31e42ae` committed; **all of this pack's work is uncommitted in the working tree** (D1) |
| Git remote / PR flow | direct commits to `main` permitted by owner exception (2026-09-21, `AGENTS.md` rule 1) | — |

## Production data (read from Neon)

> **Snapshot, not a live count.** The database is shared and changes between sessions — by the
> end of this session `problems` was already at 17 (local `/api/problems` returned
> "Palindrome Number", id 17), up from 9. Re-read the tables before drawing conclusions from
> the numbers below; the *roles* and *defects* are the durable parts.

| Table | Rows | Notes |
|---|---|---|
| `users` | 7 | roles: 4 × `admin`, 3 × `contestant`. No `problem_setter` or `contest_setter` exists yet. |
| `problems` | 9 | all `published`; `time_limit_ms` 1000–2000, `memory_limit_mb` 256–512 |
| `problem_test_cases` | 35 | 4 per seeded problem; problem 12 has 3 |
| `contests` | 4 | includes one `archived` demo contest ("Monsoon Mayhem — Archived") |
| `contest_registrations` | 4 | |
| `submissions` | 12 | 6 accepted, 2 wrong_answer, 2 runtime_error, 2 pending |

Notable content issues (see `TASKS.md`):

- Problem 12 "Two Sum" (LeetCode-imported) duplicates problem 4 "Two Sum — Pair Indices".
- Submissions **11 and 12 are stuck `pending` with `judge_infra_error=true`** — created during
  the outage and never recovered, so the author sees a permanently pending submission.

---

## THE OUTAGE — found and fixed on 2026-09-22

**Symptom.** Every submission failed. Live DB evidence:

```
id 11  status=pending  judge_infra_error=t  err='judge sandbox unavailable: docker binary not found on judge host'
id 12  status=pending  judge_infra_error=t  err='judge sandbox unavailable: docker binary not found on judge host'
```

**Root cause.** `api/app/judge.py` had been rewritten to a **Docker-only** sandbox
(`_run_docker` + `api/DEPLOYMENT_CONTRACT.md`), but the service is deployed on **Cloud Run**,
which has no Docker daemon and cannot run sibling containers. `DEPLOYMENT_CONTRACT.md`
already said so in writing ("Cloud Run is acceptable only for the Next.js frontend, never
for `api/`") and in its §11 limitations ("No Docker-capable Linux host was available").
The contract was written, the deployment was never changed, and judging went 100% dark.

**Fix shipped (this pack).** Two backends, selected by `JUDGE_SANDBOX_MODE`
(`auto` = docker if the CLI exists, else rlimit):

- `api/app/judge.py` — new rlimit backend: `RLIMIT_CPU` (soft = wall budget, hard = +1s so a
  CPU hog gets SIGXCPU → reported as TLE, not a generic exit), `RLIMIT_AS`, `RLIMIT_NPROC`,
  `RLIMIT_FSIZE`, core dumps off, wall-clock timeout, one process session per run with
  group-kill. `_local_compile` mirrors `_docker_compile` (gcc/g++/javac/py_compile on the
  host toolchain, relative paths, sandbox-unavailable ≠ compilation error).
- `api/app/config.py` — `JUDGE_SANDBOX_MODE: auto | docker | rlimit`.
- `api/app/main.py` — `/health` now reports the **active** sandbox. Previously a judge with
  no usable sandbox still reported a healthy service; that is why nobody noticed.
- `api/.env.example`, `api/DEPLOYMENT_CONTRACT.md`, `api/README.md` — documented.

**Verified live after deploy** (10/10, `sandbox=rlimit`):

| Case | Result |
|---|---|
| python AC / WA / CE / RE | `accepted` / `wrong_answer` / `compilation_error` / `runtime_error` |
| python TLE (`while True`) | `time_limit_exceeded`, no orphan processes |
| python MLE (`bytearray(600MB)`, 64 MB limit) | `memory_limit_exceeded` |
| C (gcc) AC, C++ (g++) AC, Java AC | `accepted` |
| C++ TLE | `time_limit_exceeded` |
| Hidden-case outputs | redacted (`""`), sample stdout preserved |
| `POST /judge` without/with wrong `X-Judge-Secret` | `401` |
| Verdict latency (AC, 2 cases) | python 0.47 s, C 1.1 s, C++ 2.2 s, Java 2.4 s |

### Language expansion shipped with this pack (TBD-03 / REQ-JUDGE-02)

The judge now supports **seven** languages end to end — `python, c, c++, java, go, rust,
javascript` — in `judge.py`, both API allow-lists, the CodeMirror editor, and the starter
templates. Verified live, all seven, AC + TLE, warm:

| Language | Verdict | Warm latency |
|---|---|---|
| python | `accepted` | 0.47 s |
| c | `accepted` | 1.1 s |
| c++ | `accepted` | 2.2 s |
| java | `accepted` | 2.4 s |
| go | `accepted` | 0.95 s (16.2 s cold — see below) |
| rust | `accepted` | ~1.7 s |
| javascript | `accepted` | ~0.6 s |

Three more real bugs surfaced during this expansion, all invisible to Python-only testing:

3. `RLIMIT_FSIZE` (1 MiB) applied during **compilation** made `rustc` fail to write its
   linker output; it surfaced to the contestant as a bogus compilation error. The file-size
   limit now applies to the run phase only.
4. A missing toolchain was being reported as a contestant compilation error. It is now
   `SandboxUnavailable` → infra-flagged `runtime_error`; each language declares its required
   binaries in `_LOCAL_TOOLCHAIN`, and `gobuild`, `rustc`, `node` are installed in the image.
5. Go recompiled its standard library into a throwaway cache on **every** submission
   (10–16 s each). `GOCACHE` is now process-wide and warmed by a background thread at
   start-up; warm Go verdicts are ~1 s. `GOTMPDIR` must point at a directory that already
   exists or the compile fails.

Go is bounded by `GOMEMLIMIT` and Node by `--max-old-space-size` (derived from the problem's
memory limit) because `RLIMIT_AS` cannot describe either runtime.

Two hardening bugs were found and fixed during bring-up, both discovered only because the
smoke test ran every language:

1. `RLIMIT_NPROC` counts **tasks of the UID, threads included** — an initial `/proc` scan of
   process directories badly undercounted, so `g++` died with
   `cannot execute cc1plus: posix_spawn: Resource temporarily unavailable`. Now derived from
   `/proc/loadavg` field 4 (`running/total`), +64 headroom, cached 5 s, no absolute cap.
2. `RLIMIT_AS` cannot describe a JVM: Java gets no address-space cap and relies on `-Xmx`
   built from the problem's memory limit. The same applies to the Go arena and V8.

> **Git/prod divergence:** the fix is deployed but **not committed** (working tree). Prod
> currently runs `api/app/{judge,config,main}.py` that exist only locally. Commit before any
> other agent rebuilds or rebases — see `TASKS.md` P0-1.

---

## The `(no stdout)` bug — found and fixed 2026-09-22

**Symptom.** The interactive runner showed `Samples: 2/2 Passed · accepted (95ms)` while the
"Your Output" panel read `(no stdout)`. A passing verdict and no output at the same time is
self-contradictory, and it made the Run button look fake.

**Root cause.** `JudgeCase.is_sample` defaults to `False`, and
`app/api/judge/run/route.ts` never sent the field. The judge therefore treated every
interactive case as a **hidden** case and redacted its stdout — correct behaviour for the
submit path, wrong for a runner whose entire input is samples and typed-in stdin. Only
`/judge-async` (the submit path) reads `is_sample` from `problem_test_cases`, which is why a
submitted sample shows its output and a run one did not.

**Proof, against the production judge** (same payload, flag added):

```
WITHOUT is_sample (today)    status=accepted  passed=True  stdout=''
WITH is_sample=true (fix)    status=accepted  passed=True  stdout='5\n'
```

**Fix.** `app/api/judge/run/route.ts` marks every case `is_sample: true` and documents why.
This endpoint is the *only* caller of the synchronous `/judge` API (verified), and every input
it sends is either a sample the problem already publishes or stdin the caller typed — so no
hidden-test content can leak. The stale 400 message ("supported languages: python, c, c++,
java") now derives from `SUPPORTED_LANGUAGES`.

**Not deployed.** Frontend change — ships with `TASKS.md` P0-1.

## The free-AC bug — found and fixed 2026-09-22 (live in revision `00016`)

**Symptom.** A problem with zero test cases handed out `accepted` to *any* program.

**Reproduction, against the production judge:**

```
POST /judge {language: python, code: "print('definitely not the answer')", cases: []}
→ verdict: accepted   passed/total: 0/0   infra_error: False
```

**Root cause.** `execute_judge` ended with:

```python
if passed == total and total > 0: aggregate = "accepted"
elif total == 0:                 aggregate = "accepted"   # free AC
```

The `total == 0` branch was presumably meant to avoid calling an empty loop a failure, but it
turned "nothing was judged" into "everything passed". Combined with `POST /api/admin/problems`
accepting `status: "published"` with no test cases, a setter could publish an unjudgeable
problem that ACs every submission — a false verdict, the one thing SRS §5.4 forbids outright.

**Fix, three layers:**

1. `api/app/judge.py` — `total == 0` now returns `runtime_error` with `infra_error=True` and the
   message `problem has no test cases; nothing was judged`. Verified locally: zero cases →
   `runtime_error`/infra, while a normal 1-case AC and WA are unchanged.
2. `app/api/admin/problems/route.ts` — refuses `status: "published"` with zero test cases
   (`400 publish requires at least one test case`).
3. `app/api/admin/problems/[id]/route.ts` — the same guard on the `draft → published` PATCH
   transition, so an existing empty problem cannot be published either.

The smoke script now asserts this (`PASS zero cases status=runtime_error infra_error=True`), so
it cannot silently regress. **Live: `koj-judge-00016-ljp`, 19/19 PASS.**

> Note for whoever picks this up: `POST /api/admin/problems/import` can still publish an
> imported problem that yielded zero parsed test cases. The judge guard above now turns that
> into a visible infrastructure error instead of free ACs, but the import route deserves the
> same publish guard (`TASKS.md` P1-9).

## One database, three environments (verified)

`local .env.local`, `api/.env`, and the deployed judge's Cloud Run env all point at the **same**
Neon endpoint (`ep-floral-butterfly-azl2aall-pooler…/neondb`). There is no dev database or
branch. Two consequences worth knowing before you "just test it locally":

- Anything you create locally (a problem, a submission, a contest) is **production data**.
- The local Clerk instance (`exotic-blowfish-7545`) has **0 users**, so there is no local admin
  to sign in as — authoring flows cannot be exercised locally at all without first creating a
  user on that instance and giving it a role in the shared DB.

## Frozen decisions (do not revisit without asking)

- **DB roles are auth truth.** Clerk Organizations are not consulted; the Clerk-org path was
  removed deliberately after it granted admin too broadly.
- **Hide unauthorized UI, never rely on 403s.** Proven pattern in
  `app/problems/create/page.tsx` (signed-out notice → check → 403 panel → content).
- **Redis is optional acceleration.** `REDIS_URL` unset ⇒ DB-only, and that is always correct.
- **SSE, not WebSockets**, for verdict + leaderboard realtime (SRS lists WebSocket — recorded
  as a deviation in `SRS-TRACEABILITY.md` REQ-JUDGE-12).
- **rlimit sandbox on Cloud Run** is the accepted isolation level (SRS §2.5 constraint 3).
  Moving to Docker on a GCE VM is a hardening option, not a requirement.
- **No test runner in the repo.** Verify-then-delete scratch files only (`AGENTS.md` rule 5).
- Engineering notes live in `api/DEPLOYMENT_CONTRACT.md`; it is the judge's configuration
  record. Keep it truthful when you change judge behaviour.

## Known defects (not yet fixed)

| # | Defect | Evidence | Impact |
|---|---|---|---|
| D1 | **All judge fixes and the UI de-slop are uncommitted** | `git status` → 16 modified, 1 deleted (`GlitchingTerminal.tsx`), 12 untracked paths | prod runs code that exists only in this working tree; any rebuild, rebase, or `git clean` destroys it |
| D2 | `db/schema.ts` says `time_limit_ms` default `1000`; Neon says `2000` | `information_schema.columns` | `db:push` would silently revert the SRS-mandated 2 s default |
| D3 | Local dev and prod use different Clerk instances | `.env.local` → `exotic-blowfish-7545`; live HTML → `singular-longhorn-70` | local sign-in creates phantom users; can't reproduce prod auth locally |
| D4 | `docs/status.md` claims a `case_results` table and a judge `/metrics` endpoint | live DB has 8 tables, no `case_results`; `GET /metrics` → 404 | docs mislead the next engineer |
| ~~D5~~ | ~~`/api/problems` returns `"status":"unsolved"` to signed-out visitors~~ | **FIXED** — anonymous callers now get `status: null` | — |
| ~~D6~~ | ~~Brand is inconsistent: nav "IIITK Judge" vs title/hero "KOJ"~~ | **FIXED** — nav brand is now `KOJ` | — |
| ~~D11~~ | ~~Interactive "Run" showed `(no stdout)` next to an `accepted` badge~~ | **FIXED** — `/api/judge/run` now sends `is_sample: true`. See below. |
| ~~D13~~ | ~~A problem with **no test cases** returned `accepted` (0/0) for any code~~ | **FIXED + LIVE** (`00016`) — judge now returns `runtime_error` + `infra_error`; publish is refused without cases. See "The free-AC bug". |
| ~~D14~~ | ~~Leaving the problem page discarded the editor and re-seeded the starter template~~ | **FIXED** (local, not deployed) — per problem+language drafts in `localStorage`. Browser-verified. |
| D12 | The contest **arena has no Run button** — only the problem page has the interactive runner | `app/contests/[id]/arena/` fetches `/api/submissions` only | contestants cannot test against samples mid-contest, unlike Codeforces |
| D10 | `GlitchingTerminal` (fake boot log, glitch/scanline/CRT animations, and marketing copy the SRS rules out) was removed from the landing page | `app/components/GlitchingTerminal.tsx` deleted; `app/page.tsx` rewritten as a Codeforces-style text hero | **FIXED** — re-verify after any merge |
| D7 | 2 submissions permanently `pending` from the outage | submissions 11, 12 | orphaned "running" rows in user history |
| D8 | `=3.2` file (783 B of `pip install` output) sits in the repo root | `ls -la =3.2` | accidental shell-redirect debris, untracked |
| D9 | Clerk CLI is authenticated to the wrong (empty) Clerk app | `clerk whoami` → `My Application`, 0 users | no CLI-side user administration for the real instance |

## Documentation that lied (fixed by this pack)

- `docs/status.md` / `codex-pack/CONTEXT.md` (previous revision) claimed judging worked with
  Python/C/C++/Java. It was broken for every language.
- The previous pack's `SRS.md` claimed "all High priority requirements: MET". Several were
  not, including the judge itself.
- `docs/overview.md` described Redis/SSE realtime as "planned, not implemented" — it **is**
  implemented now (`/api/contests/[id]/events`, 8 s standings cache).
- The previous `share.env` carried Clerk keys for an instance the live site does not use.

## Still unverified (be honest about these)

1. **No signed-in end-to-end run has ever been executed by an agent.** Registration →
   contest registration → submit → verdict → standings, and the admin create/publish flows,
   are untested as an authenticated user. `RUNBOOK.md` §6 has the script.
2. **No load test.** "10 concurrent judgements" (REQ-JUDGE-13) and "≤2 s leaderboard update"
   (REQ-LB-04) are architecturally plausible and unmeasured. Cloud Run is `maxScale=5`,
   instance `cpu=2/memory=1Gi`, `containerConcurrency=4`, image runs 4 uvicorn workers.
3. **OAuth (GitHub/Google) is unverified.** The previous docs claim both providers are
   enabled; that cannot be checked without dashboard access (see `BLOCKERS.md`).
4. **Clerk webhook** is configured in Vercel, but delivery has not been observed.
