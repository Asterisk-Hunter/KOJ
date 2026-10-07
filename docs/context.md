# KOJ context — 30-second orientation

This file routes contributors; docs/status.md tracks implementation status. AGENTS.md is the working contract.

## Project

KOJ (Kottayam Online Judge) is a contest hosting platform and problem archive for IIIT Kottayam. The app uses Next.js 16, React 19, TypeScript, Tailwind v4, Drizzle ORM on Neon Postgres, and Clerk. The judge is a separate FastAPI service on Cloud Run, and the queue is a Postgres pull queue with Cloud Run workers.

The owner has resolved the hosting and queue questions in docs/KOJ_ Plan to Make It a Solid Project.md: Cloud Run-first, explicit rlimit mode for a trusted college audience, a Postgres pull queue, and Vercel Cron for orphan recovery. See docs/threat-model.md before enabling untrusted submissions.

## Read order

1. AGENTS.md — the repository contract.
2. docs/context.md — orientation and current architecture.
3. docs/KOJ_ Plan to Make It a Solid Project.md — roadmap and recorded owner decisions.
4. docs/overview.md, docs/architecture.md, docs/stack.md, and docs/features.md — product and system details.
5. docs/testing.md and docs/deployment.md — checks and deployment procedures.
6. docs/status.md — verified state and remaining operational work.

Before framework-specific changes, read the applicable guide in node_modules/next/dist/docs. Install dependencies first on a fresh clone.

## Current architecture

- Vercel hosts the Next.js app. The submission handler writes a pending submission and judge job in one database transaction.
- Neon Postgres stores submissions, queue state, leases, retries, and worker liveness.
- Cloud Run hosts the FastAPI compatibility service and a worker pool running `python -m app.worker`. Each worker pulls jobs from Postgres with `SKIP LOCKED`, keeps expiring leases alive via heartbeats, retries bounded infrastructure failures, and fences stale attempts from persisting results.
- Cloud Run uses rlimit mode. It bounds process resources and output but does not isolate filesystem or network access; KOJ is not a public multi-tenant judge in this configuration.
- SSE reads status from Postgres. Redis is not part of judging or verdict delivery; it is optional for selected read-side caches.
- Vercel Cron invokes the daily orphan-submission recovery endpoint. Queue leases are the primary worker-failure recovery mechanism.

## Key facts

- Next.js 16 uses root proxy.ts, not middleware.ts.
- ClerkProvider belongs inside body, never wrapping html; sign-in/sign-up routes are catch-alls.
- Admin and setter checks use Clerk identity plus Neon roles; Clerk Organizations are not used.
- Public proxy matchers do not replace handler or server-page authorization. The problem-authoring page and contest arena enforce access on the server.
- The worker and web app need Neon access. Contestant child processes receive a minimal environment, but rlimit has no filesystem or network namespace.
- Never read, write, or commit environment secrets. Only tracked `.env.example` files are templates.

## Commands

- `npm run dev` — Next.js development server.
- `cd api && uvicorn app.main:app --reload --port 8000` — FastAPI compatibility service.
- `cd api && python -m app.worker` — local queue worker.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` — frontend checks.
- `npm test` — cross-platform TypeScript and Python unit tests.
- `cd api && python -m pytest -q -m integration integration_tests` — Linux sandbox and verdict corpus; requires the judge toolchains.
- `npm run db:generate` / `npm run db:migrate` — Drizzle migrations.

## Docs

- Overview: `docs/overview.md`
- Architecture: `docs/architecture.md`
- Features: `docs/features.md`
- Stack: `docs/stack.md`
- Testing: `docs/testing.md`
- Deployment: `docs/deployment.md`
- Status: `docs/status.md`
