# Features

Status reflects the checked-in implementation. Live service status and remaining work are tracked in docs/status.md.

## Implemented

- Clerk authentication with contestant, setter, and admin authorization backed by Neon roles.
- Public problem archive and detail pages with sample cases.
- Setter problem authoring, problem/test-case management, and problem import tooling.
- Contest listing, creation/editing, registration, lifecycle transitions, and arena access checks.
- ICPC-style standings, first-to-solve indicators, wrong-answer penalties, an automatic final-hour freeze that masks post-freeze accepted submissions until contest end, and bounded contest/submission SSE views.
- Multi-language judging for Python, C, C++, Java, Go, Rust, and JavaScript.
- Per-problem exact output comparison (default) or finite numeric-token comparison with configured absolute and relative tolerances.
- Durable Postgres queue with atomic enqueue, SKIP LOCKED claim, leases, heartbeats, retries, attempt fencing, and dead-job handling.
- Admin rejudge for one submission, problem batch, or contest batch, capped at 500 submissions.
- Suspended accounts are denied staff API/page access and submission or interactive-run requests.
- Streaming request-body byte caps protect submission, problem/test-case authoring, contest, admin, interactive-run, and Clerk webhook write paths.
- Admin queue/worker observability and a daily orphan recovery cron.
- Bounded judge output, file-growth and open-descriptor limits, process-group termination, hidden-output redaction, and sanitized child environment.
- CI for lint, typecheck, build, unit tests, empty-Postgres migrations, and Linux judge integration tests.

## Security boundary

Cloud Run uses rlimit mode, which limits process resources but does not isolate filesystem or network access. KOJ's supported deployment is trusted-college only, not arbitrary public multi-tenant execution. See docs/threat-model.md.

## Not implemented

- Sandboxed programmable special checkers and interactive problems. Floating-point tolerance comparison is implemented for whitespace-separated numeric and text tokens.
- Operator-controlled freeze/unfreeze and staged reveal, clarifications, team participation, virtual participation, plagiarism reporting, and admin audit log. The automatic final-hour freeze masking is implemented; there are no manual freeze controls.
- Measured load/capacity report, external alerting, production Cloud Run verification, or a real IIIT Kottayam contest write-up.

Do not claim capacity or uptime figures until measured on the deployed Cloud Run/Neon stack.
