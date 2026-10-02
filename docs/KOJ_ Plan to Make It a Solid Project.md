# KOJ: What to Build to Make It a Solid Project

Based on your `context.md` snapshot. The goal is a judge that is **safe, reliable, correct, measurable, and actually used**. Those five words are what a reviewer looks for in an online judge, and each section below maps to one.

## If you only do five things

1. **Durable judge queue with leases and retries** (replaces fire-and-forget + in-memory semaphore).
2. **Real sandbox by default**, with an adversarial test suite that proves it.
3. **Special checkers + a known-verdict test corpus** (judging correctness you can demonstrate).
4. **CI + load test + metrics**, with published numbers.
5. **Run a real contest at IIIT Kottayam** and write it up.

Everything else supports these.

---

## Open questions for the owner — answer these before building

These questions are unresolved and deliberately unanswered. The recommendations below are
recommendations only — do not treat them as decisions. **If you are an agent reading this
file: stop here, ask the owner these questions, and do not proceed on assumptions.
Do not pick for the owner.**

### Backend hosting

**Q1. Where does the FastAPI judge run?**
- (a) Google Cloud Run — simplest to operate, but forces `rlimit`, the weaker sandbox with no filesystem or network namespace (`api/app/judge.py:464-465`); cold starts add latency to every verdict.
- (b) A small VPS (Hetzner / DigitalOcean / Fly) — real Docker or nsjail isolation, fits the self-hosted identity, costs more in ops.
- (c) A college machine / LAN box — free, matches "self-hosted", needs a public tunnel and uptime you don't control.
- Recommendation only: (b) — real isolation is the point of section 2, and Cloud Run's privilege limits make it a dead end for the hardened path.

**Q2. Is the sandbox weakness acceptable if the answer is Cloud Run?**
- If the judge stays on Cloud Run, `rlimit` is permanent, and the honest-limits framing in the README must say so plainly.
- Recommendation only: decide this together with Q1 — "Cloud Run + documented weaker sandbox" is a legitimate answer for a trusted-college deployment, but it must be written down, not drifted into.

### The Vercel / serverless dispatch problem

**Q3. Should the web app keep calling the judge directly, or should workers pull from a queue?**
- Direct call (today): `POST /api/submissions` fire-and-forget to `/judge-async` with a 5s timeout (`app/api/submissions/route.ts:285-292`). Simple, fragile under load.
- Queue (section 1 of this plan): workers pull via `SELECT ... FOR UPDATE SKIP LOCKED`, leases, retries. Durable, more to build.
- This decision sets whether section 1's queue work is now or later.
- Recommendation only: the queue — but see Q4 for what to do this week either way.

**Q4. Minimal fix now, structural fix next — or structural only?**
- Minimal: on dispatch failure set `judge_infra_error` and leave the row `pending` instead of the terminal `runtime_error` written today (`app/api/submissions/route.ts:294-303`), let the existing 10-minute recovery sweep (`app/api/submissions/recovery.ts:20`) own it, and add a cron for the recover endpoint. This stops the data loss but leaves the fire-and-forget fragility.
- Structural: build the durable queue with leases and retries (section 1) and delete the direct call entirely.
- Recommendation only: minimal fix immediately (small, stops silent verdict loss), structural on the section-1 track.

**Q5. Who triggers recovery?**
- Nothing calls `POST /api/admin/submissions/recover` today — no cron exists anywhere. Options: Vercel Cron, an external pinger, or manual invocation.
- Recommendation only: Vercel Cron if the web app stays on Vercel; otherwise whatever scheduler lives next to the workers.

**Q6. Is the 5s dispatch timeout right?**
- 5s survives on localhost but will misfire under Vercel cold starts, real network latency, and judge load. Tune per-deployment, or delete it once a queue owns delivery?
- Recommendation only: tune per-deployment as a stopgap; delete it with the direct call when the queue lands.

Once these are answered, the build order at the end of this file, the hosting shape in `docs/deployment.md`, and the honest-limits framing in the README all become writable.

---

## 1. Judge architecture: make it durable

**Where it is now.** `POST /api/submissions` inserts a row, fires `judge-async` with a 5s timeout, and the judge works inside that request. Saturation returns 503 via an in-process `BoundedSemaphore`. If the judge dies mid-run, a 10-minute sweep marks the row `runtime_error`. `judge_infra_error` flags failures but nothing retries them.

**What to build.**

