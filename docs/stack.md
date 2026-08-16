# Technology Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4 | Modern, familiar, rapid UI iteration; App Router + Route Handlers |
| **Backend API** | FastAPI (Python 3.11+), Uvicorn | Fast async framework, easy to prototype, good for educational clarity |
| **Database** | Postgres (via Neon) | Relational schema fits our data model; Supabase gives us Realtime + auth |
| **ORM** | Drizzle ORM (TypeScript side) | Type-safe queries, migration management, works with Neon serverless |
| **Real-time** | Supabase Realtime | Postgres change notifications → WebSocket broadcast to clients |
| **Caching** | Redis | Leaderboard caching, rate limiting |
| **Judge Execution** | Python `subprocess`, `resource`, `signal` modules | Sandboxing via OS-level limits |
| **Authentication** | Supabase Auth (JWT-based) | Handled by Supabase, frees us from auth security headaches |
| **Deployment** | Docker + Docker Compose locally; cloud TBD | Single-compose file for dev; cloud deployment (Railway, Render, or DigitalOcean) for production |
| **Testing** | pytest (backend), Jest (frontend), Playwright (E2E) | Standard tools, well-integrated with stack |

---

## Verified versions (in this repo)

| Package | Version | Notes |
|---|---|---|
| `next` | 16.3.0 | App Router, Route Handlers under `app/api/*` |
| `react` / `react-dom` | 19.2.8 | |
| `tailwindcss` | 4.3.3 | v4, config via `@tailwindcss/postcss` + `@import "tailwindcss"` in `globals.css` |
| `drizzle-orm` | 0.36.4 | |
| `drizzle-kit` | 0.28.1 | Dev tool: `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` |
| `pg` | 8.23.0 | Node Postgres driver |
| `fastapi` | 0.115.14 | |
| `uvicorn` | 0.39.0 | |
| `psycopg` | 3.3.4 | Modern Postgres driver (psycopg 3, not psycopg2) |

---

## Why these choices

- **Next.js 16:** App Router with Server Components, Route Handlers, and built-in optimization. Familiar to the team.
- **Tailwind v4:** Utility-first CSS with no config file (theming via `@theme inline` in CSS). Fast iteration.
- **Drizzle over Prisma:** Lighter footprint, native SQL feel, better Neon serverless compatibility.
- **FastAPI:** Fast, async, automatic OpenAPI docs, Pydantic validation. Good educational clarity.
- **Supabase:** Managed Postgres + Realtime + Auth in one package. Avoids running our own Redis-backed pub/sub.
- **Process-level sandboxing:** Sufficient for trusted college users. Docker-per-submission adds overhead we don't need.
