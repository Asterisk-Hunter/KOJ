# Deployment

## Target environments

### Local development
```bash
├── Neon Postgres (serverless, via DATABASE_URL)
├── Next.js frontend (npm run dev, port 3000)
└── FastAPI judge (uvicorn --reload, port 8000, runs judge as subprocess)
# Redis — planned, not yet running
```

### College deployment
- **Single Linux VM** (4 CPU, 8GB RAM) running Docker/containers, or
- **Split:** Vercel (Next) + Cloud Run (FastAPI judge) + Neon — current intended production (see Vercel section below)

---

## Infrastructure

```
┌─ Vercel (Next.js) ─────────────┐       ┌─ Cloud Run ──────────────────────┐
│ Route Handlers + Clerk proxy   │       │ FastAPI HTTP service            │
│ insert submission + judge_job  │       │ legacy /judge + /judge-async     │
└──────────────┬─────────────────┘       └───────────────┬──────────────────┘
               │ SQL (Drizzle/pg)                         │ SQL (psycopg)
               └────────────────────┬─────────────────────┘
                                    ▼
                           ┌──────────────────┐
                           │  Neon Postgres   │
                           │ submissions/jobs │
                           └─────────┬────────┘
                                     │ SELECT ... FOR UPDATE SKIP LOCKED
                                     ▼
                           ┌──────────────────────┐
                           │ Cloud Run worker pool│
                           │ python -m app.worker│
                           └──────────────────────┘
```

The Next.js submission route commits the submission and queue row atomically. Workers
pull jobs from Postgres, hold expiring leases, heartbeat while judging, and retry
infrastructure failures with bounded backoff. The app does not synchronously call
the judge during submission creation. Redis is not part of this path.

Previous diagram referencing Supabase/Neon interchangeable is superseded — Neon is authoritative.

## Realistic constraints

- Cloud Run worker pools do not expose an HTTP endpoint and need an explicitly
  configured instance count; this design uses Postgres polling rather than an
  autoscaled request queue.
- `rlimit` is the supported Cloud Run sandbox and has no filesystem or network
  namespace. Treat the service as suitable for a trusted college audience only.
- Queue durability comes from Neon; Neon availability and connection limits are
  therefore part of judge availability.
- No benchmark or college-contest capacity claim is published until measured on
  the deployed stack.

