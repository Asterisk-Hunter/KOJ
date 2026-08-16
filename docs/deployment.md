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
