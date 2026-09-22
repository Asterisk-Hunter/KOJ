# KOJ — Agent Brief (read this first, then CONTEXT.md → TASKS.md → SRS-TRACEABILITY.md)

You are the senior engineer taking over **KOJ (Kottayam Online Judge)**, a self-hosted
competitive-programming platform for IIIT Kottayam. The site is live and used by real
students. Your job: make it **genuinely excellent and unmistakably professional** —
a Codeforces-grade product, not a demo.

Read `CONTEXT.md` next (verified live state as of 2026-09-22, including the judge outage
that was diagnosed and fixed today), then `TASKS.md` (prioritised backlog) and
`SRS-TRACEABILITY.md` (requirement-by-requirement status with evidence).

---

## 1. The five things that matter

1. **Nothing fake.** Every visible control performs the action it advertises. No mock data,
   no placeholder buttons, no dead links, no lorem text. If a feature cannot work, remove
   its UI — never ship a control that shows a 403/500 after the click.
2. **Role separation is absolute.** A contestant must never see a single admin, setter, or
   contest-manager affordance. Not greyed out, not disabled — absent. See §3.
3. **Codeforces feel.** Dense, information-first, calm. Verdict language and colour,
   monospaced numeric columns, compact standings, zero decoration that does not carry
   information. See `UI-SPEC.md` for the concrete direction and the de-slop checklist.
4. **It must actually run.** Any change is verified in a browser as the correct role, with
   the judge answering real verdicts. "Builds green" is not "works".
5. **Minimal diffs.** Touch only what the task requires. No reformatting, no drive-by
   refactors, no new visual language, no new dependencies without a reason.

---

## 2. Stack and how to run it

