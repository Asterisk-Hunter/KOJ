# KOJ Python judge and queue worker

The FastAPI compatibility/control API and Postgres pull worker are separate
processes from Next.js. Normal submissions enter the durable Postgres queue;
they do not depend on an HTTP request staying alive.

## Local setup

From `api/`, create a virtual environment and install dependencies:

```sh
python -m venv .venv
python -m pip install -r requirements-dev.txt
```

Activate the virtual environment using the command for your shell. Supply
`DATABASE_URL` through the process environment or an untracked local `.env`.
Never log settings or commit credentials. The development API runs with:

```sh
uvicorn app.main:app --reload --port 8000
```

`GET /health` is a cheap liveness check. `GET /ready` requires
`X-Judge-Secret` and checks database/backend readiness. API documentation
routes are disabled unless `API_EXPOSE_DOCS=true`. Direct HTTP execution is
disabled by default; the pull worker does not need it enabled.

## Production judge target

The public-contest target is the dedicated Linux judge VM with
`JUDGE_SANDBOX_MODE=docker`. It keeps database credentials in the host-side
worker and runs contestant code in restricted containers. See
`docs/threat-model.md` and `scripts/deployment/verify-docker-host.py`. Cloud Run
hosts the compatibility/control API, not the queue worker. The `rlimit` backend
is only a trusted-audience fallback: it does not isolate filesystem, network,
or same-UID credentials. Do not substitute the experimental `cloudrun` launcher.

The VM provisions a pinned seven-language sandbox image and host-side API and
worker services with `scripts/deployment/startup.sh`. The worker runs:

```sh
python -m app.worker
```

The Cloud Run worker image in `api/Dockerfile` selects `rlimit` explicitly and
is not the public judge deployment. The smaller `Dockerfile.control` is not a
judge-worker image. Supported languages are Python, C, C++, Java, Go, Rust,
and JavaScript.

Production requirements to verify before a contest:

- Keep the VM's `koj-worker.service` running and its heartbeat recent. A
  request-driven HTTP service with idle CPU throttling or scale-to-zero cannot
  reliably poll the queue. A running VM alone does not prove a healthy worker.
- Inject a least-privilege Postgres DSN, apply the queue/worker migrations, and
  verify TLS certificate/hostname validation. No migration or live connection
  is performed by the unit tests.
- Use `JUDGE_LEASE_SECONDS=120` (default) or another supported value. Workers
  renew every third of the lease; lost/expired attempts cannot publish results.
  Due expired leases are reclaimed with `SKIP LOCKED`; exhausted attempts are
  finalized in bounded batches. Daily Vercel recovery is only an orphan backstop.
- Provision enough VM memory for the compiler, host worker, and one sandbox
  container. Docker cgroups provide the per-run memory ceiling; measure
  aggregate memory and queue latency under mixed-language load.
- Run the Linux integration corpus inside the built image, then run the Docker
  boundary probes on the actual VM. Unit tests cannot establish host isolation.
- Load-test queue wait times and worker counts, monitor dead jobs, infrastructure
  errors and stale workers, and rehearse worker termination/lease recovery.
  A long valid test set may run beyond 60 seconds: its aggregate budget now
  follows the case count and per-case limit (up to roughly 24 minutes at the
  supported maxima). Leases heartbeat throughout; drain/stop budgets must not
  assume every job finishes within one minute.
- Keep the VM and its judge API private, restrict its service account and
  database role, and never mount the Docker socket into contestant containers.

The `rlimit` fallback installs per-process CPU/address-space/task/file limits
in a fresh interpreter. Docker mode uses container cgroups, seccomp, and
namespaces. Output is bounded and hidden case output is redacted from
returned/stored results.
Infrastructure failures use bounded retries and public generic error messages,
not contestant compilation/runtime blame.

## Tests

```sh
python -m pytest -q tests
python -m pytest -q -m integration integration_tests
```

The unit suite initializes only synthetic settings, does not read `.env`, and
rejects unmocked Postgres connections. The integration suite needs Linux POSIX
limits and all toolchains; Windows skips those checks. Neither command requires
a real database. `requirements.txt` supplies runtime dependencies;
`requirements-dev.txt` adds pytest, coverage, and HTTP test dependencies.
