## 2026-10-07 — product haul (feat/product-haul)

Branch off `main`. The coverage-slice test history from earlier sessions was folded into this branch before the work below.

### What this branch does

- Strips the KOJ-verified code-training/ML/Google-Cloud research pipeline out of this branch and out of git history. That includes the private `/v1/research` API, the research dataset/problem/run/sample tables and migrations, the research worker path in `api/app/worker.py`, the `ml/` importers and training loop, the Cloud Run research worker/sandbox deploy files, and the training-specific config/env/docs. After this, KOJ is a plain online judge.
- Regenerates the docs that the filter-repo over-deletion removed: `README.md`, `docs/status.md`, `docs/context.md`, `docs/deployment.md`. Restores `api/.env.example` and cleans the stale `ml/` entries out of `.gitignore`. Restores `app/dashboard/loading.tsx` from the committed tree after the checkout fell out of sync with HEAD during the rewrite.
- Adds page-load reveal motion (staggered `reveal-1..4` with a `reveal-up` animation and `card-lift` hover lift in `app/globals.css`, applied to the landing page, dashboard, and `PageHeader`; `prefers-reduced-motion: reduce` disables it) and a first-run onboarding checklist on `/dashboard` that clears as a new user joins an org, solves a problem, and registers for a contest.

### Verification (local, before push)

- `npx tsc --noEmit` — pass
- `npm run lint` — pass (no errors)
- `npm run build` — pass
- `npm test` — pass; TypeScript passes with the colocated suites, Python `273 passed, 13 skipped, 16 deselected`
- Python cover ~74% across the judge API after the strip; no research paths remain

### Caveats

- The live Cloud Run/Vercel/Neon deployment is still unverified. No measured load/capacity, uptime, participant, or submission figures are claimed.
- `api/DEPLOYMENT_CONTRACT.md` was removed during the strip. Its contract content now lives in `api/README.md` and `docs/deployment.md`.
