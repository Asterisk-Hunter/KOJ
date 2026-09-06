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
- **Split:** Vercel (Next) + managed FastAPI host (Render/Railway/Fly) + Neon — current intended production (see Vercel section below)

---

## Infrastructure

```
┌─ Vercel (Next.js) ─────────────────┐  ┌─ FastAPI host ─────────────┐
│  Next.js Route Handlers            │→ │  FastAPI + judge subprocess│
│  Clerk proxy.ts                    │  │  POST /judge (internal)    │
└──────────┬─────────────────────────┘  └──────────┬─────────────────┘
           │ SQL (Drizzle/pg)                    │ SQL (psycopg)
           └──────────────┬──────────────────────┘
                          ▼
                   ┌──────────────────┐
                   │  Neon Postgres   │
                   └──────────────────┘
Planned: Redis + SSE for realtime — not yet deployed
```

Previous diagram referencing Supabase/Neon interchangeable is superseded — Neon is authoritative.

## Realistic constraints

- Single server / single Vercel project + single FastAPI instance; no multi-machine load balancing
- Storage: ~500MB for a year of contests + problems
- Network: college LAN / Vercel edge; assume reliable
- No CDN needed (college-scale traffic)

---

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | `.env.local` (Next.js), `.env` (FastAPI) | Neon pooled connection string (`…-pooler…?sslmode=require&channel_binding=require`) |
| `FASTAPI_URL` | `.env.local` (Next.js) | FastAPI origin (e.g. `http://127.0.0.1:8000` local, deployed URL in prod) |
| `JUDGE_INTERNAL_SECRET` | Both Next + FastAPI | Shared secret for `POST /judge` (`X-Judge-Secret`); must match |
| `FRONTEND_URL` | `.env` (FastAPI) | Production frontend origin for CORS (e.g. `https://koj.vercel.app`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` (Next) | Clerk publishable key |
| `CLERK_SECRET_KEY` | `.env.local` (Next) | Clerk secret |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `.env.local` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `.env.local` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `.env.local` | `/dashboard` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `.env.local` | `/dashboard` |
| `REDIS_URL` | `.env` (FastAPI/Next, planned) | Redis — not used yet |

Obsolete: `SUPABASE_URL`, `SUPABASE_ANON_KEY` — not used; KOJ uses Clerk + Neon.

**Never commit `.env*` files.** They are gitignored.

---

## Deploying to Vercel

**Required env vars (all empty in `.env.example`):** `DATABASE_URL` (Neon pooled + `sslmode=require`), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard`, `FASTAPI_URL` (deployed FastAPI origin), `JUDGE_INTERNAL_SECRET` (must match on Next.js + FastAPI), `FRONTEND_URL` (Vercel URL for FastAPI CORS).

**FastAPI separately:** Host on Render/Railway/Fly. Copy `api/.env.example` keys to its env (`DATABASE_URL`, `FASTAPI_HOST`, `FASTAPI_PORT`, `JUDGE_INTERNAL_SECRET`, `FRONTEND_URL`). Set `FRONTEND_URL=https://<vercel-app>.vercel.app` and ensure `JUDGE_INTERNAL_SECRET` is identical on both sides. CORS is tight — `allow_origins=[http://localhost:3000, FASTAPI_URL, FRONTEND_URL]` (never `*`); localhost remains for dev.

**Clerk:** In Clerk dashboard, set Sign-in/Sign-up URLs and fallback redirects to the same values. Mirror all `NEXT_PUBLIC_CLERK_*` vars in Vercel Project Settings → Environment Variables. Organizations are **enabled** — `org:admin` role is used for admin APIs.

**Neon:** Use pooled connection string (`…-pooler…?sslmode=require&channel_binding=require`). Next.js `pg` Pool `max:10` and FastAPI `psycopg` short-lived connections.

**Function duration:** `app/api/submissions` exports `maxDuration=60` (55s judge timeout + 2s buffer). Vercel Hobby caps at 10s — requires Pro (60s) or moving judging to background queue/worker later. No `regions` pin needed.

---

## Current deployment limitations (as of `feat/sprint1-backend`)

Preserved Vercel section above is accurate for intended production. Limitations today:

1. **FastAPI not yet deployed** — judge works locally (`FASTAPI_URL=http://127.0.0.1:8000` fallback) but production requires a hosted FastAPI with `JUDGE_INTERNAL_SECRET` + `FRONTEND_URL` set; without it `POST /api/submissions` returns 502 `judge unavailable`
2. **Redis/SSE not deployed** — no Redis instance, no SSE route; leaderboard is on-demand
3. **Contest CRUD not deployed** — no API to create contests in production; contests come from seed script
4. **Webhook sync not deployed** — Clerk webhooks for `users`/`org memberships` not wired; `users` rows are lazy-created on first submission/admin call
5. **Vercel Hobby limit** — `maxDuration=60` needs Pro or a queue/worker refactor before production contests

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
