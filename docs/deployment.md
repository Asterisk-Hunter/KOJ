# Deployment

## Target environments

### Local development

```bash
Next.js frontend (npm run dev)           port 3000
FastAPI service (uvicorn --reload)       port 8000
Neon Postgres                            DATABASE_URL
```

Both Next.js and the FastAPI service connect to the same Neon database. The FastAPI service is a separate Python process; it is not a Next.js route handler.

### Production

- **Vercel** — Next.js app, route handlers, and cron target.
- **Cloud Run** — FastAPI compatibility/control API.
- **Compute Engine `koj-judge` VM** — always-on Postgres pull worker and private Docker-backed judge API.
- **Neon Postgres** — application and durable judge queue data.

## Infrastructure

```
Vercel (Next.js) ── transactional submission + job insert ──► Neon Postgres
                                                                  ▲
Judge VM worker ────────── claim with SKIP LOCKED ────────────┘
     │
     └── judges each run inside a restricted Docker container
Browser ◄── SSE status reads from Postgres ── Vercel
```

The submission route commits a pending submission and its judge job in one Postgres transaction. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, renew expiring leases, retry infrastructure failures, and fence stale attempts from persisting results.

The admin view reports queue depth and age, worker liveness, infrastructure failures, and stored execution-time percentiles. SSE clients can reconnect and reload status from Postgres.

## Environment variables

### Next.js (`.env.local`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres pooled connection string |
| `FASTAPI_URL` | FastAPI origin for internal judge endpoints and health checks |
| `JUDGE_INTERNAL_SECRET` | Shared secret for internal `/judge` and `/judge-async`; must match FastAPI |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `ADMIN_CLERK_IDS` | Comma-separated Clerk user IDs allowed to bootstrap admin access |
| `CRON_SECRET` | Vercel Cron bearer secret for stale queue reconciliation |
| `RATE_LIMIT_SECRET` | Optional HMAC key for shared Postgres API rate-limit identities; falls back to `CLERK_SECRET_KEY` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Clerk sign-in path (default `/sign-in`) |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Clerk sign-up path (default `/sign-up`) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Default redirect after sign-in (default `/dashboard`) |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Default redirect after sign-up (default `/dashboard`) |
| `CLERK_WEBHOOK_SECRET` | Clerk webhook signing secret (`whsec_...`) for `/api/webhooks/clerk` |
| `REDIS_URL` | Optional Upstash Redis URL (standings cache, verdict event push) |
| `REDIS_TOKEN` | Optional Upstash Redis token |

### FastAPI (`api/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Same Neon Postgres pooled connection string as Next.js |
| `FASTAPI_HOST` | Bind address (default `0.0.0.0`) |
| `FASTAPI_PORT` | Bind port (default `8000`) |
| `JUDGE_INTERNAL_SECRET` | Shared secret for internal `/judge` and `/judge-async`; must match Next.js |
| `FRONTEND_URL` | Production frontend origin for CORS (e.g. `https://koj.vercel.app`) |
| `API_EXPOSE_DOCS` | Set to `true` for local development only to expose Swagger/ReDoc/OpenAPI routes |

Never commit `.env*` files. Only `.env.example` and `api/.env.example` are tracked.

## Judge deployment

The public-contest target is the dedicated Linux VM with `JUDGE_SANDBOX_MODE=docker`. `scripts/deployment/startup.sh` provisions separate API and worker services, a pinned sandbox image, a host seccomp profile, and separate restricted database credentials. Each contestant run gets a container with no network, a read-only root, dropped capabilities, and cgroup limits. Run `scripts/deployment/verify-docker-host.py` on the actual VM before enabling submissions; also rehearse queue recovery and measure mixed-language throughput. See [the threat model](threat-model.md) and `api/README.md` for the security contract.

The example Cloud Run worker pool in `scripts/deployment/` uses `rlimit`, which has no filesystem or network isolation and is **not** the public-contest target. It is not deployed in the current project. Do not point public submissions at it. The Cloud Run control API's `/health` only proves HTTP liveness; `/ready`, a recent `judge_workers` heartbeat, and a completed canary are separate launch checks.

Before updating the VM, verify its running source revision and the live Drizzle migration ledger. The startup script extracts each pinned source archive into `/opt/koj/releases/<sha>`, switches `/opt/koj/source` to that release, and restarts both services so they load the new source and environment. Updating Git or Cloud Run alone does not update the VM worker. Deploy and roll back source/image revisions together, then rerun the Docker host probe and a real submission canary. Never run `db:push` against production.

The restricted judge database roles set `statement_timeout` and `lock_timeout` at the role level. Neon pooled connections reject those settings when sent as a libpq startup `options` parameter; keep the VM API and worker connection strings free of that parameter.

## Cron

Vercel Cron invokes the daily orphan-submission recovery endpoint. The cron only creates jobs for old pending/running submissions with no existing job; worker leases handle ordinary crashes.

## Migration warnings

CI applies all checked-in migrations to an empty database to catch syntax and ordering failures, but empty-database success does not prove which historical migrations have already run on live Neon. Inspect the live Neon schema and migration ledger before applying migrations to production.

## Local Docker (optional, separate from production)

A Docker Compose layout may be used for local development as an alternative to a remote Neon database. This is a convenience for local work only and is not the production target.
