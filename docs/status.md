# Implementation Status — `feat/product-haul` (as of 2026-10-07)

> Single source of truth for what is implemented vs planned on branch `feat/product-haul`. Factual as of the current commit. See also `docs/overview.md` for project context and `docs/features.md` for the implemented-vs-planned split.

---

## Summary

KOJ is a contest hosting platform and problem archive: Next.js on Vercel, FastAPI on Cloud Run, Neon Postgres, Clerk auth, and a durable Postgres pull queue with Cloud Run workers. Durable judging, sandbox hardening with adversarial corpus and probes, contest + admin surfaces, SSE, and CI are implemented. Live Cloud Run/Vercel/Neon deployment, a real contest, and measured load/capacity are unverified.

- `npx tsc --noEmit` — pass
- `npm run lint` — pass (no new errors)
- `npm run build` — pass
- `npm test` — pass (TypeScript + hermetic Python unit tests)
- Python cover ~74% across the judge API.

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
- Admin queue/worker observability and a daily orphan recovery cron.
- Admin-only, advisory plagiarism similarity reports over a bounded recent sample; source code is not returned by the report API.
- Append-only, metadata-allowlisted admin action audit log.
- Opt-in k6 load-test harness and Cloud Monitoring policy renderer (not deployed or benchmarked).
- Bounded judge output, file-growth and open-descriptor limits, process-group termination, hidden-output redaction, and sanitized child environment.
- CI for lint, typecheck, build, unit tests, empty-Postgres migrations, and Linux judge integration tests.

UI work on this branch: page-load reveal motion with staggered staggered cards and lifts (reduced-motion safe), and a first-run onboarding checklist on `/dashboard` that clears as a new user joins an org, solves a problem, and registers for a contest.

---

## Security boundary

Cloud Run uses rlimit mode, which limits process resources but does not isolate filesystem or network access. KOJ's supported deployment is trusted-college only, not arbitrary public multi-tenant execution. See docs/threat-model.md.

---

## Not implemented

- Interactive problem protocol, problem package export/validation, broad adversarial sandbox suite, full route-by-role authorization matrix, and coverage reporting.
- Measured load/capacity report, deployed external alerting, production Cloud Run verification, or a real IIIT Kottayam contest write-up.
- Plagiarism reports are advisory candidates and require human review; they do not establish misconduct.

Do not claim capacity or uptime figures until measured on the deployed Cloud Run/Neon stack.

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
