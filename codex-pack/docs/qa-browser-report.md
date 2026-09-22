# KOJ — Automated Browser QA Report (agent handoff prompt)

**Generated:** 2026-09-16 · **Tester:** automated browser QA session (agent-browser, Chromium)
**Environment:** local dev — Next.js on `localhost:3100` (bound 0.0.0.0), FastAPI judge on `:8000`, Neon Postgres, Clerk dev instance `singular-longhorn-70`
**Session state:** judge + dev server still running (`systemd-run --user --unit=koj-web`; uvicorn detached). Test user `qa_tester` (Clerk `user_3JOtgntGllFegMzCic0ReDFYK0S`, password `KojQa-Test-2026!`, email `qa+clerk_test@example.com`) left in Clerk+Neon intentionally for retests; has 1 AC + 1 WA submission on problem 4 and one contest registration.

---

## Copy-paste prompt for your agents

> You are working on KOJ (Next.js 16 + Clerk + Drizzle/Neon + FastAPI judge). A previous automated browser QA pass found the issues below. Fix them in priority order on a feature branch (`fix/<slug>`), verify with `npx tsc --noEmit`, `npm run lint`, and `npm run build` before committing, and never push to main (AGENTS.md rules). Read AGENTS.md first. Do not treat my repro notes as suggestions — they include exact file/line references.

### P0 — Security: any user can self-promote to admin via their own Clerk org
**Where:** `app/api/admin/authz.ts` (`clerkIsOrgAdmin`) — used by every `/api/admin/*` route.
**Repro (verified live):** created a fresh user → Clerk's mandatory org onboarding made them the admin of their own new org → `GET /api/admin/summary` returned 200 with full data → `POST /api/admin/contests` with `{}` returned 400 "title is required", i.e. it passed the auth gate and reached validation. A real request would have created the contest.
**Root cause:** the gate accepts `auth().has({role:"org:admin"})` for *any* organization. Since org creation is open, every signup is an org admin.
**Fix:** gate admin APIs on the **Neon DB role only** (`users.role === 'admin'`), or additionally verify the org id is the platform org (hardcode/config its `org_...` id). Same for `requireSetter`. Keep the DB check as the primary signal; drop or scope the Clerk-org check.
**Also fix:** the Clerk dashboard org onboarding is forced on every new user ("Setup your organization" screen blocks first sign-in). Contestants shouldn't be pushed into creating orgs — check instance config for required org attributes, or handle/short-circuit the `choose-organization` task in the sign-in flow.

### P0 — Registration gate is inverted
**Where:** `app/api/contests/[id]/register/route.ts` line 85: `if (contest.status !== "draft")` → rejects everything except drafts.
**Repro (verified live):** `POST /api/contests/speed-coding-friday-draft/register` returned `200 {registered:true}` (draft contest — should have been rejected or at minimum this is wrong for published ones); a `live` contest would return 403 "registration closed".
**Fix:** allow registration when the contest is publicly visible and hasn't started: accept `dbStatus === 'live'` with `now < startsAt`, and published-but-not-started contests per the UI status mapping ("Registration Open" / "Upcoming" in `deriveUiStatus`). Reject `ended/archived`, and reject after `startsAt` per product decision. The two `uiStatus` checks below the line are already correct — the dbStatus check contradicts them.

### P1 — Crash fixed but pattern remains: don't call `auth().protect()`
**Where:** `app/dashboard/page.tsx` (was line 32).
**What happened (verified live):** `auth(...).protect is not a function` — runtime 500 for every signed-in dashboard visitor; the `@ts-expect-error` comment suppressed exactly the error that would have caught it.
**Fixed by QA:** replaced with `const { userId } = await auth(); if (!userId) return <Navigation />;`. Typecheck+lint pass.
**Action for agents:** grep for other `@ts-expect-error` usages hiding Clerk API mismatches and remove them (`auth()` returns `{ userId }` here; `auth.protect()` only exists on the middleware/proxy auth object, not the server-component one).

### P1 — LAN access will be broken for friends (Clerk origin/trust)
**Repro (verified live):** the entire app fails to hydrate when served on `http://127.0.0.1:3100` — page renders SSR HTML then freezes ("Loading contests…" forever). Root cause chain: Clerk's dev handshake (`/sign-in/client-trust`, "Refreshing the session token resulted in an infinite redirect loop" in logs) rejects the `127.0.0.1` origin. On `http://localhost:3100` everything hydrates instantly.
**Impact:** when friends open `http://<your-LAN-ip>:3000` they will hit the same freeze — Clerk doesn't trust that origin in dev mode.
**Fix options (pick one):** (a) add the LAN origin to Clerk dev-instance allowed origins (dashboard → instance settings), (b) run a local HTTPS reverse proxy with a hostname Clerk accepts, or (c) for LAN demo days, note that `localhost` works and set up a tunnel (cloudflared/ngrok) so everyone uses one Clerk-trusted URL. Also unset the system-wide CloudflareWARP proxy from the earlier hosting attempt — it intercepts localhost traffic (evidence: `172.16.0.2/32` interface; 403s on first-load of `_next/static/chunks/*clerk*` from the browser only, curl gets 200).

