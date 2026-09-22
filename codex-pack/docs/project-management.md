# Project Management

## Team structure

| Role | Member | Modules | Documentation ownership |
|---|---|---|---|
| **Backend Lead / Judge** | (Strongest backend engineer) | Judge module (`api/app/judge.py`), Submission API (`app/api/submissions/*`), FastAPI `/judge` | SRS §Judge, §Submission; Unit test plan; Sequence diagram for verdict flow |
| **Backend / Contest** | (Backend #2) | Contest engine (`app/api/contests/*`), Problem API (`app/api/problems/*`), Problem lifecycle | SRS §Contest, §Problem; State machine diagrams; Integration test plan |
| **Frontend / Problem UI** | (Frontend #1) | Problem archive/detail, Contest list/detail/arena, Submission detail | SRS §UI; React component design; Frontend unit tests |
| **Frontend / Leaderboard** | (Frontend #2) | Rankings (`app/api/rankings/*` + `app/rankings`), Admin (`app/admin`, `app/api/admin/*`), Auth UI | SRS §Auth, §Leaderboard; E2E test plan |
| **Cross-cutting (all)** | All members | SRS, UML, testing strategy, project management, docs | `docs/status.md` is joint |

**Weekly sync:**
- Tuesday: standup on progress, blockers, code review for merged PRs
- Friday: demo of completed features to the group, planning next sprint

---

## Sprint plan

### Sprint 1 (Weeks 1–4): Auth + Judge + Problem API — ✅ Implemented (on `feat/sprint1-backend`)
**Goal:** Core judge works, can create problems, can submit.
**Demo:** Submit a solution, see verdict.
**Actual:**
- Clerk Organizations enabled, `proxy.ts` + `auth()` gates, `/sign-in/[[...sign-in]]` + `/sign-up/[[...sign-up]]`
- FastAPI `POST /judge` (Python) — AC/WA/TLE/CE verified
- `POST /api/submissions` pipeline (pending→running→verdict) — `python` only, 100KB limit, 55s abort
- `GET /api/problems` + `GET /api/problems/[id]` (published only) + `GET /api/health`
- `GET /api/contests` + `GET /api/contests/[id]` + `POST /api/contests/[id]/register` + `GET /api/rankings`
- `GET /api/admin/summary` + `POST /api/admin/problems` (admin gated)
- Pages: landing, dashboard, problems, contests + arena, rankings, submissions detail, admin
- Neon schema (7 tables + enums) + idempotent seed (8 problems, 32 cases, 4 contests, 16 links)
- Verified: `tsc --noEmit`, `lint`, `build` pass; judge AC/WA/TLE/CE smoke; API smoke counts
- **Not in Sprint 1:** Redis/SSE, contest CRUD, `contest_setter` role, language expansion, test suite, production deploy (see Remaining work)

### Sprint 2 (Weeks 5–8): Contest engine + Leaderboard + Realtime (UI already, realtime remaining)
**Goal:** Can host a contest, see live leaderboard.
**Demo:** Run a mini-contest with the team.
**Remaining for Sprint 2:**
- Contest CRUD: `POST/PATCH /api/contests` (or `/api/admin/contests`) + publish/visibility + UI — blocked on role decision (`org:admin` only vs `contest_setter`)
- Redis cache/pub-sub → Next.js SSE for live rankings + submission status
- Role decision: admin-only vs `contest_setter` enum + Clerk custom role
- Clerk webhooks to sync `users`/`org` memberships (lazy-create covers Sprint 1)
- Production FastAPI deployment (Render/Railway/Fly) + `JUDGE_INTERNAL_SECRET`/`FRONTEND_URL` wiring

### Sprint 3 (Weeks 9–12): Archive + Polish + Testing + Docs
**Goal:** Auto-publish problems, full test suite, documentation.
**Demo:** Beta contest with real students.
**Remaining:**
- Auto-publish on contest end (part of contest CRUD)
- Full test suite: pytest (judge) + Jest/Vitest + Playwright E2E + stress (30 concurrent)
- `npm audit` fix (1 high / 4 moderate — requires breaking Drizzle upgrade)
- Production hardening, monitoring, docs polish

---

## Risk register

| Risk | Impact | Likelihood | Mitigation | Current status |
|---|---|---|---|---|
| Sandbox escape | High — judge compromised | Low — trusted users | `RLIMIT_AS` + wall timeout + `py_compile`; document boundary | Accepted for college use; no seccomp/VM |
| Judge TLE variance | Medium — unfair verdicts | Medium — server load | Pin judge core if possible; acknowledge variance | Verified TLE via wall timeout; variance not yet measured |
| Realtime lag | Medium — leaderboard stale | Medium — peak load | Redis cache + SSE; ≤5s target | **Not implemented** — on-demand today |
| Scope creep | High — missed deadlines | High | Strict MVP; stretch goals deferred; `contest_setter` decision gated | Tracked in `docs/status.md` |
| Deployment failure | High — can't demo | Low — Vercel + Neon | Test early; FastAPI local fallback | FastAPI not yet in prod; Hobby `maxDuration` limit noted |
| Audit debt | Low — dep vulnerabilities | High | Track 1 high / 4 moderate; Drizzle major upgrade needed | Deferred intentionally |

---

## Estimation

- ~3000 LOC estimated (Python backend + TypeScript frontend) — actual diff `feat/sprint1-backend` vs `main`: ~4.9k insertions
- 4 people, 12 weeks, 3 sprints
- COCOMO: moderate effort, moderate schedule
- Risk buffer: 20% per sprint for integration bugs

---

## Current status link

Authoritative implementation status: `docs/status.md` (branch `feat/sprint1-backend`, commit `57d9425`).
