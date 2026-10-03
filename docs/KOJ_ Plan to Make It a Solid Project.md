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

## Owner decisions (recorded 2026-10-03)

The owner answered the six questions below and asked to continue with the full project. The
deployment is Cloud Run-first, and the choices are recorded here so future work does not
re-ask or silently change them:

1. **Cloud Run is the primary judge host.** A VM may be considered later if the threat
   model changes.
2. **The `rlimit` limitation is accepted for the trusted-college deployment**, with the
   weaker isolation documented plainly. Do not describe it as safe for arbitrary public
   submissions.
3. **Use a Postgres pull queue.**
4. **Implement the structural queue now**, not a direct-dispatch stopgap.
5. **Use Vercel Cron as a daily orphan-recovery backstop**; leases are the primary worker
   crash recovery mechanism.
6. **Remove the 5-second HTTP dispatch path** from normal submissions; the queue owns
   delivery.

The original questions and options remain below for traceability; they are resolved, not
open.

## Questions asked and resolved

### Backend hosting

**Q1. Where does the FastAPI judge run?**
- (a) Google Cloud Run — simplest to operate, but forces `rlimit`, the weaker sandbox with no filesystem or network namespace (`api/app/judge.py:464-465`); cold starts add latency to every verdict.
- (b) A small VPS (Hetzner / DigitalOcean / Fly) — real Docker or nsjail isolation, fits the self-hosted identity, costs more in ops.
- (c) A college machine / LAN box — free, matches "self-hosted", needs a public tunnel and uptime you don't control.
- Owner decision: (a), with the trusted-college `rlimit` limitation accepted and documented.

**Q2. Is the sandbox weakness acceptable if the answer is Cloud Run?**
- If the judge stays on Cloud Run, `rlimit` is permanent, and the honest-limits framing in the README must say so plainly.
- Owner decision: accept the weaker isolation for the trusted-college deployment; do not claim arbitrary hostile-code safety.

### The Vercel / serverless dispatch problem

**Q3. Should the web app keep calling the judge directly, or should workers pull from a queue?**
- Before this project pass, `POST /api/submissions` fire-and-forget to `/judge-async` with a 5s timeout. Simple, fragile under load.
- Queue (section 1 of this plan): workers pull via `SELECT ... FOR UPDATE SKIP LOCKED`, leases, retries. Durable, more to build.
- This decision sets whether section 1's queue work is now or later.
- Owner decision: use the Postgres pull queue.

**Q4. Minimal fix now, structural fix next — or structural only?**
- Minimal: on dispatch failure set `judge_infra_error` and leave the row `pending` instead of the terminal `runtime_error` written today (`app/api/submissions/route.ts:294-303`), let the existing 10-minute recovery sweep (`app/api/submissions/recovery.ts:20`) own it, and add a cron for the recover endpoint. This stops the data loss but leaves the fire-and-forget fragility.
- Structural: build the durable queue with leases and retries (section 1) and delete the direct call entirely.
- Owner decision: implement the structural queue now and remove HTTP dispatch from normal submissions.

**Q5. Who triggers recovery?**
- Before this project pass, no scheduler called the recovery endpoint. Options were Vercel Cron, an external pinger, or manual invocation.
- Owner decision: use daily Vercel Cron only as an orphan-recovery backstop; worker leases are primary recovery.

**Q6. Is the 5s dispatch timeout right?**
- 5s survives on localhost but will misfire under Vercel cold starts, real network latency, and judge load. Tune per-deployment, or delete it once a queue owns delivery?
- Owner decision: remove the 5-second dispatch path from normal submissions.

Once these are answered, the build order at the end of this file, the hosting shape in `docs/deployment.md`, and the honest-limits framing in the README all become writable.

---

## 1. Judge architecture: make it durable

**Where it is now.** `POST /api/submissions` transactionally inserts a pending row and a Postgres `judge_jobs` row. Cloud Run pull workers claim with `SKIP LOCKED`, heartbeat expiring leases, retry infrastructure failures with bounded backoff, and fence stale attempts from writing verdicts. The daily recovery cron only repairs old orphan submissions. The authenticated `/judge` and `/judge-async` HTTP routes remain compatibility endpoints.

**What to build.**

- **Postgres queue, leases, retries, and fenced writes.** Implemented in the web submission transaction and pull worker. Redis is not in the judge path.
- **Worker registration and admin queue visibility.** Implemented with worker heartbeats, queue counts, and oldest-wait metrics.
- **Rejudge.** Implemented for one submission, a problem, or a contest, with a 500-submission batch cap.
- **Rate limiting.** The submission cooldown is serialized with a Postgres advisory lock, not per-process memory.
- **SSE recovery.** EventSource reconnects and the endpoint re-reads Postgres; the stream also sends a retry interval.

## 2. Sandbox: make the claims true

**Where it is now.** Cloud Run uses `rlimit`, explicitly documented as lacking filesystem and network namespaces and suitable only for the trusted-college audience. The host backend now caps compiler/runtime file growth and output, open files, process count, memory, and time. A threat model and a small Linux integration corpus are in place; broad adversarial coverage and deployed verification remain outstanding.

**Owner decision governs deployment.** Cloud Run with `rlimit` is the selected trusted-college target. The namespaced sandbox and VM suggestions below describe a possible future change if the threat model expands; they are not prerequisites for the current owner-approved deployment choice. Do not claim arbitrary-public-code isolation for `rlimit`.

**What to build.**

