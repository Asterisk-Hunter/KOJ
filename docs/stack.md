# Technology Stack

| Layer | Technology | Why | Status on `feat/sprint1-backend` |
|---|---|---|---|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4 | Modern, familiar, rapid UI iteration; App Router + Route Handlers | Implemented |
| **Backend API** | Next.js Route Handlers (TypeScript) + FastAPI (Python 3.11+, Uvicorn) | Next owns auth/validation/DB; FastAPI isolates judge | Implemented — Next for all APIs, FastAPI for `/judge` |
| **Database** | Postgres via **Neon** (serverless) | Relational model fits `users/problems/contests/submissions` | **Authoritative** — all data via Drizzle + Neon |
| **ORM** | Drizzle ORM (TypeScript side) | Type-safe queries, migrations | `drizzle-orm@0.36.4`, `drizzle-kit@0.28.1` — implemented |
| **Real-time** | **Redis cache/pub-sub → Next.js SSE** | Leaderboard cache + event fan-out without polling | **Planned, not implemented** — no Redis client/SSE route yet |
| **Caching** | Redis (planned) | Leaderboard caching, rate limiting | Planned |
| **Judge Execution** | Python `py_compile` + `subprocess.run` + `resource.setrlimit` | Process-level isolation | Implemented (python only) |
| **Authentication** | **Clerk** (`@clerk/nextjs@7.7.6`) with **Organizations enabled** | Managed auth, `org:admin` roles | Implemented — `proxy.ts` + `auth()` + `org:admin` gate |
| **Deployment** | Vercel (Next) + separate FastAPI host (Render/Railway/Fly) | Split web + judge | Vercel intended; FastAPI not yet in production — see `docs/deployment.md` |
| **Testing** | pytest (backend), Jest (frontend), Playwright (E2E) — intended | Standard tools | **Not set up** — no runner in `package.json`; see `docs/testing.md` |

Previous stack table referencing Supabase Postgres/Auth/Realtime is obsolete — **Neon + Clerk + Redis/SSE** is current.

---

## Verified versions (in this repo)

| Package | Version | Notes |
|---|---|---|
| `next` | 16.3.0 | App Router, Route Handlers under `app/api/*` |
| `react` / `react-dom` | 19.2.8 | |
| `tailwindcss` | 4.3.3 | v4, config via `@tailwindcss/postcss` + `@import "tailwindcss"` in `globals.css` |
| `drizzle-orm` | 0.36.4 | |
| `drizzle-kit` | 0.28.1 | Dev tool: `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` |
| `pg` | 8.13.1 | Node Postgres driver |
| `@clerk/nextjs` | 7.7.6 | Organizations enabled; `auth().has({role:"org:admin"})` for admin gate |
| `fastapi` | 0.115.14 | |
| `uvicorn` | 0.39.0 | |
| `psycopg` | 3.3.4 | FastAPI Postgres driver (psycopg 3) |

---

## Why these choices

- **Next.js 16:** App Router with Server Components, Route Handlers, and built-in optimization.
- **Tailwind v4:** Utility-first, no config file (theming via `@theme inline` in CSS).
- **Drizzle over Prisma:** Lighter footprint, native SQL feel, better Neon serverless compatibility.
- **FastAPI:** Async, Pydantic validation, automatic OpenAPI docs; isolates judge from web layer.
- **Neon over Supabase Postgres:** Serverless Postgres with pooled connections (`?sslmode=require&channel_binding=require`); KOJ does not use Supabase Auth/Realtime/Storage.
- **Clerk over Supabase Auth:** Organizations + `org:admin` roles, catch-all sign-in/up routes, `proxy.ts` middleware.
- **Redis + SSE over Supabase Realtime:** KOJ controls cache invalidation and event channel; WebSocket/SSE from Next rather than Postgres change notifications.
- **Process-level sandboxing:** Sufficient for trusted college users; Docker-per-submission deferred.

---

## Environment (see `docs/deployment.md`)

- Next: `DATABASE_URL` (Neon pooled), `NEXT_PUBLIC_CLERK_*`, `CLERK_SECRET_KEY`, `FASTAPI_URL`, `JUDGE_INTERNAL_SECRET`, `FRONTEND_URL`
- FastAPI: `DATABASE_URL`, `FASTAPI_HOST/PORT`, `JUDGE_INTERNAL_SECRET`, `FRONTEND_URL` — CORS allow list is tight, never `*`
