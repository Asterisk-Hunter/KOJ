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
- **Cloud Run** — FastAPI health/compatibility API and the pull worker pool.
- **Neon Postgres** — application and durable judge queue data.

## Infrastructure

```
Vercel (Next.js) ── transactional submission + job insert ──► Neon Postgres
                                                                  ▲
Cloud Run worker pool ───── claim with SKIP LOCKED ────────────┘
     │
     └── judges with the configured sandbox backend
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

## Cloud Run

Cloud Run uses `rlimit` mode, which limits process resources but does not isolate filesystem or network access. KOJ's supported deployment is trusted-college only, not arbitrary public multi-tenant execution. Set `JUDGE_SANDBOX_MODE=rlimit` explicitly on Cloud Run workers and follow [the threat model](docs/threat-model.md).

See `api/DEPLOYMENT_CONTRACT.md` for the FastAPI deployment contract, and `scripts/deployment/` for the Cloud Run service and worker startup files.

## Cron

Vercel Cron invokes the daily orphan-submission recovery endpoint. The cron only creates jobs for old pending/running submissions with no existing job; worker leases handle ordinary crashes.

## Migration warnings

CI applies all checked-in migrations to an empty database to catch syntax and ordering failures, but empty-database success does not prove which historical migrations have already run on live Neon. Inspect the live Neon schema and migration ledger before applying migrations to production.

## Local Docker (optional, separate from production)

A Docker Compose layout may be used for local development as an alternative to a remote Neon database. This is a convenience for local work only and is not the production target.