- **Make a namespaced sandbox the default**, not an opt-in. Options: your existing Docker backend, or `isolate` / `nsjail`, which are what real judges use and are cheaper per run than starting a container. `isolate` with cgroups gives accurate CPU time and memory accounting, which also helps judging correctness.
- **Future deployment alternative.** If KOJ later needs stronger isolation for arbitrary hostile submissions, evaluate a dedicated Linux VM with Docker or a namespace/cgroup sandbox. This supersedes neither the owner's current Cloud Run choice nor the documented trusted-college limitation.
- **Expand sandbox probes.** Compile/runtime file and output caps and resource limits are implemented, but broad adversarial tests (filesystem, network, process-tree, and cross-language resource probes) are still needed.
- **Keep hidden tests unreachable.** Test data must not be readable from inside the sandbox and must never appear in any API response.
- **Adversarial test suite (this is the portfolio piece).** A folder of hostile programs per language: fork bomb, memory bomb, infinite loop, busy loop vs sleep, stdout flood, reading `/etc/passwd`, opening sockets, `ptrace`, writing outside the work dir, symlink tricks, reading other submissions' files. Each has an expected verdict. Run it in CI and document in the README what is blocked and how.
- **Threat model document.** One page: what you defend against (a malicious contestant), what you do not (a compromised host, hostile admin), and what the residual risks are.

## 3. Judging correctness

- **Checkers.** Per-problem finite numeric-token comparison with bounded absolute/relative tolerance is implemented. Support a sandboxed checker program per problem (testlib-style) for problems with multiple valid answers; run the checker in the same execution boundary as submissions.
- **Interactive problems.** Interactor process connected to the contestant program via pipes, with its own limits. This is a clear marker of a serious judge.
- **Precise time and memory measurement.** Measure CPU time separately from wall time. Handle noisy borderline cases by re-running near the limit before declaring TLE. Support per-language time multipliers, and handle JVM and Go/Rust/JS memory accounting sensibly (a JVM baseline will otherwise trigger false MLE).
- **Verdict precedence and per-test results.** Define and document the rules (what wins when a program both exceeds time and crashes). Keep `case_results` consistent with them.
- **Known-verdict corpus.** CI currently checks AC for all seven languages and Python WA, TLE, RE, and CE. Expand non-AC verdict coverage across the supported languages and include MLE.
- **Problem package format.** Import and export a zip (statement, tests, checker, solution, limits) with validation: every test passes the validator, the reference solution gets AC, and a brute force agrees on small cases. Even a minimal version of this shows engineering maturity.
- **Optional: subtasks / partial scoring** if you want IOI-style problems.

## 4. Contest features

- **Scoreboard correctness.** `lib/scoring.ts` already has ICPC logic and tests. Extend with property-based tests (shuffle submission order, rejudge, ties) and make sure rejudges recompute cleanly.
- **Operator-controlled scoreboard freeze/unfreeze and staged reveal.** The current scoreboard automatically masks post-freeze accepted submissions during the final hour and shows full results after contest end; manual freeze controls and an explicit reveal action remain future work.
- **Clarifications and announcements.** Contestants ask questions, setters answer privately or broadcast.
- **Virtual participation and practice mode** after a contest ends.
- **Team contests** if your college runs ICPC-style events.
- **Post-contest plagiarism check.** Token-based similarity (winnowing, as in MOSS) across submissions to the same problem, with a report for admins. Keep it advisory, not automatic punishment.
- **Audit log** for admin actions (rejudge, role change, problem edit, contest edit).

## 5. App security and correctness

- **Centralize authorization.** Sixteen admin handlers each calling `requireX` is easy to get wrong. Wrap handlers in one authorization helper and write an **authz matrix test**: every route against every role (anonymous, contestant, setter, admin) with the expected status code. This catches the next missing check automatically.
- **Fix the exposed routes.** `/problems/create` and arena pages are public at the proxy layer with only a client-side check. Enforce on the server.
- **Verify webhook signatures** on the Clerk webhook, if not already done.
- **Basic hardening.** Security headers and streaming request-size limits now cover the main submission, authoring, contest, admin, interactive-run, and webhook write paths. Complete route-by-route runtime schema validation and a tested CSP remain future work.
- `ADMIN_CLERK_IDS` is present in the root `.env.example`; document and configure it in the deployment environment to bootstrap the first admin.

## 6. Code health and data

- **Repair migrations.** Two `0002_*`, two `0003_*`, and a journal tracking 4 of 8 files is the kind of thing that bites during deployment. Reconcile it, verify what ran on live Neon, then add a CI check that applying all migrations to an empty database matches `schema.ts` (`drizzle-kit` can detect drift).
- **Delete dead code**: `api/app/cache.py`, the `notes` table, the legacy plaintext `invite_code`.
- **Fix doc-vs-code contradictions** (workers comment vs Dockerfile `--workers 4`, language count in the Dockerfile header). With a queue-based design the worker model changes anyway, so update docs at that point.
- **Cross-platform test runner.** Make `npm test` work on Windows (detect `python` vs `python3`) so contributors are not blocked.

## 7. Testing, CI, and quality gates

- **GitHub Actions**: implemented for lint, typecheck, build, TypeScript/Python unit tests, and migration apply on pushes and PRs.
- **Sandbox integration job** on a Linux runner: implemented with the `rlimit` known-verdict corpus and bounded timeout/file-growth probes; broad adversarial coverage remains.
- **End-to-end tests** (Playwright) for the main flows: sign in, register for a contest, submit, see the verdict update, see the scoreboard change.
- **Coverage reporting** on the judge and scoring code.
- A status badge row in the README. Reviewers do notice.

## 8. Observability

- **Structured logs** with a request or submission ID that follows a submission from the Next route through the queue to the worker.
- **Metrics**: the admin observability page now shows queue depth/age, worker liveness, verdicts, judge duration p50/p95, and infrastructure failures. Alerts, external metrics export, and load-tested thresholds remain.
- **Alerts** on queue age and infra-error rate, even if just a message to yourself.
- **Admin dashboard** for queue and worker status is implemented.

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
