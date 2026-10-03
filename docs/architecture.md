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
                                      Cloud Run worker pool
                                      python -m app.worker
                                             │
                                      compile + bounded judge run

Cloud Run FastAPI compatibility API provides health and legacy HTTP routes only.

Cloud Run's worker pool uses explicit instance scaling and does not expose a public HTTP endpoint. The worker pulls from Postgres; the web app does not make judging a part of the submission request.

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

FastAPI provides health and compatibility endpoints. Normal queue work runs with python -m app.worker. Each worker processes one job at a time. The worker uses psycopg and shares the Neon schema with Drizzle.

### Judge pipeline

The pipeline writes sources to a per-submission temporary directory, compiles where needed, runs each case in a fresh process, compares normalized output or invokes an optional per-problem Python checker, redacts hidden-case output, and aggregates a verdict. The checker receives a JSON object on stdin with `input`, `expected_output`, and `actual_output`; exit 0 means accept, exit 1 means reject, and another exit or timeout is an infrastructure failure. Checker source is loaded from the database, not supplied by contestants, and runs with bounded resources in the configured judge backend. Stdout/stderr capture is bounded and process groups are terminated on timeout.

Cloud Run uses rlimit: process limits, bounded output, file growth and descriptor caps, and wall timeout. It has no filesystem or network namespace. See docs/threat-model.md. Docker mode offers a stronger container setup on a dedicated Linux host with Docker, cgroups, and the seccomp profile provisioned.

### Postgres queue

judge_jobs stores status, attempts, availability time, lease owner, expiry, heartbeat, error, and completion data. judge_workers stores host and liveness information. A unique job-per-submission constraint supports idempotent enqueue; administrative rejudge resets terminal jobs and requeues them.

### SSE and rankings

Submission and contest events are read from Postgres with bounded SSE streams. Rankings are computed from submission rows; Redis is optional for selected read-side caches and is not a queue or verdict event bus.

## Deployment

- Vercel: Next.js frontend and route handlers.
- Cloud Run service: FastAPI health and compatibility endpoints.
- Cloud Run worker pool: pull worker, with explicit instance count.
- Neon: application and queue database.

Configuration and rollout steps are in docs/deployment.md and api/DEPLOYMENT_CONTRACT.md.

## Contest and administration

Contest controls persist manual freeze state and support full or incremental reveal of post-freeze submissions. Contestants and staff can use clarification and announcement APIs; registrations support three-member teams, and post-contest virtual attempts have a fixed duration and separate standings. Admin mutations write sanitized metadata to an append-only audit log. The admin plagiarism report compares bounded recent same-problem submissions and returns advisory similarity scores without source text.

## Remaining architecture work

Interactive problem protocol and problem-package import/export/validation are not implemented. The load harness and monitoring policy templates exist, but no benchmark has been run and no alert policy has been deployed. Do not claim filesystem/network isolation or measured capacity for Cloud Run rlimit deployments.
