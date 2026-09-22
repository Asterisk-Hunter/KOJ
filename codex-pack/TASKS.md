# KOJ — Backlog

Ordered. Every item has an acceptance test — something you can run or click that proves it.
P0 blocks real users; P1 makes it feel professional; P2 is the deferred SRS tail.

---

## P0 — production correctness

### P0-1. Commit + push — the frontend de-slop is not live
Two different deploy paths mean the system is half-shipped:

- **Backend: live.** Cloud Run was deployed with `gcloud run deploy --source api`, which uploads
the local directory. The rlimit restore and the seven languages are running in production
*without ever passing through git*.
- **Frontend: not live.** Vercel builds from the git repository, and the de-slop is uncommitted.
  `curl https://koj-peach.vercel.app/` still contains `terminalGlitch`, `terminal-crt-glow`,
  `scanline`, `text-glow`, `bg-grid` and `IIITK Judge` ×2; anonymous `/api/problems` still
  returns `"status":"unsolved"`.

Until it is committed and pushed, any checkout, rebase, or `git clean` destroys the backend fix
(which is in no commit) while production keeps serving the old UI. 16 modified files,
`GlitchingTerminal.tsx` deleted, 12 untracked paths including this pack.
**Done when:** committed and pushed, `git status` is clean, Vercel redeploys, and the `curl`
above returns **no** glitch classes and **no** `IIITK Judge`; a rebuild from HEAD still answers
`"sandbox":"rlimit"` on `/health` and `accepted` for all seven languages.

### P0-2. Recover the two orphaned submissions
Submissions 11 and 12 are `pending` + `judge_infra_error=true` from the outage window and are
never re-dispatched, so their authors see a submission that never finishes.
**Done when:** `POST /api/admin/submissions/recover` (or a re-dispatch) has resolved them to
a terminal verdict, or they are re-judged — verified in the DB, not by assumption.

### P0-3. Signed-in end-to-end smoke, all four roles
The single biggest verification gap: nobody has driven the product as an authenticated user.
Do the full loop as `contestant`, then the authoring loop as `problem_setter`/`admin`
(see `RUNBOOK.md` §6). Record screenshots outside the repo.
**Blocked on access, not effort:** there is one Neon database shared by local/API/judge, and the
local Clerk instance has zero users — so this must run against the production Clerk instance
with a real account. Provide one (or click through alongside the agent).
**Done when:** sign-up → register → submit (real verdict) → verdict visible in history →
standings update → admin creates a problem + test cases → publishes → contestant solves it →
the new problem appears in the archive and judges correctly.

### P0-4. Confirm OAuth providers actually work
Sign-in must offer working GitHub and Google buttons on the **production** Clerk instance.
**Done when:** a fresh browser (no session) completes both OAuth flows and lands on
`/dashboard`. If they fail, send `BLOCKERS.md` #2 and stop.

### P0-5. Make the sandbox failure mode impossible to miss again
`/health` now reports the backend (that is how this outage would have been caught), but the
admin observability page should surface judge health too.
**Done when:** `/admin` shows judge reachability + active sandbox, and a screenshot/curl
proves it renders for an admin and is absent for a contestant.

---

## P1 — professional polish

### P1-1. Fix the Drizzle/Neon default drift
`db/schema.ts` declares `time_limit_ms` default `1000`; Neon's live default is `2000` (the
SRS value, REQ-JUDGE-16). `npm run db:push` would silently regress every new problem.
**Done when:** schema and live DB agree, verified through `information_schema.columns`.

### P1-2. Role-separation sweep ("hide, never 403")
Walk every page as signed-out / contestant / problem_setter / contest_setter / admin and
remove any affordance the viewer may not use — including copy that implies the capability.
**Done when:** the matrix in `ROLE-MATRIX.md` holds page by page, proven with screenshots per
role, and no contestant-visible page mentions setters, drafts, test cases, or admin actions.

### P1-3. Copy and state fixes from the audit — *largely done this pass*
- ✅ `/api/problems` no longer returns `status:"unsolved"` to anonymous visitors (now `null`).
- ✅ Brand unified on **KOJ** (nav, title, hero).
- ⬜ Remaining: every empty state offers a next action; no "No data." dead ends.

