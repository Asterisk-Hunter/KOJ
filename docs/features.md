# Features

Status reflects the checked-in implementation. Live service status and remaining work are tracked in docs/status.md.

## Implemented

- Clerk authentication with contestant, setter, and admin authorization backed by Neon roles.
- Public problem archive and detail pages with sample cases.
- Setter problem authoring, problem/test-case management, and problem import tooling.
- Contest listing, creation/editing, registration, lifecycle transitions, and arena access checks.
- ICPC-style standings, first-to-solve indicators, wrong-answer penalties, automatic final-hour masking, operator freeze/unfreeze, staged or full reveal, and bounded contest/submission SSE views.
- Contest announcements and private/public clarifications with staff response workflows.
- Team registration (up to three members) and separate timed virtual participation after a contest ends.
- Multi-language judging for Python, C, C++, Java, Go, Rust, and JavaScript.
- Per-problem exact output comparison (default) or finite numeric-token comparison with configured absolute and relative tolerances.
- Optional Python special checker per problem. The checker receives JSON containing input, expected output, and contestant output; exit 0 accepts, exit 1 rejects, and other failures are infrastructure errors. It runs through the configured judge sandbox backend with bounded resources.
- Durable Postgres queue with atomic enqueue, SKIP LOCKED claim, leases, heartbeats, retries, attempt fencing, and dead-job handling.
- Admin rejudge for one submission, problem batch, or contest batch, capped at 500 submissions.
- Suspended accounts are denied staff API/page access and submission or interactive-run requests.
- Streaming request-body byte caps protect submission, problem/test-case authoring, contest, admin, interactive-run, and Clerk webhook write paths.
- Admin queue/worker observability and a daily orphan recovery cron.
- Admin-only, advisory plagiarism similarity reports over a bounded recent sample; source code is not returned by the report API.
- Append-only, metadata-allowlisted admin action audit log.
- Opt-in k6 load-test harness and Cloud Monitoring policy renderer (not deployed or benchmarked).
- Bounded judge output, file-growth and open-descriptor limits, process-group termination, hidden-output redaction, and sanitized child environment.
- CI for lint, typecheck, build, unit tests, empty-Postgres migrations, and Linux judge integration tests.

## Security boundary

The public-contest target uses restricted Docker containers on a dedicated Linux judge VM; Cloud Run provides the compatibility/control API. The `rlimit` worker-pool example is a trusted-audience fallback without filesystem or network isolation. See `docs/threat-model.md`.

## Not implemented

- Interactive problem protocol, problem package export/validation, broad adversarial sandbox suite, full route-by-role authorization matrix, and coverage reporting.
- Measured load/capacity report, deployed external alerting, verified Vercel/Neon/worker readiness, or a real IIIT Kottayam contest write-up.
- Plagiarism reports are advisory candidates and require human review; they do not establish misconduct.

Do not claim capacity or uptime figures until measured on the deployed VM/Neon stack.
