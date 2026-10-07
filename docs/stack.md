# Technology Stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | Next.js 16.3.5, React 19.2.8, TypeScript, Tailwind CSS v4 | App Router UI and Route Handlers |
| Database | Neon Postgres | Application data and durable judge queue |
| ORM | Drizzle ORM 0.45.x, drizzle-kit 0.31.x | Next.js schema and migration workflow |
| Authentication | Clerk 7.x | User identity; authorization roles are stored in Neon |
| Judge API | FastAPI 0.115.x, Python 3.11+ | Compatibility HTTP routes and health |
| Judge workers | Python pull worker | Leases Postgres queue jobs and runs submissions |
| Judge execution | Docker containers on a dedicated Linux VM | Container resource limits and namespaces; verify the actual host boundary before public contests |
| Realtime | Next.js SSE polling Postgres | Bounded submission and contest status streams |
| Optional cache | Upstash Redis | Selected read-side cache paths only; never queue or judge delivery |
| Deployment | Vercel, Cloud Run control API, Compute Engine judge VM, Neon | Split frontend, control API, worker/judge, and database |

## Important conventions

- Next.js 16 uses root proxy.ts; do not create middleware.ts.
- Tailwind v4 tokens live in app/globals.css; there is no tailwind.config.js.
- FastAPI is a separate deployable in api/ and is never folded into Next.js.
- The submission Route Handler writes the submission and job row atomically.
- The VM worker handles one job at a time; VM and queue capacity must be measured before a contest.
- The public-contest target uses `JUDGE_SANDBOX_MODE=docker` on the dedicated VM. `rlimit` is a trusted-audience fallback; see `docs/threat-model.md`.
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
