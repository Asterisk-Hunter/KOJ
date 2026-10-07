# Architecture

The implementation snapshot is in docs/status.md. The judge is a separate Python service; Next.js never executes contestant code.

## System diagram

Vercel Next.js routes
  ├─ Clerk auth and authorization
  ├─ transactional submission + judge job insert ── SQL ──┐
  ├─ admin, problem, contest, and ranking APIs            │
  └─ SSE status polling                                   │
                                                         ▼
                                                 Neon Postgres
                                            submissions / judge_jobs
                                            judge_workers / app data
                                                         ▲
                                      SQL / lease / heartbeat / verdict
                                                         │
                                      Compute Engine judge VM
                                      Docker-backed worker
                                             │
                                      compile + bounded judge run

Cloud Run FastAPI compatibility/control API provides health and compatibility HTTP routes. The judge VM runs the pull worker and private Docker-backed judge API.

The VM worker pulls from Postgres; the web app does not make judging a part of the submission request. A Cloud Run worker-pool `rlimit` example remains for trusted-audience use only and is not the public-contest target.

## Submission lifecycle

1. Next.js authenticates the user, validates submission and contest constraints, and checks the per-user/problem cooldown under a Postgres advisory lock.
2. One transaction inserts a pending submission and its queued judge job.
3. A worker claims one eligible job with SELECT FOR UPDATE SKIP LOCKED, increments the attempt, and writes a time-limited lease.
4. The worker loads the source and appropriate cases, starts judging, and renews the lease from a heartbeat thread.
5. The worker persists either the verdict or a retryable infrastructure error only if its ID, attempt, status, and lease still match.
6. Expired leases can be claimed again. Retry backoff is bounded and jobs stop after max attempts.
7. The browser receives state through a bounded SSE stream that polls Postgres and reconnects; the daily Vercel Cron only requeues old submissions with no job row.

## Components

### Next.js application

App Router pages and Route Handlers run on Vercel. Authorization is enforced in Route Handlers and protected Server Components, not solely by the Clerk proxy. Drizzle connects to Neon. Submission rows and queue rows are created transactionally.

### FastAPI and worker

FastAPI provides health and compatibility endpoints. Normal queue work runs as `python -m app.worker` on the dedicated judge VM. The worker uses psycopg and shares the Neon schema with Drizzle.

### Judge pipeline

The pipeline writes sources to a per-submission temporary directory, compiles where needed, runs each case in a fresh process, compares normalized output or invokes an optional per-problem Python checker, redacts hidden-case output, and aggregates a verdict. The checker receives a JSON object on stdin with `input`, `expected_output`, and `actual_output`; exit 0 means accept, exit 1 means reject, and another exit or timeout is an infrastructure failure. Checker source is loaded from the database, not supplied by contestants, and runs with bounded resources in the configured judge backend. Stdout/stderr capture is bounded and process groups are terminated on timeout.

The public target uses Docker containers with cgroups, namespaces, and the provisioned seccomp profile on the dedicated Linux judge VM. The optional Cloud Run `rlimit` fallback applies process limits, bounded output, file growth and descriptor caps, and wall timeout, but has no filesystem or network namespace. See `docs/threat-model.md`.

### Postgres queue

judge_jobs stores status, attempts, availability time, lease owner, expiry, heartbeat, error, and completion data. judge_workers stores host and liveness information. A unique job-per-submission constraint supports idempotent enqueue; administrative rejudge resets terminal jobs and requeues them.

### SSE and rankings

Submission and contest events are read from Postgres with bounded SSE streams. Rankings are computed from submission rows; Redis is optional for selected read-side caches and is not a queue or verdict event bus.

## Deployment

- Vercel: Next.js frontend and route handlers.
- Cloud Run service: FastAPI health and compatibility endpoints.
- Compute Engine `koj-judge` VM: Docker-backed pull worker and private judge API.
- Neon: application and queue database.

Configuration and rollout steps are in `docs/deployment.md` and `api/README.md`.

The observed project inventory on 2026-10-07 showed the Cloud Run control API Ready and the `koj-judge` VM RUNNING, with no Cloud Run worker pool listed in `asia-southeast1`. This does not prove worker service health, current deployed code, database readiness, or capacity.

## Contest and administration

Contest controls persist manual freeze state and support full or incremental reveal of post-freeze submissions. Contestants and staff can use clarification and announcement APIs; registrations support three-member teams, and post-contest virtual attempts have a fixed duration and separate standings. Admin mutations write sanitized metadata to an append-only audit log. The admin plagiarism report compares bounded recent same-problem submissions and returns advisory similarity scores without source text.

## Remaining architecture work

Interactive problem protocol and problem-package import/export/validation are not implemented. The load harness and monitoring policy templates exist, but no benchmark has been run. The live project had no Cloud Monitoring alert policies or notification channels at the 2026-10-07 inventory; the worker alert template still targets a Cloud Run worker pool and does not match the VM deployment. Do not claim capacity until measured on the target VM/Neon stack.
