# KOJ

Next.js 16 (App Router) + Tailwind v4 + Drizzle ORM (Neon Postgres) + a separate FastAPI service.

## Stack (verified)

| Package | Version | Notes |
|---|---|---|
| `next` | 16.3.0 | App Router, Route Handlers under `app/api/*` |
| `react` / `react-dom` | 19.2.8 | |
| `tailwindcss` | 4.3.3 | v4, config via `@tailwindcss/postcss` + `@import "tailwindcss"` in `app/globals.css` |
| `drizzle-orm` | 0.36.4 | |
| `drizzle-kit` | 0.28.1 | Dev tool: `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` |
| `pg` | 8.23.0 | Node Postgres driver used by the Drizzle client |
| `dotenv` | 16.4.x | For loading env outside Next (drizzle-kit, FastAPI) |

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

### 1. Install Node deps

```bash
npm install
```

### 2. Configure env

`.env.local` (already present locally, gitignored) must contain:

```
DATABASE_URL="postgresql://neondb_owner:...@ep-floral-butterfly-azl2aall-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
FASTAPI_URL="http://127.0.0.1:8000"
```

Next.js auto-loads `.env.local`. `drizzle-kit` and the FastAPI service load it explicitly.

### 3. Run the Next.js dev server

```bash
npm run dev
```

Open <http://localhost:3000>. Hit <http://localhost:3000/api/health> to confirm Drizzle can reach Neon — it returns `{ "status": "ok", "db": true, "latencyMs": N }` or `{ "status": "degraded", "db": false, ... }` on failure (never a 500).

### 4. Database workflow (Drizzle)

```bash
npm run db:generate   # generate SQL migrations from db/schema.ts
npm run db:migrate    # apply migrations to the DB in DATABASE_URL
npm run db:push       # push schema directly (dev only)
npm run db:studio     # open Drizzle Studio in a browser
```

## FastAPI service (separate process)

See `api/README.md`. Short version:

```bash
cd api
python -m venv .venv
.venv\Scripts\activate           # Windows
# source .venv/bin/activate      # macOS/Linux
pip install -r requirements.txt
copy .env.example .env           # Windows  (cp .env.example .env on macOS/Linux)
# edit .env and set DATABASE_URL to the same Neon URL
uvicorn app.main:app --reload --port 8000
```

Then <http://127.0.0.1:8000/health> and <http://127.0.0.1:8000/docs>.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build + start |
| `npm run lint` | ESLint |
| `npm run db:generate` | Drizzle: generate SQL migration from schema |
| `npm run db:migrate` | Drizzle: apply migrations to the DB |
| `npm run db:push` | Drizzle: push schema directly (skips migrations) |
| `npm run db:studio` | Drizzle Studio |

## Notes

- `.env*` is gitignored. Never commit secrets.
- Tailwind v4 has no `tailwind.config.js`; theming lives in `app/globals.css` under `@theme inline { ... }`.
- The FastAPI service is intentionally separate from Next.js — run it as a second process.
