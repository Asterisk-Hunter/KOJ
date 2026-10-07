## 2026-10-07 — deployed readiness checkpoint

Branch `feat/product-haul` is committed and pushed through `aa29fcb`. The VM source is pinned to that revision in GCS, staged as a release, and active through `/opt/koj/source`; Docker, the API, and the worker are active after a clean startup. Cloud Run `koj-api` serves revision `koj-api-00004-58z` with database and execution readiness. Vercel production is aliased to `https://koj.chandrateja.dev`; its web code predates only subsequent API/operations changes. The public health endpoint reports `db:true`.

The deployed Docker host probe passed all seven languages and isolation/resource checks. A Cloud Run-to-VM C submission canary returned accepted without an infrastructure failure. Vercel Cron was manually triggered and its production route returned 200. Live judge-worker heartbeat was fresh and the queue empty at verification. Local release checks passed: `npm test` (Python 372 passed, 13 skipped, 38 deselected, plus TypeScript suites), lint, typecheck, and build. Linux Docker tests passed before the later boot-only change.

Cloud Monitoring has enabled Cloud Run API 5xx and judge-VM CPU policies attached to an email channel for the owner-approved GCP account. Alert delivery and worker/queue freshness alerting remain unverified or absent. Redis remains optional and is not required for queue correctness.

**Launch gates remain:** production Clerk is `domain_pending` and the public sign-in still uses development keys. Five Cloudflare DNS records and production OAuth setup are outstanding. The owner now authorizes fresh Production accounts without migrating the nine development accounts or their KOJ history. Keep legacy Neon rows untouched and never run Admin Sync across the instance switch; see `docs/clerk-production-cutover.md`. A scoped Cloudflare account token is active, but its account cannot list the `chandrateja.dev` zone, so DNS changes still require access to the zone-owning account. No authenticated registration → submission → verdict → standings rehearsal, measured contest load, worker-freshness alert, or alert-delivery test has been completed. Do not declare the product live-contest ready yet.

---

## 2026-10-07 — product-readiness continuation (historical, superseded above)

Branch `feat/product-haul` still contains the previous agent's uncommitted audit patch plus this continuation. Preserve it; do not reset the worktree. Local unit tests, lint, typecheck, and production build passed during review, but rerun all four after final edits before committing. The Docker Linux test image passed 391 tests (20 skipped); a disposable Postgres queue passed 20 integration tests, including worker SIGKILL lease recovery. No production schema write or deployment occurred.

Confirmed fixes added in this continuation: a draft problem cannot be linked to two contests; contest SSE now matches live standings admission rules and versions virtual submissions; the rankings page subscribes for ended/archived virtual standings; the Docker host probe checks host-only environment markers and Docker socket reachability. Regression tests cover the shared-link and SSE paths. Deployment/threat-model documentation now identifies the Docker VM as the public-contest target rather than the undeployed Cloud Run `rlimit` worker-pool example.

Live read-only evidence: `koj.chandrateja.dev` and the Vercel alias return `db:true`; Cloud Run `koj-api` returns HTTP 200 `/health`; the VM's API, worker, and Docker services are active; one `judge_workers` heartbeat is recent; queue has no jobs. The deployed VM's **old** revision passes its Docker boundary probe and all seven language canaries, and a VM-to-Cloud-Run direct `/judge` canary returns accepted. The live migration ledger reaches the current journal tail and has two historical entries removed from this branch; no research/ML tables remain. The VM's source SHA is not in current Git history, so none of this proves the current working-tree patch in production.

**Launch gates still open:** production Clerk instance/domain DNS/SSL/mail and OAuth are pending, while the public site uses development keys; plan identity/organization migration before switching. Cloudflare DNS edit is blocked by the account's human verification and the available Wrangler token has only zone-read permission. No authenticated registration → submission → verdict → standings/admin rehearsal or measured contest load has occurred. No Monitoring policy or notification channel exists, and the current worker alert template targets an undeployed Cloud Run worker pool. Vercel Cron is configured but its execution is unverified. Redis is optional and is not configured in the local environment; do not treat it as queue infrastructure. Deploy the current branch to Vercel, Cloud Run, and the pinned VM source/image together only after release checks and an operator rollback plan, then repeat canaries and measure capacity.