---

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | `.env.local` (Next.js), `.env` (FastAPI) | Neon pooled connection string (`…-pooler…?sslmode=require&channel_binding=require`) |
| `FASTAPI_URL` | `.env.local` (Next.js) | FastAPI origin for internal judge endpoints and health checks; not used to enqueue submissions |
| `JUDGE_INTERNAL_SECRET` | FastAPI (and Next if using internal judge endpoints) | Shared secret for compatibility `/judge` and `/judge-async` endpoints |
| `FRONTEND_URL` | `.env` (FastAPI) | Production frontend origin for CORS (e.g. `https://koj.vercel.app`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` (Next) | Clerk publishable key |
| `CLERK_SECRET_KEY` | `.env.local` (Next) | Clerk secret |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `.env.local` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `.env.local` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `.env.local` | `/dashboard` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `.env.local` | `/dashboard` |
| `JUDGE_LEASE_SECONDS` | Cloud Run worker pool | Queue lease lifetime; worker heartbeats renew it |
| `JUDGE_WORKER_POLL_SECONDS` | Cloud Run worker pool | Idle queue polling interval |
| `CRON_SECRET` | Vercel | Bearer secret for the daily orphan-submission recovery cron |

Obsolete: `SUPABASE_URL`, `SUPABASE_ANON_KEY` — not used; KOJ uses Clerk + Neon.

**Never commit `.env*` files.** They are gitignored.

---

## Deploying to Vercel

**Required env vars:** `DATABASE_URL` (Neon pooled + `sslmode=require`), Clerk keys and route/redirect settings, and `ADMIN_CLERK_IDS` to bootstrap the first admin. Set `CRON_SECRET` to protect scheduled orphan recovery. `FASTAPI_URL` and `JUDGE_INTERNAL_SECRET` are only needed when using the compatibility HTTP judge endpoints; the submission route now writes queue jobs directly.

**Cloud Run HTTP service:** Build `api/Dockerfile` and deploy it with `DATABASE_URL`, `FASTAPI_HOST=0.0.0.0`, and a generated `JUDGE_INTERNAL_SECRET`. Keep `JUDGE_SANDBOX_MODE=rlimit`; standard Cloud Run does not provide a Docker daemon for nested judge containers. This service keeps the compatibility `/judge` API available, but normal submissions no longer dispatch through it.

**Cloud Run worker pool:** Deploy the same image with command `python` and args `-m,app.worker`. Set `DATABASE_URL`, `JUDGE_SANDBOX_MODE=rlimit`, `JUDGE_LEASE_SECONDS=120`, and `JUDGE_WORKER_POLL_SECONDS=1`. Use Secret Manager for `DATABASE_URL`, set the instance count explicitly, and size concurrency through worker instances (each worker judges one job at a time). The worker requires no public endpoint and reads queue rows directly from Neon. See Google's [Cloud Run worker-pool overview](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) and [resource model](https://docs.cloud.google.com/run/docs/resource-model).

**Clerk:** In Clerk dashboard, set Sign-in/Sign-up URLs and fallback redirects to the same values. Mirror all `NEXT_PUBLIC_CLERK_*` vars in Vercel Project Settings → Environment Variables. Admin authorization does **not** use Clerk organizations — no Organizations API call exists in the codebase. It gates on the comma-separated `ADMIN_CLERK_IDS` env allowlist first, then Neon `users.role` (`app/api/admin/authz.ts`). Set `ADMIN_CLERK_IDS` on Vercel to bootstrap the first admin; it is not in `.env.example`. Whether Organizations are enabled in the dashboard is UNVERIFIED and irrelevant to authz.

**Neon:** Use pooled connection string (`…-pooler…?sslmode=require&channel_binding=require`). Next.js `pg` Pool `max:10`; FastAPI uses a bounded `psycopg` connection pool per worker.

**Function duration:** submission creation only validates, inserts, and enqueues inside a database transaction; it does not wait for compilation or judging. The EventSource endpoint streams status from the database. A daily Vercel Cron invokes orphan recovery as a safety net; worker leases handle normal crash recovery. See [Vercel Cron documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

### Hosting split and the Cloud Run sandbox caveat

Four deployables/resources: Next.js → Vercel; FastAPI compatibility API → Cloud Run service; pull worker → Cloud Run worker pool; Postgres → Neon. `.vercelignore` keeps the Python `/api/` folder off Vercel. Cloud Run deployments explicitly use `rlimit`, which has resource limits but no filesystem or network namespace. The project makes no multi-tenant hostile-code security claim for that mode. Full judge details: `api/DEPLOYMENT_CONTRACT.md`.

---

## Cloud Run launch checklist

1. Set `JUDGE_SANDBOX_MODE=rlimit` for both Cloud Run deployables and read the trusted-college security limitations before accepting submissions.
2. Apply the Drizzle migrations to Neon before deploying the web app or worker.
3. Create one worker-pool instance first, verify the admin queue and worker liveness panel, then increase instances only after measuring capacity.
4. Configure Vercel `CRON_SECRET`; `vercel.json` schedules orphan recovery once daily. Vercel Hobby supports daily cadence only, so this cron is a backstop—not the queue's primary recovery path.
5. Run the smoke/adversarial suite and a small authorized contest before inviting participants. Record real throughput and queue latency; do not infer capacity from instance count.

---

## Seeding demo data

The idempotent seed script populates the live Neon database with 8 published problems, 4 contests, and test cases. It requires a real Clerk user — safe for local/dev only, never for production with fake users.

```bash
# Provide the real Clerk user to own seeded content
SEED_USER_CLERK_ID=user_xxx SEED_USER_EMAIL=you@example.com npm run db:seed
# Optional: SEED_USERNAME=koj-seed-admin (default)
# Uses DATABASE_URL from .env.local; rerunning is safe (upserts by title/slug).
```

Seed uses `node --experimental-strip-types scripts/seed.ts` (Node 22+). No fake submissions or registrations are created — those reflect real user actions.

Seeded counts: 8 problems, 32 test cases (4 per problem, 2 sample + 2 hidden), 4 contests, 16 contest_problem links. See `docs/status.md` for verification.
