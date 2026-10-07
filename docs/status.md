# Implementation Status — `feat/product-haul` (as of 2026-10-07)

> Single source of truth for what is implemented vs planned on branch `feat/product-haul`. Factual as of the current commit. See also `docs/overview.md` for project context and `docs/features.md` for the implemented-vs-planned split.

---

## Summary

KOJ is a contest hosting platform and problem archive: Next.js on Vercel, FastAPI compatibility/control API on Cloud Run, Neon Postgres, Clerk auth, and a durable Postgres pull queue with a Docker-backed worker on a dedicated Compute Engine VM. Durable judging, sandbox hardening, contest/admin surfaces, SSE, and CI are implemented in the codebase. The branch's API and VM changes are deployed and the web code is live; authenticated contest rehearsal, production Clerk setup, worker-freshness alerting, alert-delivery verification, and measured capacity remain outstanding.

- The committed branch passed `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `npm test` before this documentation update. Run the full release gate again before committing or deploying.

## Observed deployment inventory — 2026-10-07

- The configured GCP project has a Ready Cloud Run `koj-api` service at revision `koj-api-00004-58z`. Its authenticated `/ready` reports database and execution readiness; an unauthenticated GET to `/health` returns HTTP 200 with `{"status":"ok"}`.
- The project has one `koj-judge` Compute Engine VM in `asia-southeast1-b`, state `RUNNING`, machine type `e2-medium`. `koj-worker.service`, `koj-api.service`, and Docker reported active; one `judge_workers` row had a heartbeat within three minutes.
- No Cloud Run worker pool was listed in `asia-southeast1`; the Docker VM is the worker. Cloud Monitoring has enabled Cloud Run API 5xx and judge-VM CPU alert policies attached to an email channel. Worker-freshness alerting and alert delivery are unverified.
- The VM's recorded source SHA is `aa29fcb`, matching the committed branch. Its deployed Docker host probe passed all seven languages and filesystem/network/metadata/secret, timeout, output, PID, and memory checks. A Cloud Run `/judge` C canary returned an accepted verdict with no infrastructure failure.
- `https://koj.chandrateja.dev/api/health` and `https://koj-livid.vercel.app/api/health` returned `db:true`. Vercel production serves the branch's web code; later API/operations-only commits did not change it. A manual Vercel Cron trigger returned HTTP 200 in production logs. An authenticated submission flow was not verified.
- Live Neon had a recent worker heartbeat, no queued jobs, all current journal timestamps through `0013_api_rate_limits`, and no `research_%` or `ml_%` tables. Its migration ledger also contains two older historical entries absent from this rewritten branch; do not run migrations blindly.
- The public sign-in serves Clerk development keys. Clerk has a production instance for `koj.chandrateja.dev`, but `clerk deploy status` reports missing DNS/SSL/mail records and incomplete Google/GitHub OAuth. Existing development identities and Neon memberships must not be silently replaced.

These observations establish service/canary behavior, not authenticated contest readiness, capacity, uptime, or alert delivery.

---

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
- Admin queue/worker observability and a configured Vercel Cron route for daily orphan recovery.
- Admin-only, advisory plagiarism similarity reports over a bounded recent sample; source code is not returned by the report API.
- Append-only, metadata-allowlisted admin action audit log.
- Opt-in k6 load-test harness and deployed Cloud Monitoring API 5xx/VM CPU policies (not benchmarked or delivery-tested).
- Bounded judge output, file-growth and open-descriptor limits, process-group termination, hidden-output redaction, and sanitized child environment.
- CI for lint, typecheck, build, unit tests, empty-Postgres migrations, and Linux judge integration tests.

UI work on this branch: page-load reveal motion with staggered cards and lifts (reduced-motion safe), and a first-run onboarding checklist on `/dashboard` that clears as a new user joins an org, solves a problem, and registers for a contest.

---

## Security boundary

The public-contest target uses restricted Docker containers on the dedicated judge VM. The Cloud Run `rlimit` worker-pool example has no filesystem or network namespace and is for a trusted audience only. See `docs/threat-model.md`.

---

## Not implemented

- Interactive problem protocol, problem package export/validation, broad adversarial sandbox suite, full route-by-role authorization matrix, and coverage reporting.
- Measured load/capacity report, worker-freshness alerting, alert-delivery verification, production Clerk cutover, authenticated end-to-end contest rehearsal, or a real IIIT Kottayam contest write-up.
- Plagiarism reports are advisory candidates and require human review; they do not establish misconduct.

Do not claim capacity or uptime figures until measured on the deployed VM/Neon stack.

---

---

## Links

- Overview: `docs/overview.md`
- Architecture: `docs/architecture.md`
- Features (implemented vs planned): `docs/features.md`
- Stack: `docs/stack.md`
- Testing: `docs/testing.md`
- Deployment: `docs/deployment.md`
- Threat model: `docs/threat-model.md`
- Problem setter guide: `docs/problem-setter-guide.md`
- User guide: `docs/user-guide.md`
