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
- <http://127.0.0.1:8000/health>       — cheap liveness check

`GET /ready` checks the database and selected sandbox backend with the
`X-Judge-Secret` header. Swagger/ReDoc/OpenAPI routes are disabled by default;
set `API_EXPOSE_DOCS=true` for local development only.

## Notes

- This service is **not** a Next.js route handler. It runs in its own
  Python process — start it in a second terminal alongside `next dev`.
- CORS is tight: `http://localhost:3000` plus `FRONTEND_URL` only
  (explicit methods/headers, no credentials, never `*`, no self-origin).
- Never commit `api/.env`; only `.env.example` is tracked.

## Judge sandbox

**Public Cloud Run judging is blocked.** A zero-secret verification Job with
Cloud Run's Preview `--sandbox-launcher` succeeded with the default rootfs,
but its sandbox could see the parent image filesystem. Live probes could not
start a separate toolchain rootfs (`FetchSpec failed`), bind-mount it, or
chroot into it (`Operation not permitted`). The `cloudrun` backend in this
repository remains experimental and fails closed when its required private
rootfs cannot launch. Do not deploy a Cloud Run worker or direct `/judge`
endpoint to execute public submissions using `rlimit` or the default
Cloud Run sandbox root.

For public submissions, use a dedicated Linux judge host with the `docker`
backend, verified namespaces, cgroups, seccomp, no network, and separate
least-privilege database credentials. The Cloud Run HTTP service may host
non-executing compatibility/control endpoints, but direct `/judge` requests
must be disabled or delegated to the isolated host. The queue worker belongs
on the isolated host. Run the adversarial sandbox suite on that host before
opening submissions. No configuration guarantees zero vulnerabilities.

`rlimit` is an explicit local trusted-development
mode and must not handle public submissions. `auto` fails closed if neither
Docker nor the Cloud Run launcher is available. The authenticated `/judge`
compatibility endpoint runs at most one Cloud Run sandbox judgment at a time; normal
submissions enter the durable Postgres queue. Hidden case output is redacted
from responses. See `api/DEPLOYMENT_CONTRACT.md` for the deployment contract.