- **A Postgres-backed job queue.** Add a `judge_jobs` table (or reuse `submissions` with queue columns): `status`, `attempts`, `leased_by`, `lease_expires_at`, `created_at`. Workers claim jobs with `SELECT ... FOR UPDATE SKIP LOCKED`. This needs no new infrastructure and fits your stack. (Redis via Upstash is the alternative, but Postgres gives you transactional consistency with the verdict write.)
- **Leases with heartbeats.** A worker extends its lease while judging. If it dies, the lease expires and another worker picks the job up. This replaces the 10-minute stale sweep with something precise.
- **Automatic retry for infra errors**, with a max-attempts cap and backoff. Contestant-caused failures (CE, RE, TLE) never retry; sandbox or infrastructure failures do. This finally makes `judge_infra_error` meaningful.
- **Idempotent verdict writes.** A job finishing twice (lease expiry race) must not corrupt state. Guard writes with an attempt/version check.
- **Multiple workers and registration.** Workers pull; the web app never calls the judge directly. Show worker count and queue depth on an admin page.
- **Rejudge.** Admin can rejudge one submission, all submissions for a problem, or a whole contest. It re-enqueues and then triggers a scoreboard recompute.
- **Move rate limiting out of memory.** Per-process limits break with multiple instances. Use Redis (you already have the optional client) or Postgres.
- **Update the SSE path.** The current 1s DB-poll tick for up to 55 ticks is fine at small scale, but a long queue wait can outlast it. Make the client resume gracefully (reconnect and re-fetch).

## 2. Sandbox: make the claims true

**Where it is now.** Docker mode is solid on paper (no network, read-only root, non-root user, `cap-drop ALL`, `no-new-privileges`, seccomp, pids/memory/cpu limits). `rlimit` mode has no filesystem or network isolation and is flagged trusted-only. Seccomp provisioning is listed as a gap.

**What to build.**

- **Make a namespaced sandbox the default**, not an opt-in. Options: your existing Docker backend, or `isolate` / `nsjail`, which are what real judges use and are cheaper per run than starting a container. `isolate` with cgroups gives accurate CPU time and memory accounting, which also helps judging correctness.
- **Deployment reality check.** Cloud Run generally does not give a container the privileges needed to run Docker or nsjail. Verify this for your setup, but plan on running the judge workers on a small VM (any cheap VPS or a college machine) where you control the host. This also fits the "self-hosted" identity of the project.
- **Sandbox the compile step too.** Compilers are an attack surface: `#include` of arbitrary files, template or constexpr bombs, huge output in error messages. Apply the same limits and cap compiler output size.
- **Output and resource caps.** Hard limits on stdout/stderr size, number of processes, open files, and disk writes. Truncate and flag rather than store unbounded output.
- **Keep hidden tests unreachable.** Test data must not be readable from inside the sandbox and must never appear in any API response.
- **Adversarial test suite (this is the portfolio piece).** A folder of hostile programs per language: fork bomb, memory bomb, infinite loop, busy loop vs sleep, stdout flood, reading `/etc/passwd`, opening sockets, `ptrace`, writing outside the work dir, symlink tricks, reading other submissions' files. Each has an expected verdict. Run it in CI and document in the README what is blocked and how.
- **Threat model document.** One page: what you defend against (a malicious contestant), what you do not (a compromised host, hostile admin), and what the residual risks are.

## 3. Judging correctness

- **Special checkers.** Support a checker program per problem (testlib-style) for problems with multiple valid answers, plus floating-point tolerance comparison. Run the checker sandboxed too.
- **Interactive problems.** Interactor process connected to the contestant program via pipes, with its own limits. This is a clear marker of a serious judge.
- **Precise time and memory measurement.** Measure CPU time separately from wall time. Handle noisy borderline cases by re-running near the limit before declaring TLE. Support per-language time multipliers, and handle JVM and Go/Rust/JS memory accounting sensibly (a JVM baseline will otherwise trigger false MLE).
- **Verdict precedence and per-test results.** Define and document the rules (what wins when a program both exceeds time and crashes). Keep `case_results` consistent with them.
- **Known-verdict corpus.** For each seeded problem, keep reference submissions that should yield AC, WA, TLE, MLE, RE, and CE in each language. Run them against the real judge in CI. This catches regressions and is strong evidence the judge is correct.
- **Problem package format.** Import and export a zip (statement, tests, checker, solution, limits) with validation: every test passes the validator, the reference solution gets AC, and a brute force agrees on small cases. Even a minimal version of this shows engineering maturity.
- **Optional: subtasks / partial scoring** if you want IOI-style problems.

## 4. Contest features

- **Scoreboard correctness.** `lib/scoring.ts` already has ICPC logic and tests. Extend with property-based tests (shuffle submission order, rejudge, ties) and make sure rejudges recompute cleanly.
- **Live scoreboard** with freeze and unfreeze, including the "reveal" at the end.
- **Clarifications and announcements.** Contestants ask questions, setters answer privately or broadcast.
- **Virtual participation and practice mode** after a contest ends.
- **Team contests** if your college runs ICPC-style events.
- **Post-contest plagiarism check.** Token-based similarity (winnowing, as in MOSS) across submissions to the same problem, with a report for admins. Keep it advisory, not automatic punishment.
- **Audit log** for admin actions (rejudge, role change, problem edit, contest edit).