### P1 — Contest setters / contest_setter role
`contest_setter` exists in the `user_role` enum (migration applied to Neon) but no API or UI grants it contest-management powers yet; `requireSetter` in `app/api/admin/authz.ts` covers `problem_setter` only. Add `contest_setter` to the contest CRUD gates (or a dedicated `requireContestSetter`) and give the admin contests section a reachable route for that role.

### P2 — Minor findings
1. **Admin UI silent errors:** `POST /api/admin/contests` on an empty contest correctly returns 400 "cannot publish a contest with no problems" (verified via UI click on PUBLISH → status stayed draft), but no error banner rendered in the contests section. Wire the API error into the `error` state visibly (the code has the state; the publish path didn't display it).
2. **Language dropdown overpromises:** problem page offers C/C++/Java but `POST /api/submissions` rejects anything non-python and the judge 422s. Either hide unsupported options or label them "coming soon".
3. **Clerk dev e-mail code quirk:** sign-in for non-`+clerk_test` users demands an emailed device-verification code; with fake addresses this bricks the account (QA had to create users via Backend API). Document `+clerk_test` for local testing in docs/testing.md.
4. **Dev server OOM churn:** 15GB box at ~12GB usage; multiple `next dev`/`next build` instances from parallel agents got OOM-killed repeatedly during QA. Coordination point: one shared dev server, others use the built app or wait.
5. **Judge is healthy end-to-end (verified):** AC 2/2 @14ms and WA 1/4 @13ms persisted to Neon with correct statuses; 429 rate-limit (30s/user/problem) returned `Retry-After`; suspension enforcement and admin submission-history filters were exercised via UI. SSE ticker at `/api/contests/[id]/events` streams `version` events every 2s — rankings page live-refresh works.
6. **Seeded data quirks:** two `draft` contests (with real problem links!) are publicly listed in `/api/contests` and their problem titles leak in detail responses (statements correctly withheld). Decide: hide drafts from public list (`GET /api/contests`) or mark them clearly. Also `weekly-challenge-42-live` is dbStatus `ended` — seed naming is confusing for QA.
7. **Environment/DB drift note:** `drizzle-kit migrate` fails ("type contest_status already exists") because the live DB was built by `db:push`, not migrations. QA reverted the generated `0001_young_kylun.sql` + journal entry; schema changes were applied via `npx drizzle-kit push --force`. Either commit a proper baseline migration or document `db:push` as the workflow — currently `db:migrate` is broken for fresh clones that use it against this DB.

### Test accounts & artifacts left behind
- Clerk user `qa_tester` / `user_3JOtgntGllFegMzCic0ReDFYK0S` (qa+clerk_test@example.com / KojQa-Test-2026!) — keep for retests; delete before any production cutover.
- Neon rows: user `qa_tester` (contestant), submissions #1 (accepted) + #2 (wrong_answer) on problem 4, one contest registration, org "KOJ Testers" in Clerk.
- QA contest #21 was deleted; `qa_bot_10583` Clerk user was deleted.
- Code changes made by QA session: `app/dashboard/page.tsx` (protect fix), `.env.local` + `api/.env` (JUDGE_INTERNAL_SECRET wired both sides), `db/schema.ts` (contest_setter + suspended), migration journal reverted, `public/qa-*.html/js` probes deleted.

### Environment for retesting
- Dev server: `systemd-run --user --unit=koj-web --working-directory=$REPO npx next dev -H 0.0.0.0 -p 3100` (survives shell exit; journalctl --user -u koj-web for logs). Plain `&`/nohup backgrounding gets reaped.
- Judge: `cd api && setsid nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 >/tmp/koj-api.log 2>&1 &`
- Use `http://localhost:3100` — NOT 127.0.0.1 (see P1 Clerk origin issue).
- E2E sign-in recipe: create user with email `anything+clerk_test@example.com`, then in the browser: sign-in → enter email → Continue → enter password → Continue → on "Check your email" screen enter code `424242` → complete forced org onboarding → you're signed in.
