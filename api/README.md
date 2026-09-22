# KOJ API

Minimal FastAPI service that lives alongside the Next.js app in this repo.
It is a **separate process** from `next dev` and runs on its own port
(default `8000`, while Next.js stays on `3000`).

## 1. Create a virtualenv

Windows (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\activate
```

macOS / Linux:

```bash
python -m venv .venv
source .venv/bin/activate
```

## 2. Install dependencies

```bash
pip install -r api/requirements.txt
```

## 3. Configure environment

Copy the example file and fill in your Neon connection string (the same
`DATABASE_URL` used by the Next.js app in `.env.local`):

Windows:

```powershell
copy api\.env.example api\.env
```

macOS / Linux:

```bash
cp api/.env.example api/.env
```

Then edit `api/.env`:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
FASTAPI_HOST=127.0.0.1
FASTAPI_PORT=8000
```

> The `DATABASE_URL` placeholder is intentionally invalid — replace
> `USER`, `PASSWORD`, `HOST`, and `DB` with your real Neon values.

## 4. Run the service

From inside the `api/` directory (so the relative `.env` file is found):

```bash
cd api
uvicorn app.main:app --reload --port 8000
```

Then open:

- <http://127.0.0.1:8000/>             — service index
- <http://127.0.0.1:8000/health>       — liveness + DB readiness
- <http://127.0.0.1:8000/docs>         — interactive Swagger UI

## Notes

- This service is **not** a Next.js route handler. It runs in its own
  Python process — start it in a second terminal alongside `next dev`.
- CORS is tight: `http://localhost:3000` plus `FRONTEND_URL` only
  (explicit methods/headers, no credentials, never `*`, no self-origin).
- Never commit `api/.env`; only `.env.example` is tracked.

## Judge sandbox (Docker-only, fail-closed)

Compilation and execution both run in per-case `docker run` containers
with fixed flags: `--network none`, `--read-only`, non-root
`--user 65534:65534`, `--cap-drop ALL`, `no-new-privileges`,
repo-managed seccomp profile
(`--security-opt seccomp=/etc/koj/seccomp-koj.json`, provisioned from
`api/seccomp-koj.json`; missing/invalid profile fails closed),
`--pids-limit`, `--memory`/`--memory-swap`, `--cpus`, file-write ulimit,
read-only source mount (`/sandbox:ro`) plus a writable exec tmpfs at
`/scratch` for build artifacts (C/C++ binaries, Java classes) and a
noexec `/tmp`, per-run timeout with forced `docker rm -f` cleanup on
every timeout/exception path, `--rm`, `--pull never`, full-UUID
container names, and bounded stdout/stderr. C/C++ add
stack-protector/FORTIFY hardening; Java requires `class Solution`
(comment/string aware) with classes separated to `/scratch`. Exit
137/-9 maps to `memory_limit_exceeded`. No request field can set
images, mounts, or flags — images come only from
`JUDGE_DOCKER_IMAGE_*` env vars (see `api/.env.example`).

Concurrency is bounded (`JUDGE_MAX_CONCURRENT`, default 4):
saturated `/judge`/`/judge-async` callers get `503` + `Retry-After`
instead of queueing. `/judge-async` accepts an optional
`Idempotency-Key` header and dedupes by submission ID under a
non-blocking advisory lock (duplicate after completion replays the
stored status). Hidden test cases (`is_sample=false`, the default)
get redacted stdout/stderr; infra failures persist as retryable
`pending` + `judge_infra_error=true` (never a false contestant
`runtime_error`; see `JudgeResponse.infra_error`). Full host,
provisioning, and evidence matrix: `api/DEPLOYMENT_CONTRACT.md`.

The Docker host must have the daemon running, the seccomp profile
provisioned, and all three images pre-pulled (`docker pull
python:3.11-slim gcc:13-bookworm eclipse-temurin:17-jdk-jammy`, or
your configured overrides). Without Docker, every judgment returns an
infra-flagged error ("judge sandbox unavailable") — including on
Cloud Run, which cannot run a Docker daemon. Production judging needs
a VM/GCE host with Docker (or an equivalent container-isolated
runner), not Cloud Run.
