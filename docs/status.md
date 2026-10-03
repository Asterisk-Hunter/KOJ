# KOJ implementation status

This is the current code-oriented snapshot. A live deployment, live Neon migration state, and a real college contest are not verified or claimed. Performance, capacity, uptime, and usage figures are withheld until measured on the deployed stack.

## Current architecture

- Next.js Route Handlers own validation, auth, transactional submission insert, and Postgres queue insert.
- Neon Postgres is the durable source of truth for submission and judge-job state.
- FastAPI exposes compatibility HTTP endpoints and health. The worker process runs python -m app.worker and pulls jobs from Postgres using SKIP LOCKED.
- Jobs use expiring leases, worker heartbeats, attempt fencing, bounded retries, and dead-letter state after the configured attempt limit.
- Cloud Run is the primary deployment target. Set JUDGE_SANDBOX_MODE=rlimit explicitly there.
- Vercel Cron runs daily orphan recovery. The cron only creates jobs for old pending/running submissions with no existing job; worker leases handle ordinary crashes.
- SSE streams poll Postgres and clients can reconnect. Redis is optional for existing read-side caches and is not used for the queue or verdict delivery.

## Roles and access

Roles remain contestant, setter, and admin in Neon. Admin and setter API routes use centralized authorization helpers. ADMIN_CLERK_IDS can bootstrap admin API access.

Suspended accounts are rejected by staff API gates, the admin layout, and the problem-authoring page. Submission and interactive-run routes also reject suspended accounts. The problem-authoring page now checks setter/admin access in a Server Component. The contest arena layout checks sign-in, live contest timing, and registration on the server. API handlers still enforce their own authorization.

## Queue and rejudge

- New submissions insert the submission and judge job atomically; no direct HTTP dispatch or five-second timeout is involved.
- Run mode judges sample cases only; submit mode judges all test cases.
- Worker claims are transactionally locked and attempts are fenced on completion/retry so stale workers cannot persist verdicts.
- Admins can rejudge one submission, a problem batch, or a contest batch. Batches are capped at 500.
- Admin observability includes queue state, oldest wait, worker heartbeat, infrastructure failures, and execution latency percentiles.

## Contest standings

ICPC-style standings include an automatic final-hour freeze and staff controls to freeze/unfreeze, reveal all post-freeze results, or reveal them incrementally. Freeze state and reveal progress are persisted and audited. Contest communication supports private/public clarifications and announcements. Registration supports teams of up to three and timed virtual participation after a contest. Official and virtual standings are separate.

## Sandbox and judge

Seven languages are supported: Python, C, C++, Java, Go, Rust, and JavaScript. Problems use exact output comparison by default, an optional finite numeric-token comparator using configured absolute and relative tolerances, or an optional Python special checker. A special checker receives JSON on stdin (`input`, `expected_output`, `actual_output`); exit 0 accepts, exit 1 rejects, and other exits/timeouts are checker infrastructure failures. Checker processes use the configured sandbox backend with bounded time, memory, and output. The runner caps captured output, limits file growth and open descriptors, uses process-group termination, and passes a minimal environment to local contestant processes. The judge image runs as non-root UID/GID 10001; this reduces container privileges but does not provide filesystem or network isolation.

Cloud Run rlimit mode has no filesystem or network namespace. It is accepted for a trusted-college environment only; do not present it as a hardened sandbox for arbitrary public users. See docs/threat-model.md and api/DEPLOYMENT_CONTRACT.md.

Incoming bodies on submission, problem/test-case authoring, contest, admin, interactive-run, and Clerk webhook write paths are streamed to explicit byte caps before JSON parsing.

Docker mode remains available on a dedicated Linux host with verified Docker, cgroup, and seccomp configuration. It is not the Cloud Run execution path.

## Database and migrations

The schema includes judge_jobs, judge_workers, submission mode, leases, attempts, retry state, per-problem output-comparison and checker settings, contest communication and participation, and append-only admin audit events. The Drizzle journal registers all checked-in migrations, including contest controls/participation, special checker, and audit-log migrations. The setter-role migration is guarded so it is safe when the merged enum is already present.

The live Neon schema and migration ledger have not been inspected as part of this work. Do not apply migrations to production until the live state is checked.

## CI and tests

GitHub Actions runs frontend lint, TypeScript checks, production build, TypeScript/Python unit tests, an empty-Postgres migration job, and a Linux judge-image job. The judge-image job runs an accepted-verdict corpus across all seven languages, Python verdict cases, and bounded rlimit probes.

The fast npm test command is cross-platform and excludes Linux integration tests. See docs/testing.md for commands and coverage.

## Not yet delivered or externally verifiable

- No interactive problem protocol, problem package export/validation workflow, or broad adversarial sandbox suite across all supported languages.
- Plagiarism reports are advisory similarity candidates, not proof or automatic enforcement. They examine a bounded recent submission sample.
- A k6 load harness and Cloud Monitoring alert-policy renderer are checked in, but no measured load benchmark, published capacity claim, deployed alert policy, or production Cloud Run smoke test exists.
- No real IIIT Kottayam contest or post-contest write-up. Those require a deployed environment, participants, and owner coordination.
- No verification of which historical migrations are recorded on live Neon.
- No authorization matrix covering every route and role; the centralized staff-access policy has unit coverage, but a full route-mocking harness remains future work.
- No coverage report or production/real-contest evidence. Do not claim capacity, uptime, or deployment verification until measured.