---

## 2026-10-07 — live-contest readiness audit (earlier pass)

### Goal and current decision

The owner asked to treat KOJ as a product, audit all services and contest flows, and fix launch blockers. **Do not declare the product ready for a live contest yet.** Local fixes do not establish production connectivity, judge isolation, capacity, or end-to-end correctness.

Work remains uncommitted on `feat/product-haul`. No commits, pushes, deployments, or production database mutations were performed. No environment secrets were read.

### Changes made during the audit

**Judge and worker (`api/`)** — completed sub-agent pass, pending parent review:

- Queue lease checks/renewals use database wall-clock time; stale unavailable-job writes no longer clear worker state. Exhausted-job recovery is bounded with `SKIP LOCKED`, and recovery errors do not block unrelated claims.
- Database checkout/pool cleanup handles closed connections and failed initialization; connection, statement, and lock waits are bounded.
- Replaced threaded `preexec_fn` resource setup with `api/app/rlimit_exec.py`, a fresh-interpreter launcher. Setup/exec failures are classified as infrastructure failures. Process-group cleanup also runs after normal leader exit.
- Compiler signal/resource failures retry as infrastructure errors instead of contestant compilation errors; ordinary syntax errors remain CE. Aggregate execution budgets now account for test count and configured limits rather than always stopping at 60 seconds.
- Restored `api/requirements.txt`, explicitly selected rlimit in `api/Dockerfile`, added startup toolchain validation, and updated `api/README.md`. Added/updated hermetic regression tests.

**Submission, problem access, Redis, and web DB** — completed sub-agent pass, pending parent review:

- `app/api/submissions/route.ts` rechecks contest windows, registration, problem links, and access after lock waits; records admission-time timestamps; preserves atomic enqueue/cooldown and avoids fetching hidden test bodies during admission.
- Submission SSE polling is cancellation-safe, non-overlapping, wall-clock bounded, and sends terminal results immediately (`app/api/submissions/[id]/events/status-stream.ts`).
- Submission detail/SSE results allowlist fields and suppress stored submit-mode stdout/stderr, including samples, because immutable sample provenance is unavailable. Sample-run and compilation diagnostics remain available. See `app/api/submissions/public-result.ts`.
- `app/api/problems/[id]/route.ts` denies suspended users and excludes expired official contest associations.
- `lib/redis.ts` fails open on malformed configuration and bounds requests with fresh 250-ms abort signals and disabled retries; Redis remains optional, not the judge queue.
- `db/index.ts` handles idle-client errors, enables keepalive, and reuses one pool across module reloads. Added hermetic tests.

**Contest audit** — interrupted/canceled before a final sub-agent report; edits exist and require review:

- Modified registration/virtual/lifecycle policies, contest detail/clarification/event routes, admin contest mutation routes, and contest arena/detail/communication components.
- Added `app/api/admin/contests/mutation.ts`, contest lifecycle/live-contest tests, and `app/api/contests/[id]/progress/`.
- Inspected diffs show exclusive contest end boundaries, retention of problems shared with another live contest, official-only event versions including completion/contest updates, scoped cache invalidation, and virtual-aware arena navigation.
- These are working-tree changes, **not a completed or fully validated contest audit**. Review all affected contest files before relying on them.

### Validation and its limits

