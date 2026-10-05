# KOJ - Kottayam Online Judge

Contest hosting platform with an integrated problem archive for IIIT Kottayam.

**Docs:** [Overview](docs/overview.md) · [Architecture](docs/architecture.md) · [Features](docs/features.md) · [Stack](docs/stack.md) · [Testing](docs/testing.md) · [Deployment](docs/deployment.md) · [All docs](docs/)

## Architecture and engineering highlights

```text
Vercel (Next.js app) ── atomic submission + job insert ──► Neon Postgres
                                                               ▲
Cloud Run worker pool ───── claim with SKIP LOCKED ────────────┘
        │
        └── judges with the configured rlimit backend

Browser ◄── SSE status reads from Postgres ── Vercel
```

- The submission route commits a pending submission and its judge job in one Postgres transaction. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, renew expiring leases, retry infrastructure failures, and fence stale attempts from persisting results.
- The admin view reports queue depth and age, worker liveness, infrastructure failures, and stored execution-time percentiles. SSE clients can reconnect and reload status from Postgres.
- The judge supports Python, C, C++, Java, Go, Rust, and JavaScript. CI covers the accepted-verdict corpus for all seven, selected Python failure verdicts, and bounded Linux `rlimit` probes.
- Problem setters can choose exact output comparison or finite numeric-token comparison with bounded absolute and relative tolerances; exact remains the default.
- Setters can also configure an optional Python special checker. Contest tooling includes manual freeze/unfreeze and staged or full result reveal, announcements, private/public clarifications, teams of up to three, and timed virtual participation.
- Admins have an append-only action log and advisory plagiarism-similarity reports over a bounded recent sample; reports do not determine misconduct.
- Streaming byte limits bound incoming submission, problem-authoring, contest, admin, interactive-run, and webhook bodies before JSON parsing.
- The judge container runs as non-root UID/GID `10001`, adding a privilege reduction layer. Cloud Run `rlimit` still does not isolate filesystem or network access; this deployment is for a trusted college audience, not arbitrary public code execution. See [the threat model](docs/threat-model.md).

## Status and remaining work

The Cloud Run/Vercel/Neon deployment is a target, not a verified production deployment. Live Neon migration state, production smoke tests, deployed alert policies, and a real college contest remain unverified. No measured load/capacity, uptime, participant, or submission figures are claimed. Interactive problem protocol, problem-package export/validation, broad adversarial sandbox coverage, and complete route-by-role authorization coverage also remain future work. See [implementation status](docs/status.md), [features](docs/features.md), and the [deployment checklist](docs/deployment.md#cloud-run-launch-checklist).

---

## Stack

| Package | Version | Notes |
|---|---|---|
| `next` | 16.3.5 | App Router, Route Handlers under `app/api/*` |
| `react` / `react-dom` | 19.2.8 | |
| `@clerk/nextjs` | 7.x | Authentication (see `AGENTS.md` for the verified setup) |
| `tailwindcss` | 4.x | v4, config via `@tailwindcss/postcss` + `@import "tailwindcss"` in `app/globals.css` |
| `drizzle-orm` | 0.45.x | |
| `drizzle-kit` | 0.31.x | Dev tool: `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` |
| `pg` | 8.x | Node Postgres driver used by the Drizzle client |
| `dotenv` | 16.x | Loads env vars outside Next (drizzle-kit, FastAPI) |

## Layout

```
app/                  # Next.js App Router (UI + Route Handlers)
  api/health/route.ts # Sample Route Handler that pings the DB via Drizzle
  layout.tsx
  page.tsx
  globals.css         # Tailwind v4 entry
db/
  index.ts            # Drizzle client (pg pool, single per process)
  schema.ts           # Table definitions
  migrations/         # Generated SQL migrations
api/                  # Separate FastAPI service (Python)
  app/main.py
  app/db.py
  app/config.py
  requirements.txt
  .env.example
  README.md
drizzle.config.ts
next.config.ts
postcss.config.mjs    # @tailwindcss/postcss
tsconfig.json
```

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

`.env.local` (present locally, gitignored) must contain:

```
DATABASE_URL="postgresql://..."
FASTAPI_URL="http://127.0.0.1:8000"
```

Next.js loads `.env.local` automatically. `drizzle-kit` and the FastAPI service load it explicitly.

### 3. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000>. Visit <http://localhost:3000/api/health> to confirm Drizzle can reach Neon. It returns `{ "status": "ok", "db": true, "latencyMs": N }`, or `{ "status": "degraded", "db": false, ... }` on failure (never a 500).

### 4. Database workflow (Drizzle)

```bash
npm run db:generate   # generate SQL migrations from db/schema.ts
npm run db:migrate    # apply migrations to the DB in DATABASE_URL
npm run db:push       # push schema directly (dev only)
npm run db:studio     # open Drizzle Studio in a browser
```

## FastAPI service

Runs as a separate process. See `api/README.md` for details.

```bash
cd api
python -m venv .venv
.venv\Scripts\activate           # Windows (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
cp .env.example .env             # set DATABASE_URL to the same Neon URL
uvicorn app.main:app --reload --port 8000
```

Then <http://127.0.0.1:8000/health> and <http://127.0.0.1:8000/docs>.
For local queue processing, run a second API process with `python -m app.worker`.
Both processes use the same `DATABASE_URL`; the worker pulls queued jobs from
Postgres and does not require `FASTAPI_URL`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build + start |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | TypeScript check |
| `npm test` | Cross-platform TypeScript and Python unit tests |
| `npm run db:generate` | Drizzle: generate SQL migration from schema |
| `npm run db:migrate` | Drizzle: apply migrations to the DB |
| `npm run db:push` | Drizzle: push schema directly (skips migrations) |
| `npm run db:studio` | Drizzle Studio |

## Notes

- `.env*` is gitignored. Never commit secrets.
- Tailwind v4 has no `tailwind.config.js`; theming lives in `app/globals.css` under `@theme inline { ... }`.
- The FastAPI service is intentionally separate from Next.js. Run it as a second process.

## Production deployment

The intended production layout is Vercel for the Next.js app, Cloud Run for the FastAPI compatibility service and pull worker pool, and Neon Postgres for application and queue data. This is the target architecture; it has not yet been verified in a live deployment. Follow [the launch checklist](docs/deployment.md#cloud-run-launch-checklist) and its live-database migration warning before deploying.

## Contributors

- Asterisk-Hunter
