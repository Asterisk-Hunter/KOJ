# KOJ Judge Deployment Contract

## Deployment shape

Normal submissions are written by the Next.js app directly to Neon in one
transaction: a `submissions` row and a `judge_jobs` row are committed together.
Workers claim jobs with `FOR UPDATE SKIP LOCKED`, process one job at a time,
and write the verdict only if their worker ID, attempt number, and lease still
match. Workers heartbeat their leases; expired leases are eligible for another
attempt. Infrastructure errors use exponential backoff (5 seconds to 5
minutes) and stop after `max_attempts`.

The current trusted-college configuration described below must not accept
arbitrary public submissions. For public judging, the intended split is:

- **Cloud Run HTTP service:** `uvicorn app.main:app` for health and
  non-executing authenticated compatibility/control endpoints. Direct
  `/judge` execution stays disabled until it delegates to the isolated host.
- **Dedicated Linux judge host:** `python -m app.worker` with
  `JUDGE_SANDBOX_MODE=docker`, verified Docker daemon, cgroups, seccomp, and
  network-disabled per-run containers. It pulls the Postgres queue and needs
  no public URL.

Use separate least-privilege Neon roles and identities for the API and judge
host. Keep `JUDGE_INTERNAL_SECRET` random and private for compatibility
endpoints. Normal Next.js submissions insert queue jobs directly and do not
need `FASTAPI_URL` or that secret. The direct `/judge` endpoint still executes
code in the API process if called; configure it to fail closed on Cloud Run
until delegation is implemented.

## Sandbox modes

| Mode | Behaviour | Use |
|---|---|---|
| `cloudrun` | Experimental Cloud Run Preview launcher that requires a private toolchain rootfs; fails closed when it cannot start. | Not deployable for public judging in the tested environment. |
| `rlimit` | Host toolchain with CPU/address-space/process/file-size/open-file limits, bounded stdout/stderr, wall timeout, and process-group kill. | Explicit local trusted-development mode only. Never use for public submissions. |
| `docker` | Per-run container with no network, read-only root/source, dropped capabilities, seccomp, and configured cgroup/resource limits. Fails closed if Docker is unavailable. | Dedicated Linux host with Docker daemon and verified cgroups/seccomp. |
| `auto` | Docker if available, then Cloud Run launcher; otherwise fails closed. | Development only; production should select explicitly. |

The Cloud Run Preview prototype uses a private rootfs built before application
code is copied, tar-only source handoff, and default-denied egress. Live
verification showed the default sandbox root can read parent image files, while
launching the private rootfs fails with `FetchSpec failed: loading container:
file does not exist`. Root bind mounting failed; chroot was denied with
`Operation not permitted`. Do not switch the backend to the default root.
Cloud Run's sandbox CLI has no documented per-sandbox aggregate CPU, memory,
or PID quota flags, and sandboxes share instance resources. `rlimit` lacks
filesystem, process, metadata, and network isolation. Neither mode currently
meets the public hostile-code threat model in this deployment. See
[`docs/threat-model.md`](../docs/threat-model.md).

Do not enable public submissions until the dedicated judge host has passed
deployed adversarial, language, resource, and secret-isolation probes. There
is no zero-vulnerability guarantee.

## Runtime limits and verdict behavior

- Request source and test-case contents are never logged. Hidden-case output is
  redacted from returned case details.
- Each stdout/stderr stream retains at most 1 MiB; exceeding the bound kills
  the process and returns `runtime_error` (or `compilation_error` for compiler
  output).
- Runtime file growth is limited to 1 MiB in `rlimit` and `cloudrun`;
  compile output files have a 64 MiB cap. Docker uses equivalent per-phase
  `fsize` ulimits. Cloud Run also caps exported archives at 512 MiB.
- Open file descriptors are capped at 256. Process count, CPU, memory, and wall
  timeout limits are backend-dependent; see `api/app/judge.py`.
- Verdicts are decided in test-case order. A non-zero exit, timeout, output
  flood, or incorrect output stops that case; the first failing case sets the
  submission verdict. Compile/sandbox infrastructure failures remain separate
  from contestant verdicts.

`JUDGE_MAX_CONCURRENT` bounds only direct synchronous `/judge` requests per
API process. Queue workers are sequential per instance; worker-pool instance
count controls queue parallelism.

## Environment

| Variable | Required by | Purpose |
|---|---|---|
| `DATABASE_URL` | API and worker | Neon pooled connection string with TLS |
| `JUDGE_SANDBOX_MODE` | API and worker | `docker` on the dedicated host; Cloud Run direct execution remains disabled |
| `JUDGE_INTERNAL_SECRET` | HTTP API | Shared secret for internal compatibility judge routes |
| `FASTAPI_HOST` / `PORT` | HTTP API | Bind address / Cloud Run port |
| `JUDGE_LEASE_SECONDS` | Worker | Lease lifetime; 120 seconds by default |
| `JUDGE_WORKER_POLL_SECONDS` | Worker | Idle queue poll interval; 1 second by default |
| `JUDGE_MAX_CONCURRENT` | HTTP API | Direct judge request limit; not the worker count |

Store database credentials in Secret Manager. The database client defaults to
`sslmode=verify-full` with the system CA bundle even when the DSN says
`sslmode=require`; `DATABASE_TLS_VERIFY=false` is only for local development.
Use separate least-privilege database roles and dedicated
identities for the API and worker. Give each identity access only to its own
database secret and no unrelated project roles. Public `/health` is a
cheap liveness response; `/ready` checks DB and backend only with
`X-Judge-Secret`. The OpenAPI, Swagger, and ReDoc routes are disabled unless
`API_EXPOSE_DOCS=true` is explicitly set for local development.
Never log settings objects, DSNs, source code, stdin, or expected output.

## Operational checks

1. Apply and verify the Drizzle migrations before enabling the web app/worker.
   Historical migrations were previously only partially represented in the
   Drizzle journal. Empty-database CI validates the checked-in migration chain;
   inspect the live Neon schema and migration ledger before applying it there.
2. Deploy one Docker worker on the dedicated Linux host and submit a sample
   problem. Confirm the
   admin queue shows one active worker and the submission reaches a verdict.
3. Stop a worker during a long job; confirm lease expiry makes the job
   claimable again and only one attempt can commit the verdict.
4. Verify Docker denies filesystem escape, network access, privilege gain,
   process/memory abuse, and cross-submission reads on the deployed host.
5. Measure queue p50/p95, throughput, infra-failure rate, and worker resource
   use before increasing worker instances or scheduling a real contest.

The Vercel daily recovery cron requeues only old pending/running submissions
that have no job row. Queue leases—not the cron—are responsible for ordinary
worker crash recovery.

## Private research evaluation

The feature-branch research API is a separate private surface under
`/v1/research`; it does not create contestant submissions or return test
content. Empty `TRAINING_API_SECRET` disables those routes. Enable it only
after the matching research migrations are applied and the research API is
deployed as a private Cloud Run service that requires IAM authentication.
Grant `roles/run.invoker` only to the GPU VM service account; it must also
present the separate `TRAINING_API_SECRET`. Set `TRAINING_WORKER_ENABLED=true`
only on the isolated Docker VM worker, which does not receive the API secret.
Restrict the dataset registry with `TRAINING_ORGANIZATION_ID`, and keep
Cloud Run /judge execution disabled. Research candidates use the same
server-side sandbox, bounded single active slot, retries, and hidden-test
redaction policy; never route them through caller-supplied `/judge` cases.
See `ml/README.md` for the owner-operated import, quota, budget, and
verification runbook.
