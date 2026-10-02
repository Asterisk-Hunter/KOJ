# Technology Stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | Next.js 16.3.5, React 19.2.8, TypeScript, Tailwind CSS v4 | App Router UI and Route Handlers |
| Database | Neon Postgres | Application data and durable judge queue |
| ORM | Drizzle ORM 0.45.x, drizzle-kit 0.31.x | Next.js schema and migration workflow |
| Authentication | Clerk 7.x | User identity; authorization roles are stored in Neon |
| Judge API | FastAPI 0.115.x, Python 3.11+ | Compatibility HTTP routes and health |
| Judge workers | Python pull worker | Leases Postgres queue jobs and runs submissions |
| Judge execution | rlimit on Cloud Run; optional Docker on a dedicated Linux host | Resource limits; rlimit has no filesystem or network namespace |
| Realtime | Next.js SSE polling Postgres | Bounded submission and contest status streams |
| Optional cache | Upstash Redis | Selected read-side cache paths only; never queue or judge delivery |
| Deployment | Vercel, Cloud Run service + worker pool, Neon | Split frontend, judge/worker, and database |

## Important conventions

- Next.js 16 uses root proxy.ts; do not create middleware.ts.
- Tailwind v4 tokens live in app/globals.css; there is no tailwind.config.js.
- FastAPI is a separate deployable in api/ and is never folded into Next.js.
- The submission Route Handler writes the submission and job row atomically.
- Each Cloud Run worker handles one job at a time; scale by explicit worker-pool instances after measuring.
- Cloud Run deployment must explicitly set JUDGE_SANDBOX_MODE=rlimit and follow docs/threat-model.md.
- Clerk Organizations are not used. Admins and setters are authorized from Neon roles, with ADMIN_CLERK_IDS available for admin bootstrap.

## Key commands

- npm run dev — Next.js development server.
- npm run lint — ESLint.
- npx tsc --noEmit — TypeScript validation.
- npm run build — production build.
- npm test — TypeScript and Python unit tests.
- npm run db:generate / npm run db:migrate — Drizzle migrations.
- cd api && python -m app.worker — local queue worker.

See docs/deployment.md for environment variables and rollout steps.