- Baseline before edits: `npm run lint` and `npx tsc --noEmit` completed without errors; `npm test` reported Python `273 passed, 13 skipped, 16 deselected`.
- Judge sub-agent reported `python -m pytest -q tests -rs`: **340 passed, 13 skipped**, plus Python 3.11 syntax checks and regression checks against original modules. POSIX-only tests were skipped on Windows; no Linux image/toolchain integration run occurred.
- Submission/cache sub-agent reported **35 focused hermetic tests passed** and scoped ESLint passed. Its broader TypeScript run timed out after 120 seconds. Repo-wide lint had outside-scope warnings during concurrent edits.
- An intermediate typecheck failed in `app/api/contests/lifecycle.test.ts`; the parent's later `npx tsc --noEmit` completed without errors after those edits settled.
- Parent `git diff --check` passed, with LF/CRLF warnings only, before this documentation update.
- **No production build or final combined full test/lint run after all audit edits. No browser walkthrough, live service checks, migration verification, load test, chaos test, or deployment validation.** Earlier verification below belongs to the earlier product-haul work, not this audit.

### Resume here

1. Review the interrupted contest changes and the completed judge/submission changes; finish the audit before making a readiness claim.
2. Inspect reported outside-scope blockers in `app/api/judge/run/route.ts`: active virtual participation access, per-process rate limiting, and malformed/null case validation. These findings are not yet fixed or independently verified by the parent.
3. Inspect `app/api/rankings/route.ts` cached JSON validation/version handling; shared Redis timeout fixes alone do not establish cache correctness.
4. Run final `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build`. Resolve regressions from this work, then verify browser registration/submission/verdict/standings/admin flows.
5. Build/run the Linux judge image, exercise all seven languages, and verify worker failure/lease recovery. Cloud Run rlimit remains owner-approved for trusted-college use only, without filesystem/network namespaces; JVM/Go/V8 memory caps remain soft/partial. Long jobs can have budgets of roughly 24 minutes.
6. Verify deployed worker availability, secrets/configuration, Neon migration ledger/schema, cron, monitoring, and capacity. Run an explicitly authorized rehearsal/load test against the target stack before hosting a real contest; do not invent capacity or uptime figures.
7. Reconcile stale docs: `docs/deployment.md` still references removed `api/DEPLOYMENT_CONTRACT.md`, and some older stack/feature descriptions disagree with current code.

---

## 2026-10-07 — product haul (feat/product-haul)

Branch off `main`. The coverage-slice test history from earlier sessions was folded into this branch before the work below.

### What this branch does

- Strips the KOJ-verified code-training/ML/Google-Cloud research pipeline out of this branch and out of git history. That includes the private `/v1/research` API, the research dataset/problem/run/sample tables and migrations, the research worker path in `api/app/worker.py`, the `ml/` importers and training loop, the Cloud Run research worker/sandbox deploy files, and the training-specific config/env/docs. After this, KOJ is a plain online judge.
- Regenerates the docs that the filter-repo over-deletion removed: `README.md`, `docs/status.md`, `docs/context.md`, `docs/deployment.md`. Restores `api/.env.example` and cleans the stale `ml/` entries out of `.gitignore`. Restores `app/dashboard/loading.tsx` from the committed tree after the checkout fell out of sync with HEAD during the rewrite.
- Adds page-load reveal motion (staggered `reveal-1..4` with a `reveal-up` animation and `card-lift` hover lift in `app/globals.css`, applied to the landing page, dashboard, and `PageHeader`; `prefers-reduced-motion: reduce` disables it) and a first-run onboarding checklist on `/dashboard` that clears as a new user joins an org, solves a problem, and registers for a contest.

### Verification (local, before push)

- `npx tsc --noEmit` — pass
- `npm run lint` — pass (no errors)
- `npm run build` — pass
- `npm test` — pass; TypeScript passes with the colocated suites, Python `273 passed, 13 skipped, 16 deselected`
- Python cover ~74% across the judge API after the strip; no research paths remain

### Caveats

- The live Cloud Run/Vercel/Neon deployment is still unverified. No measured load/capacity, uptime, participant, or submission figures are claimed.
- `api/DEPLOYMENT_CONTRACT.md` was removed during the strip. Its contract content now lives in `api/README.md` and `docs/deployment.md`.
