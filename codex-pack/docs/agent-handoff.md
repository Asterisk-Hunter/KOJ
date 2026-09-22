# KOJ Agent Handoff

Continuing development in this repo? Read this first, then ask the user for the missing details below. Do not guess on repos, prod mutations, credentials, or deploys.

## Repo and delivery policy

- Work only in `/home/prajwal-k/Projects/KOJ`.
- Push and open PRs only on `Prajwal-k-tech/KOJ`.
- Current: `main` is the delivery branch (owner exception 2026-09-21 permits direct pushes; see `AGENTS.md` rule 1).
- Never use `Asterisk-Hunter/KOJ` for code. The KOJ Neon project lives under the Asterisk-Hunter org — database location only, unrelated to code remotes.
- Session state lives in `.slim/deepwork/koj-finish-v1.md` (git-local, OpenCode-readable). Deliverables belong in project paths (`app/`, `api/`, `db/`, `docs/`).

## Current state

- SRS High + agreed Codeforces/DOMjudge contest essentials are implemented and gated-reviewed.
- Database is fully migrated (email unique, `case_results`, 6 perf indexes — applied and verified live).
- Redis is optional: code runs DB-only when `REDIS_URL` is unset; no Upstash instance exists yet.
- Latest closeout diff: contest editorial hiding in `app/api/problems/[id]/route.ts`; arena solved/attempts badges in `app/contests/[id]/arena/page.tsx`.
- Validation before push: `npx tsc --noEmit`, `npm run lint`, `npm run build`. No test runner is installed; do not leave test files behind (see `AGENTS.md` rule 5).

## Ask the user for these before continuing

1. **Target confirmation:** repo (`Prajwal-k-tech/KOJ`), branch, and PR number to update; who merges and when.
2. **Clerk instance:** dev vs prod, app/instance ID, and explicit approval for any production mutation.
3. **Clerk dashboard-only items:** OAuth providers, organization membership/creation settings, webhook endpoint plus `CLERK_WEBHOOK_SECRET` destination in Vercel.
4. **Neon access:** database/branch, how migrations should be applied, and approval to apply pending migrations; report the duplicate-email precheck before adding unique constraints.
5. **Vercel:** project, preview vs production, environment variables to set, and deploy approval.
6. **Cloud Run judge:** project/region/service, deploy approval, and resource limits.
7. **Redis/Upstash (optional):** REST URL plus token, or explicit approval to skip; never block core behavior on Redis.
8. **Test accounts and smoke data:** admin and contestant credentials (or permission to create test users), contest/problem IDs, expected verdicts, and whether CAPTCHA-gated signup may be attempted.
9. **Scope confirmation:** SRS vs extra Codeforces-style requests; rating, scoreboard freeze, clarifications, and team mode are out unless explicitly approved.
10. **Testing policy:** keep `AGENTS.md` rule 5 (verify-then-delete, no committed runner) unless the user explicitly amends it.

## Access and safety rules

- Never paste secrets, keys, tokens, or connection strings into code, commits, chat, or docs.
- Read-only first: reproduce/verify with file:line evidence before changing code.
- Keep diffs minimal; do not refactor unrelated code or reformat files.
- Production mutations need explicit user approval after a dry run or exact-command preview.

## Manual completion runbook (user-only steps)

### 1. Clerk: go to production (recommended, ~5 min)
1. Open the **Asterisk-Hunter → KOJ** app in the Clerk dashboard (this is the instance production authenticates against).
2. Click **Go to prod** to create the production instance.
3. Under User & Authentication → Social connections, enable **GitHub** and **Google**.
4. Paste the new **prod** keys (`pk_live_...`, `sk_live_...`) to the agent.
5. Agent then: swaps Vercel prod envs, redeploys, verifies logins land in the prod instance.

### 2. Clerk webhook endpoint (optional, ~2 min — profile sync already works via upsert)
1. In the same app: Webhooks → Add Endpoint → URL `https://koj-peach.vercel.app/api/webhooks/clerk`.
2. Subscribe to `user.created`, `user.updated`, `user.deleted`.
3. Paste the signing secret to the agent, who sets `CLERK_WEBHOOK_SECRET` in Vercel and verifies delivery.
4. Skipping this only loses deleted-user cleanup; everything else syncs on request.

### 3. Upstash Redis (optional, ~3 min — site is fully correct without it)
1. Sign in at console.upstash.com → Create Database → name `koj-cache`, region Mumbai (`ap-south-1`).
2. Paste the REST URL + token to the agent.
3. Agent then: sets Vercel `REDIS_URL`/`REDIS_TOKEN` + Cloud Run `REDIS_URL`, redeploys the judge, verifies cache hits.

### 4. Signed-in smoke run (~15 min)
Follow `/tmp/koj-smoke/SMOKE-SCRIPT.md` (ask the agent to paste it here): admin creates → publishes → contestant registers → submits → verdict → standings, plus moderation spot-checks.
