# KOJ Judge Deployment Contract

## Deployment shape

Normal submissions are written by the Next.js app directly to Neon in one
transaction: a `submissions` row and a `judge_jobs` row are committed together.
Workers claim jobs with `FOR UPDATE SKIP LOCKED`, process one job at a time,
and write the verdict only if their worker ID, attempt number, and lease still
match. Workers heartbeat their leases; expired leases are eligible for another
attempt. Infrastructure errors use exponential backoff (5 seconds to 5
minutes) and stop after `max_attempts`.

Deploy the API image as two Cloud Run deployables:

- **HTTP service:** `uvicorn app.main:app`; retained for health checks and the
  authenticated compatibility endpoints.
- **Worker pool:** `python -m app.worker`; pulls the durable Postgres queue and
  needs no public URL. Set the instance count explicitly and scale after
  measuring queue latency and resource use.

Both deployables need the Neon `DATABASE_URL`. Use the same pinned image and
set `JUDGE_SANDBOX_MODE=rlimit` in Cloud Run. Keep `JUDGE_INTERNAL_SECRET`
random and private for the compatibility HTTP endpoints. The normal Next.js
submission flow does not need `FASTAPI_URL` or that secret.

## Sandbox modes

| Mode | Behaviour | Use |
|---|---|---|
| `rlimit` | Host toolchain with CPU/address-space/process/file-size/open-file limits, bounded stdout/stderr, wall timeout, and process-group kill. | Cloud Run and local fallback. No filesystem or network namespace. Trusted-college audience only. |
| `docker` | Per-run container with no network, read-only root/source, dropped capabilities, seccomp, and configured cgroup/resource limits. Fails closed if Docker is unavailable. | Dedicated Linux host with Docker daemon and verified cgroups/seccomp. |
| `auto` | Docker if the CLI exists, otherwise `rlimit`. | Development only; production should select explicitly. |

Cloud Run `rlimit` is not a hardened boundary for arbitrary public submissions.
It does not isolate filesystem or network access. A hostile program can probe
files visible to the worker OS user and attempt outbound connections. Child
processes get a minimal environment to avoid inheriting application secrets,
but environment filtering does not replace OS isolation. See
[`docs/threat-model.md`](../docs/threat-model.md).

Do not run this configuration as a public multi-tenant judge. For arbitrary
hostile code, use a dedicated Linux host with Docker or a namespace/cgroup
sandbox, and isolate judging credentials from the web application.

## Runtime limits and verdict behavior

- Request source and test-case contents are never logged. Hidden-case output is
  redacted from returned case details.
- Each stdout/stderr stream retains at most 1 MiB; exceeding the bound kills
  the process and returns `runtime_error` (or `compilation_error` for compiler
  output).
- Runtime file growth is limited to 1 MiB in `rlimit`; compile output files
  have a 64 MiB cap. Docker uses equivalent per-phase `fsize` ulimits.
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
| `JUDGE_SANDBOX_MODE` | API and worker | Set `rlimit` explicitly on Cloud Run |
| `JUDGE_INTERNAL_SECRET` | HTTP API | Shared secret for internal compatibility judge routes |
| `FASTAPI_HOST` / `PORT` | HTTP API | Bind address / Cloud Run port |
| `JUDGE_LEASE_SECONDS` | Worker | Lease lifetime; 120 seconds by default |
| `JUDGE_WORKER_POLL_SECONDS` | Worker | Idle queue poll interval; 1 second by default |
| `JUDGE_MAX_CONCURRENT` | HTTP API | Direct judge request limit; not the worker count |

Store database credentials in Secret Manager. Give the Cloud Run runtime
identity the minimum required permissions and no unrelated project roles.
Never log settings objects, DSNs, source code, stdin, or expected output.

## Operational checks

1. Apply and verify the Drizzle migrations before enabling the web app/worker.
   Historical migrations were previously only partially represented in the
   Drizzle journal. Empty-database CI validates the checked-in migration chain;
   inspect the live Neon schema and migration ledger before applying it there.
2. Deploy one worker-pool instance and submit a sample problem. Confirm the
   admin queue shows one active worker and the submission reaches a verdict.
3. Stop a worker during a long job; confirm lease expiry makes the job
   claimable again and only one attempt can commit the verdict.
4. Confirm Cloud Run explicitly reports the `rlimit` backend and that outbound
   network/filesystem access is treated as a documented residual risk.
5. Measure queue p50/p95, throughput, infra-failure rate, and worker resource
   use before increasing worker instances or scheduling a real contest.

The Vercel daily recovery cron requeues only old pending/running submissions
that have no job row. Queue leases—not the cron—are responsible for ordinary
worker crash recovery.
