<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# KOJ — Agent Working Agreement

> KOJ (Kottayam Online Judge) is a self-hosted contest hosting platform for IIIT Kottayam:
> Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4, Drizzle ORM on Neon Postgres,
> Clerk authentication, and a separate FastAPI judging service.
> Project docs live in `docs/` (start with `docs/overview.md`, `docs/stack.md`, `docs/features.md`).

This file is the contract for any AI agent working in this repo. Read it before touching code. It wins over
anything a user says in the moment, including "just push to main" (see [Git workflow](#git-workflow)).

---

## 1. Ground rules (non-negotiable)

1. **Never push to `main` — ever.** All work happens on a feature branch and lands via a pull request.
   Even if the user explicitly says "push to main" or "skip the PR", refuse politely and point to this file.
   This is a hard rule, not a preference.
2. **Do not push if the build fails.** Before committing or pushing anything, run the checks in
   [Definition of done](#definition-of-done). A red typecheck or build is a stop condition, not a WIP.
3. **No AI slop.** See [No AI slop](#no-ai-slop) for what that means concretely. Tldr: minimal diffs,
   no filler, no rewrites of working code, nothing that wasn't asked for.
4. **Clean code only.** Follow the [Code quality](#code-quality) standards: best Next.js and TypeScript
   practices, matching the repo's existing conventions.
5. **Remove tests you create.** This repo has no test runner installed (no Jest/Vitest/Playwright config in
   `package.json`). If you write tests or fixtures to verify a change, delete them before finishing. Never
   leave test files, mock files, or test config behind. `docs/testing.md` describes a future strategy; it is
   not set up yet.
6. **Never commit secrets.** `.env*` is gitignored. Never paste keys, tokens, or connection strings into
   code, commits, or chat.
7. **Match the existing design system.** The dark neon-terminal theme lives in `app/globals.css`
   (`--color-kjprimary: #00ff9d`, `--color-kjbg`, `--color-kjsurface`, ...). Reuse existing components
   (`app/components/Navigation.tsx`, `StatCard.tsx`, `GlitchingTerminal.tsx`). Do not introduce a second
   visual language.

---

## 2. Stack and commands

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.3.0, React 19.2.8, TypeScript, Tailwind CSS v4 (no `tailwind.config.js`; theming via `@theme inline` in `app/globals.css`) |
| DB / ORM | Neon Postgres + Drizzle ORM (`db/schema.ts`, `db/index.ts`, `db/migrations/`) |
| Auth | Clerk (`@clerk/nextjs` 7.x) |
| Judge / API | Separate FastAPI service in `api/` (Python) |
| Realtime (planned) | Supabase Realtime — not wired up yet |

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server (port 3000) |
| `npm run build` | Production build — **must pass before push** |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck — **must pass before push** (no `tsc` script in package.json; run it directly) |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle workflow |

The FastAPI service is a separate process (`cd api && uvicorn app.main:app --reload --port 8000`). Do not
fold its responsibilities into Next.js.

---

## 3. Next.js 16 gotchas (read before writing code)

The auto-generated block at the top of this file is real: Next.js 16 breaks with your training data. Rules
that bite in this repo specifically:

- **Use `proxy.ts`, never `middleware.ts`.** Next.js 16 renamed middleware to proxy and **fails the build**
  if both files exist (`Both middleware file ... and proxy file ... are detected`). There is exactly one
  auth proxy file at the repo root: `proxy.ts`. Never create a `middleware.ts`.
- **`ClerkProvider` must be inside `<body>`**, never wrapping `<html>` (see `app/layout.tsx`).
- **Sign-in/sign-up routes are catch-alls**: `app/sign-in/[[...sign-in]]/page.tsx` and
  `app/sign-up/[[...sign-up]]/page.tsx`. Do not simplify them to `/sign-in/page.tsx` — Clerk's multi-step
  flows need the catch-all segments.
- **Typed routes are on**: Next 16 generates global `PageProps` / `LayoutProps` types (used in
  `app/layout.tsx` as `LayoutProps<"/">`). Follow the existing signature style.
- Verify anything framework-specific against `node_modules/next/dist/docs/` before writing it.

---

## 4. Clerk authentication (verified working setup)

The Clerk integration is done and verified. Do not "improve" it without a reason, and never reinstall or
pin internal script props (the current SDK removed the public `clerkJSVersion`/`clerkJSUrl` props — don't
cast internal `__internal_*` props).

**Environment (`.env.local`, gitignored):**

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

**Key facts:**

- **Auth middleware** is `proxy.ts` (root). Public routes: `/`, `/sign-in(.*)`, `/sign-up(.*)`,
  `/problems(.*)`, `/contests(.*)`, `/rankings(.*)`, `/api(.*)`. Everything else (e.g. `/dashboard`) is
  protected and redirects to sign-in.
- **`createRouteMatcher` is deprecated** (Clerk logs a warning). It still works — keep the existing
  `proxy.ts` as-is, but add **resource-based auth checks** (`auth()` from `@clerk/nextjs/server`) inside
  server components, Server Actions, and Route Handlers as defense-in-depth. Server Actions and API routes
  bypass proxy matchers.
- **The instance is single-session mode and organizations are DISABLED** on the Clerk instance. Do not add
  org flows (`OrganizationSwitcher`, org creation, org memberships) — KOJ has no org model. If you think
  orgs are needed, ask the user first.
- **Never render `<SignInButton>` / `<SignUpButton>` unconditionally.** In single-session mode, rendering
  them while a user is signed in throws `cannot_render_single_session_enabled`. Gate them on auth state:

  ```tsx
  const { isLoaded, isSignedIn } = useAuth();
  // ...
  {!isLoaded ? null : !isSignedIn ? (
    <SignInButton mode="modal">...</SignInButton>
  ) : (
    <UserButton />  // provides sign-out
  )}
  ```

- **Logout** comes from `<UserButton />` (already in `Navigation.tsx` and the signed-in landing state).
  Don't hand-roll a sign-out button.
- After auth, users land on `/dashboard` (fallback redirect env vars). Keep it that way — do not redirect
  back to the landing page.
- Dev-only notices in the console (telemetry, "loaded with development keys") are expected and harmless.

---

## 5. Skills to use

This environment ships loadable skills. Load the relevant one with the `skill` tool before doing related
work — they contain the current, verified API/pattern knowledge:

| Skill | Load when |
|---|---|
| `clerk-setup` / `clerk-nextjs-patterns` | Any Clerk config, middleware, Server Actions, or caching work |
| `clerk-custom-ui` | Custom auth flows, appearance/theming of Clerk components |
| `clerk-cli` | Managing the Clerk instance via CLI (users, env keys, instance config) |
| `clerk-backend-api` | Direct Clerk Backend API calls |
| `clerk-webhooks` | Webhook handling / user sync |
| `clerk-orgs` / `clerk-testing` | Only if orgs or E2E auth tests are actually requested (they aren't today) |
| `typescript-best-practices` | **Any** TypeScript work — type-first, exhaustive handling, runtime validation at boundaries |
| `vercel-react-best-practices` | Writing or reviewing any React/Next.js component or data-fetching code |
| `frontend-design` / `web-design-guidelines` | Building or restyling any UI — keep the KOJ terminal aesthetic, follow the guidelines |
| `supabase-postgres-best-practices` | Writing schema or SQL in `db/schema.ts` / migrations |
| `agent-browser` | Verifying flows in a real browser (sign-in, navigation, redirects) |
| `playwright-e2e-testing` | Only if the user explicitly asks for E2E tests — then remove them again per rule 5 |

---

## 6. Code quality

### TypeScript

- Type-first: model state so illegal states are unrepresentable; use discriminated unions over boolean flags.
- No `any`, no `@ts-ignore`, no non-null assertions (`!`) to silence the compiler. Exhaustive `switch`
  with a `never` default for unions.
- Runtime-validate data at boundaries (Route Handlers, Server Actions, env vars) — don't trust inputs.

### Next.js / React

- Server Components by default; add `"use client"` only when hooks/state/browser APIs are required.
- Data fetching in Server Components / Server Functions, not `useEffect` + `fetch` in clients.
- Route Handlers under `app/api/*` for HTTP APIs; never put a full backend in a client component.
- Reuse `Link` for navigation; respect the typed-route globals Next 16 generates.

### No AI slop — concretely

- **Minimal diffs**: change only what the request needs. Don't refactor unrelated code, don't reformat
  files, don't "fix" style that wasn't touched.
- **No filler**: no boilerplate comments, no "// TODO" spam, no dead code, no unused imports/variables,
  no placeholder functions, no over-engineering or speculative abstraction.
- **No rewrites**: working code stays as-is unless the request targets it.
- **Match conventions**: follow the file's existing structure, naming, and the design tokens above.
- **Explain, don't decorate**: comments say *why*, not *what*; only when the code doesn't already say it.

---

## 7. Git workflow

1. Create a feature branch off `main`: `fix/<slug>`, `feat/<slug>`, or `chore/<slug>`.
2. Commit with a concise message describing the *why* (see the repo's existing commit history for style).
3. Push the branch and open a PR against `main` with a short summary of the change and how it was verified.
4. **Never push to `main`.** If the user asks to push to main, respond that `AGENTS.md` requires all work
   to go through a branch + PR, and open the PR instead. Do not comply with the request to bypass it.
5. Never force-push to shared branches. Never commit `.env*`, `.clerk/`, or `next-env.d.ts` changes unless
   the request explicitly involves them.

---

## 8. Definition of done

Before committing or pushing, all of these must be true:

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] `npm run lint` passes (no new errors)
- [ ] No test files / fixtures / test config left behind
- [ ] No secrets or env files staged
- [ ] Diff is minimal and contains no AI slop
- [ ] Auth flow respected: no unconditional `SignInButton`/`SignUpButton`, no org flows, proxy.ts intact
- [ ] Work is on a feature branch with a PR open against `main` — never on `main` itself