## 5. App security and correctness

- **Centralize authorization.** Sixteen admin handlers each calling `requireX` is easy to get wrong. Wrap handlers in one authorization helper and write an **authz matrix test**: every route against every role (anonymous, contestant, setter, admin) with the expected status code. This catches the next missing check automatically.
- **Fix the exposed routes.** `/problems/create` and arena pages are public at the proxy layer with only a client-side check. Enforce on the server.
- **Verify webhook signatures** on the Clerk webhook, if not already done.
- **Basic hardening.** Security headers and CSP, consistent input validation (Zod or similar) on every handler, and sensible request size limits (you already have `body-guard`).
- **Add `ADMIN_CLERK_IDS` to `.env.example`** and document the admin bootstrap flow.

## 6. Code health and data

- **Repair migrations.** Two `0002_*`, two `0003_*`, and a journal tracking 4 of 8 files is the kind of thing that bites during deployment. Reconcile it, verify what ran on live Neon, then add a CI check that applying all migrations to an empty database matches `schema.ts` (`drizzle-kit` can detect drift).
- **Delete dead code**: `api/app/cache.py`, the `notes` table, the legacy plaintext `invite_code`.
- **Fix doc-vs-code contradictions** (workers comment vs Dockerfile `--workers 4`, language count in the Dockerfile header). With a queue-based design the worker model changes anyway, so update docs at that point.
- **Cross-platform test runner.** Make `npm test` work on Windows (detect `python` vs `python3`) so contributors are not blocked.

## 7. Testing, CI, and quality gates

- **GitHub Actions**: lint, `tsc --noEmit`, build, TS tests, pytest, on every push and PR. You currently have no CI, and this is the cheapest credibility upgrade available.
- **Sandbox integration job** on a Linux runner with Docker: runs the adversarial suite and the known-verdict corpus.
- **End-to-end tests** (Playwright) for the main flows: sign in, register for a contest, submit, see the verdict update, see the scoreboard change.
- **Coverage reporting** on the judge and scoring code.
- A status badge row in the README. Reviewers do notice.

## 8. Observability

- **Structured logs** with a request or submission ID that follows a submission from the Next route through the queue to the worker.
- **Metrics**: queue depth, time-in-queue, judge duration (p50/p95), verdict counts, infra-error rate, worker liveness. Expose a metrics endpoint and view it in a free Grafana Cloud dashboard or similar.
- **Alerts** on queue age and infra-error rate, even if just a message to yourself.
- **Admin dashboard** page showing live queue and worker status.

## 9. Performance and reliability evidence

- **Load test** with k6 or Locust that simulates a contest: N contestants, realistic submission bursts at the start and near the end, scoreboard polling. Record throughput, queue latency p95, and error rate against worker count and machine spec. Put a table and chart in the README.
- **Chaos test**: kill a worker mid-judge, restart the database connection, and kill the judge during a burst. Show that jobs are recovered and no verdict is lost or duplicated.
- **Cost and capacity note**: how many concurrent submissions one worker handles, and what that means for a contest of 100 people.

## 10. Real usage and presentation

- **Run a real contest at IIIT Kottayam** on KOJ. Record participants, submissions, peak concurrent load, uptime, bugs found, and what you changed afterward. This is the single strongest line you can put on a resume for this project.
- **README**: architecture diagram, threat model summary, benchmark table, how to self-host in one command (Docker Compose for web + DB + judge worker), and a short demo GIF.
- **Write-up**: one post, "How KOJ judges untrusted code safely" or "What broke during our first contest." These get shared and read.
- **Honest limits section.** Keep the single-tenant, trusted-college framing. It's a strength to state clearly.

---

## Resume bullets to aim for

Fill the brackets only with measured numbers:

- Built KOJ, a self-hosted online judge (Next.js, FastAPI, Postgres) used for \[N\] contests with \[M\] participants and \[K\] submissions, \[X\]% uptime.
- Designed a durable judge queue (`SKIP LOCKED`, leases, retries) that recovers from worker failure without lost or duplicate verdicts; sustained \[N\] submissions/min with p95 queue latency of \[X\]s.
- Hardened sandboxed execution (namespaces, cgroups, seccomp) validated by a \[N\]-case adversarial suite across 7 languages.
- Implemented special checkers and interactive problems; verified judging against a \[N\]-submission known-verdict corpus in CI.

## Suggested build order (if you want one)

Queue and workers, then sandbox default plus adversarial suite, then CI and corpus, then checkers, then metrics and load test, then the contest and write-up. Do the contest before you polish extras, because real usage will tell you what actually matters.