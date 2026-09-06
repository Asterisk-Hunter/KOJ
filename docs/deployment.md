# Deployment

## Target environments

### Local development
```bash
Docker Compose:
├── Postgres (Neon serverless or local container)
├── Redis
├── FastAPI backend (uvicorn --reload)
├── Next.js frontend (npm run dev)
└── Judge (runs as subprocess within FastAPI)
```

### College deployment
- **Single Linux VM** (4 CPU, 8GB RAM) running Docker containers
- Alternatively: managed platform like Railway or Render for Postgres + app

---

## Infrastructure

```
┌─ Docker Network ─────────────────────┐
│  ├─ Postgres (Supabase / Neon)       │
│  ├─ Redis                            │
│  ├─ FastAPI backend                  │
│  ├─ Next.js frontend                 │
│  └─ Judge (isolated as subprocess)   │
└──────────────────────────────────────┘
```

## Realistic constraints

- Single server; no multi-machine load balancing
- Storage: ~500MB for a year of contests + problems
- Network: college LAN; assume reliable, low-latency connections
- No CDN needed (college-scale traffic)

---

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | `.env.local` (Next.js), `.env` (FastAPI) | Neon/Supabase Postgres connection string |
| `FASTAPI_URL` | `.env.local` (Next.js) | FastAPI service base URL |
| `SUPABASE_URL` | `.env.local` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `.env.local` | Supabase anonymous key |
| `REDIS_URL` | `.env` (FastAPI) | Redis connection string |

**Never commit `.env*` files.** They are gitignored.

---

## Deploying to Vercel

**Required env vars (all empty in `.env.example`):** `DATABASE_URL` (Neon pooled + `sslmode=require`), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard`, `FASTAPI_URL` (deployed FastAPI origin), `JUDGE_INTERNAL_SECRET` (must match on Next.js + FastAPI), `FRONTEND_URL` (Vercel URL for FastAPI CORS).

**FastAPI separately:** Host on Render/Railway/Fly. Copy `api/.env.example` keys to its env (`DATABASE_URL`, `FASTAPI_HOST`, `FASTAPI_PORT`, `JUDGE_INTERNAL_SECRET`, `FRONTEND_URL`). Set `FRONTEND_URL=https://<vercel-app>.vercel.app` and ensure `JUDGE_INTERNAL_SECRET` is identical on both sides. CORS is tight — `allow_origins=[http://localhost:3000, FASTAPI_URL, FRONTEND_URL]` (never `*`); localhost remains for dev.

**Clerk:** In Clerk dashboard, set Sign-in/Sign-up URLs and fallback redirects to the same values. Mirror all `NEXT_PUBLIC_CLERK_*` vars in Vercel Project Settings → Environment Variables.

**Neon:** Use pooled connection string (`…-pooler…?sslmode=require&channel_binding=require`). Next.js `pg` Pool `max:10` and FastAPI `psycopg` short-lived connections.

**Function duration:** `app/api/submissions` exports `maxDuration=60` (55s judge timeout + 2s buffer). Vercel Hobby caps at 10s — requires Pro (60s) or moving judging to background queue/worker later. No `regions` pin needed.

## Seeding demo data

The idempotent seed script populates the live Neon database with 8 published problems, 4 contests, and test cases. It requires a real Clerk user — safe for local/dev only, never for production with fake users.

```bash
# Provide the real Clerk user to own seeded content
SEED_USER_CLERK_ID=user_xxx SEED_USER_EMAIL=you@example.com npm run db:seed
# Optional: SEED_USERNAME=koj-seed-admin (default)
# Uses DATABASE_URL from .env.local; rerunning is safe (upserts by title/slug).
```

Seed uses `node --experimental-strip-types scripts/seed.ts` (Node 22+). No fake submissions or registrations are created — those reflect real user actions.
