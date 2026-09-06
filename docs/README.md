# KOJ — Kottayam Online Judge

> Contest hosting platform with an integrated problem archive for IIIT Kottayam.

## Docs

| Doc | What's in it |
|---|---|
| [Status](status.md) | **Authoritative current implementation status** — `feat/sprint1-backend` (read this first) |
| [Overview](overview.md) | What KOJ is, problem statement, objectives, scope (links to status) |
| [Architecture](architecture.md) | System diagram, architectural styles, module decomposition (current + planned) |
| [Stack](stack.md) | Technology choices and rationale (Clerk/Neon/Redis plan — no Supabase) |
| [Features](features.md) | MVP features marked **[Implemented]** vs **[Planned]**, contest setter gap, out of scope |
| [Hard Problems](hard-problems.md) | Problems we solve and don't (sandbox, judge correctness, realtime plan) |
| [Testing](testing.md) | Strategy + actual verification evidence (`tsc/lint/build/judge` smoke) and gaps |
| [Project Management](project-management.md) | Team roles, sprint progress (Sprint 1 done, Sprint 2/3 remaining), risk register |
| [Deployment](deployment.md) | Vercel + separate FastAPI, env vars, seeding, current limitations |
| [Glossary](glossary.md) | Terms and abbreviations |

## Quick links

- **GitHub:** https://github.com/Asterisk-Hunter/KOJ
- **Branch:** `feat/sprint1-backend` (commit `57d9425`) — `docs/status.md` is the source of truth
- **Tech stack:** Next.js 16 + Tailwind v4 + Drizzle/Neon + Clerk Organizations + FastAPI judge (python) — Redis/SSE realtime planned, not yet implemented
- **Sprint 1 goal:** Judge + Submission pipeline + Auth + Problem/Contest/Rankings/Admin APIs + seeded data — ✅ implemented (see status)