### P1-4. UI de-slop + Codeforces pass — *started this pass, not yet live*
Execute `UI-SPEC.md`. Done **locally**: `GlitchingTerminal` (fake boot log + glitch/scanline/CRT
animation) deleted, landing page rewritten as a Codeforces-style text hero, brand unified,
anonymous problem-status fixed, language selector updated to the seven real languages.
Not deployed yet — see P0-1. Remaining: verdict/status vocabulary consistency, denser
standings tables, monospace numeric alignment, instant feedback on every action, orphaned
`.terminal-crt-glow`/`.text-glow`/`.bg-grid` CSS, and the marketing copy in `UI-SPEC.md` §C.

### P1-9. Guard the import route against publishing untested problems
`POST /api/admin/problems/import` can still publish a problem whose parse produced zero test
cases. The judge now reports such a problem as an infrastructure error rather than handing out
free ACs (so it is no longer a correctness hole), but the setter gets a confusing failure
instead of a clear message.
**Done when:** the import route refuses to auto-publish with zero parsed cases, or publishes it
as a draft with an explicit warning, and both paths are exercised at least once.

### P1-8. Give the contest arena a Run button
Codeforces lets you test against samples without leaving the contest, and contestants expect it.
`app/problems/[id]/page.tsx` already has the full runner (samples + custom stdin);
`app/contests/[id]/arena/` has submit only. Reuse the runner component rather than copy it, and
keep the 2.5 s interactive cooldown so Run cannot be used to bypass the 30 s submit limit.
**Done when:** a registered contestant can run samples inside a live contest and see output,
proven with a signed-in click (see P0-3).

### P1-5. Java entry-point decision
The judge requires `public class Solution`; competitive programmers habitually write
`class Main`, which currently produces a confusing CE. Either accept `Main` (with the
existing comment/string-stripping class check) or make the template + error message
unmissable.
**Done when:** both a `Solution` and a `Main` submission behave predictably, verified by a
live `POST /judge`.

### P1-6. Content hygiene
Duplicate problem ("Two Sum" vs "Two Sum — Pair Indices") and the demo contest
("Monsoon Mayhem — Archived") make the archive look unmaintained.
**Done when:** an admin can archive/unlist content through the UI, and the public archive
contains only legitimate problems.

### P1-7. Performance envelope
Measure what the SRS promises, then publish the numbers: submission → id < 1 s (REQ-PERF-01),
simple verdict < 5 s (REQ-PERF-02), 50 concurrent users without > 3 s responses (REQ-PERF-03),
≤ 2 s leaderboard propagation (REQ-PERF-04), 10 concurrent judges (REQ-JUDGE-13).
**Done when:** a repeatable harness produces a table with real numbers, included in the
handoff. Note the first-hit cold-start seen on Vercel (~25 s once on `/api/rankings`).

---

## P2 — SRS tail (explicitly deferrable)

| Item | SRS ref | State |
|---|---|---|
| ~~Go / Rust / JavaScript judges~~ | TBD-03, Medium | ✅ **implemented and verified live** (all seven languages, AC + TLE, in `judge.py`, both API allow-lists, the editor and the starter templates) |
| Custom checker programs (testlib-style) | REQ-JUDGE-15, TBD-02 | not implemented |
| Team contest mode | REQ-CONT-09, TBD-04 | not implemented |
| 40+ unit tests for the judge pipeline | §5.4 Testability | no runner installed; `AGENTS.md` rule 5 forbids leaving them behind — needs an explicit policy change first |
| Docker/VM hardening for the judge | §2.5 constraint 7, v2 | `JUDGE_SANDBOX_MODE=docker` is implemented and documented; needs a Docker host |
| Password reset flow check | REQ-AUTH-07 | Clerk-provided, never exercised |
| Clerk production instance + custom OAuth credentials | TBD-06 | dev/test instance only |
| Custom domain | — | `koj-peach.vercel.app` |

## Explicitly out of scope (do not start)

Rating/ELO, interactive problems, clarifications system, per-language time multipliers —
unless the human asks. These are not in the SRS v1.