| Layer | Technology | Where it runs |
|---|---|---|
| Frontend + API | Next.js 16.3 App Router, React 19, TypeScript, Tailwind v4 | Vercel (`koj-peach.vercel.app`) |
| Database | Neon Postgres + Drizzle ORM (`db/schema.ts`) | Neon, `ap-southeast-1` |
| Auth | Clerk (`@clerk/nextjs` 7.x) | Clerk instance `singular-longhorn-70` (**see BLOCKERS.md #1**) |
| Judge | FastAPI in `api/` — compile + execute only | Cloud Run `koj-judge`, `asia-south1` |
| Cache/realtime | SSE + optional Upstash Redis (`lib/redis.ts`, `api/app/cache.py`) | DB-only is always correct |

```bash
cp share.env .env.local      # this pack's share.env is the current env (it is gitignored)
npm install && npm run dev    # http://localhost:3000
cd api && uvicorn app.main:app --reload --port 8000   # local judge (optional)
```

Definition of done before you hand anything back:

```bash
npx tsc --noEmit && npm run lint && npm run build
python3 -m py_compile api/app/*.py     # if you touched api/
```

There is **no test runner installed** and `AGENTS.md` rule 5 forbids leaving test files
behind. Verify with the browser and API calls; delete every scratch file, fixture, and
screenshot before you finish. `scripts/judge-smoke.py` in this pack is the one reusable
harness — keep it outside the repo.

---

## 3. Authorization model (do not redesign without asking)

**DB roles are the single source of truth.** Clerk Organizations are *not* consulted.
`users.role` ∈ `contestant | problem_setter | contest_setter | admin` (`db/schema.ts`).

Enforcement lives in `app/api/admin/authz.ts`:

| Gate | Accepts | Used by |
|---|---|---|
| `requireAdmin()` | `ADMIN_CLERK_IDS` allowlist, or DB `admin` | users, metrics, moderation, submissions admin |
| `requireSetter()` | DB `admin` or `problem_setter` | problem CRUD, test cases, import |
| `requireContestManager()` | DB `admin` or `contest_setter` | contest CRUD, contest problems |
| `requireStaff()` | any of the three | `/api/admin/summary` |

`GET /api/auth/me` is the UI's only source of truth for visibility. It returns
`{ authenticated, role, canAccessAdmin, canAuthor, canManageContests }`.

**Rules for the UI side:**

- Hiding is mandatory. A 403 after a click is a bug, not a solution. (This was a real user
  complaint — see `CONTEXT.md` "Fixed / decided".)
- Follow the pattern already proven in `app/problems/create/page.tsx`: signed-out notice →
  access check → 403 panel → real content, driven by the flags above.
- Sign-in/up buttons must be gated on `isLoaded`/`isSignedIn` (single-session mode throws
  if you render them while signed in).
- Copy that implies a capability must be conditional too: don't tell a contestant that
  "problem setters upload test cases" in a place only contestants ever see.

---

## 4. Judge and submission pipeline

```
problem page / arena
  → POST /api/submissions {problemId, contestId?, language, code, mode:"run"|"submit"}
      auth → validate → contest window + registration checks → 30s advisory-lock rate limit
      → insert submission (pending → running) → 202 {id}
      → fire-and-forget POST {FASTAPI_URL}/judge-async {submission_id} (X-Judge-Secret)
  → FastAPI loads submission + problem limits + test cases → execute_judge()
  → verdict written to Neon → UI updates via SSE (/api/submissions/[id]/events)
```

**Two sandbox backends** in `api/app/judge.py`, chosen by `JUDGE_SANDBOX_MODE`
(`auto` default → docker when the CLI exists, else rlimit):

- `docker` — container sandbox (network none, read-only root, cap-drop ALL, seccomp
  profile, pids/memory/cpu limits). The hardened path; needs a Docker host.
- `rlimit` — host toolchain with `RLIMIT_CPU/AS/NPROC/FSIZE` + wall timeout + process-group
  kill. This is the isolation level the SRS sanctions (§2.5 constraint 3) and the only
  backend Cloud Run can run. **It is what production uses today.**
- `docker` is *fail-closed*: no daemon ⇒ infra-flagged `runtime_error`, never a silent
  false verdict. Keep that property if you touch it.

**Supported languages — all seven, verified live (AC + TLE each):** `python`, `c`, `c++`,
`java`, `go`, `rust`, `javascript`. The SRS requires the first four (REQ-JUDGE-02) and lists
Go/Rust/JS as medium-priority TBD-03; they are implemented, so the requirement is exceeded,
not merely met. The list is duplicated in four places — keep them in sync:
`api/app/config.py`, `app/api/submissions/route.ts`, `app/api/judge/run/route.ts`, and the
editor + starter templates in `app/components/CodeMirrorEditor.tsx` /
`app/problems/[id]/page.tsx`. Adding a language there without a live AC + TLE verification is
not done.

Known sharp edges (all discovered by live testing on 2026-09-22):

- `RLIMIT_NPROC` counts **every task of the UID**, threads included. A fixed small value
  makes `g++`/`javac` die with `posix_spawn: Resource temporarily unavailable`. The
  allowance is therefore derived from the host's live task count plus a 64-task headroom.
- `RLIMIT_AS` breaks the JVM, the Go arena and V8, so Java gets **no** address-space cap
  (`-Xmx` derived from the problem limit is its memory limit), Go is bounded by
  `GOMEMLIMIT`, and Node by `--max-old-space-size`. Documented deviation — see
  `SRS-TRACEABILITY.md` REQ-JUDGE-06.
- `RLIMIT_FSIZE` applies to the **run** phase only. Applying it during compilation makes
  `rustc` fail to write its linker output, which surfaces as a bogus contestant CE.
- A **missing toolchain is infrastructure failure**, never a compilation error. Each language
  declares its required binaries in `_LOCAL_TOOLCHAIN`; the result is an infra-flagged
  `runtime_error`. Never let an absent `gcc` look like a contestant's mistake.
- Go needs a writable `GOCACHE` **shared process-wide** and warmed at start-up, otherwise
  every submission recompiles the standard library (10–16 s each). `GOTMPDIR` must point at
  a directory that already exists or the compile fails outright.
- **A verdict must never be `accepted` unless a real test case passed.** `total == 0` used to
  fall through to `accepted`, so a problem with no test cases AC'd every program — a false
  verdict, the one thing SRS §5.4 forbids outright. It now returns `runtime_error` +
  `infra_error`, and publish is refused without test cases. Keep both properties; the smoke
  script asserts the judge half.
- Prefer honouring the SRS's cheap asks: a Docker host is a *hardening* upgrade only. If
  Docker is unavailable, use `rlimit` and record it — do not disable judging.
- Java requires `public class Solution`. Codeforces users type `class Main`. Decide whether
  to accept `Main` (the templates in the UI currently emit `Solution`).
- Verdicts: `accepted, wrong_answer, time_limit_exceeded, memory_limit_exceeded,
  runtime_error, compilation_error, presentation_error`. `infra_error=true` means *your
  infra*, never the contestant's code.

---

## 5. Next.js 16 gotchas (your training data is wrong here)

Read `node_modules/next/dist/docs/` before writing framework code. Specifically:

- `proxy.ts` is the middleware file. **Never create `middleware.ts`** — the build fails when
  both exist.
- `<ClerkProvider>` goes inside `<body>`, never wrapping `<html>`.
- Sign-in/up are catch-alls: `app/sign-in/[[...sign-in]]/page.tsx`. Don't simplify them.
- Typed routes are on (`LayoutProps<"/">`, `PageProps`) — follow the existing signatures.
- `auth()` is async; always `await` it. Import from `@clerk/nextjs/server` in server code.
- Route handlers in this repo use `export const runtime = "nodejs"` and
  `export const dynamic = "force-dynamic"`.

---

## 6. Hard rules (inherited from `AGENTS.md`, still binding)

- Never commit secrets. `.env*` and `codex-pack/share.env` are gitignored — keep it that way.
- Never push to any repo other than what the human names. Never touch `Asterisk-Hunter/KOJ`
  (that GitHub org hosts the Neon project only — no code).
- No `any`, no `@ts-ignore`, no non-null assertions to silence the compiler. Validate inputs
  at every route boundary (`app/api/body-guard.ts` has the bounded-body helper).
- Reuse the existing components and tokens (`app/globals.css`, `Navigation.tsx`, `StatCard.tsx`,
  `PageHeader.tsx`, `RouteLoading.tsx`). Do not add a second design language.
- Migrations: duplicate filename pairs (`0002_*`, `0003_*`) exist from parallel workers.
  Check `db/migrations/meta/_journal.json` first, use `IF NOT EXISTS`, and verify the live
  column/index afterwards. **`db/schema.ts` and Neon have already drifted once** — see
  `CONTEXT.md` "Known defects".
- Deploys are not automatic. The human runs `vercel --prod` for the web app and
  `gcloud run deploy koj-judge --source api --region=asia-south1` for the judge. After any
  deploy, curl the health endpoint: web `/api/health`, judge `/health` (must report
  `"sandbox":"rlimit"` or `"docker"`).

---

## 7. When you are blocked, stop and ask with an exact prompt

Anything outside the repo (a dashboard click, a secret, a quota, a permission, a paid
resource) is **not** something to guess or route around. Stop and send the human this,
and nothing vaguer:

```
BLOCKED: <one-line title>

What I need you to do (exact steps):
1. <click path / command / value to paste>
2. ...

Why: <the specific failure or requirement this unblocks>

What I will do the moment you reply:
1. <concrete action>
2. <how I will verify it worked>

If you would rather not: <the acceptable fallback, and what it costs in behaviour>
```

`BLOCKERS.md` already contains ready-made prompts for the known blockers — send those
as-is if they are still open, and add new ones in the same shape.
