# KOJ — Agent Brief (read this first, then CONTEXT.md, then SRS.md)

You are working on **KOJ (Kottayam Online Judge)**, a self-hosted competitive-programming
platform for IIIT Kottayam. Mission: make the website genuinely excellent — closer to
**Codeforces** than LeetCode — clean it of all AI artifacts, and make every feature really work.

## Mission

1. **De-slop the UI.** Remove anything that looks AI-generated: pointless emojis, lorem ipsum,
   decorative filler, dead buttons,endi placeholder text. If a control is visible, it must work.
   If a feature cannot work, remove its UI — never leave fake controls.
2. **Codeforces-grade feel.** Dense data tables, clear verdicts, live standings, intuitive contest
   flows. Keep the existing dark neon-terminal theme (`app/globals.css` tokens:
   `--color-kjprimary: #00ff9d` etc.) — polish within it, don't rebrand.
3. **Role separation is absolute.** Participants must NEVER see admin/staff UI: no ADMIN links,
   no setter buttons, no admin pages. Server gates (`app/api/admin/authz.ts`) are the source of
   truth; the UI must mirror them. Test every change as signed-out, contestant, and admin.
4. **Real, not fake.** Every button does what it says. No mocked data, no console errors,
   empty states always offer a next action. Verify in a real browser with screenshots.

## How to work here

- Stack: Next.js 16 App Router + React 19 + TypeScript + Tailwind v4, Drizzle ORM on Neon
  Postgres, Clerk auth, separate FastAPI judge service in `api/`.
- Env: `cp share.env .env.local` (share.env is gitignored, never commit it). Run `npm run dev`
  (port 3000). Judge locally via `api/` or point `FASTAPI_URL` at the Cloud Run URL in share.env.
- Before finishing anything: `npx tsc --noEmit`, `npm run lint`, `npm run build` — all green.
- Minimal diffs. No refactors of working code, no reformatting, no new visual language.
- No test runners installed: verify with the browser + API checks, delete any scratch scripts
  when done. Never leave test files, fixtures, or screenshots in the repo.
- **Never commit secrets.** `.env*` and `share.env` are gitignored. No keys/tokens in code,
  commits, or chat beyond what's already in share.env.
- **Git:** you are working from a ZIP copy with no remotes. DO NOT push anywhere, do not
  create PRs, do not touch `Asterisk-Hunter/KOJ` in any way. Deliver your work as changed
  files + a short summary of what changed and how it was verified.

## Framework gotchas (Next.js 16 breaks training data)

- Use `proxy.ts`, NEVER create `middleware.ts` (build fails if both exist).
- `<ClerkProvider>` goes inside `<body>`, never wrapping `<html>`.
- Sign-in/up routes are catch-alls (`app/sign-in/[[...sign-in]]/page.tsx`); don't simplify them.
- `auth()` is async — always `await` it. Use `@clerk/nextjs`, not `@clerk/clerk-react`.
- Gate `SignInButton`/`SignUpButton` on auth state (single-session mode throws otherwise).

## Auth model (do not redesign without asking)

- DB roles are the single source of truth: `contestant | problem_setter | contest_setter | admin`
  (`db/schema.ts`, default `contestant`). Clerk org roles are NOT consulted (orgs disabled).
- `ADMIN_CLERK_IDS` env bootstraps the first admin. Admin APIs live under `app/api/admin/*`,
  gated by `requireAdmin`/`requireContestManager`/`requireSetter`/`requireStaff`.
- Webhook endpoint exists at `app/api/webhooks/clerk`; profile sync also happens on-request,
  so webhooks are non-critical.

## When blocked, stop and send the user an exact prompt

If you need a dashboard click, an account, a secret, quota, or anything outside the repo,
do NOT guess or work around it. Send the user a message with: (1) exactly what to click or
paste, (2) why it's needed, (3) what you will do the second they reply. Then wait.
