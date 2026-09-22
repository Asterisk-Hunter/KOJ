# KOJ — 15-Minute Presentation Script (demo + viva split)

Total 20 min: 15 presentation + demo, 5 viva. Speakers rotate per section; handoffs in bold.
Rehearse with a timer. URLs are production: https://koj-peach.vercel.app.

## 0:00–0:30 — Title (Speaker 1)
"Kottayam Online Judge — a self-hosted contest platform for IIIT Kottayam: practice,
timed contests, secure judging, live rankings. Team of four." Advance.

## 0:30–2:00 — Problem (Speaker 1)
"College contests depend on external platforms: no control over availability, config, or
data — and contest problems scatter instead of becoming an archive. KOJ gives the
institution its own problems, users, rules, and reusable practice material."
**Handoff: "To the requirements this forced on us —" Speaker 2.**

## 2:00–3:30 — Requirements (Speaker 2)
"Four users: contestants, problem setters, contest setters, admins. Must-haves: auth with
roles, problem lifecycle draft→contest_active→published, timed contests with registration,
isolated multi-language judging with seven verdicts, live ICPC leaderboards, rate limiting.
Medium and Low items — custom checkers, more languages, teams — explicitly deferred."

## 3:30–5:00 — Architecture (Speaker 2)
Walk the diagram top to bottom: "Browser never touches untrusted code. Next.js validates
and persists; the FastAPI judge executes under kernel resource limits on Cloud Run, Neon
stores truth, SSE pushes updates. Layered, pipe-and-filter judge, event-driven UI."
**Handoff: "Enough boxes — watch it run. Speaker 3, demo."**

## 5:00–12:00 — LIVE DEMO (Speaker 3, contestant + admin windows ready)
1. Problems: filter, open Two Sum, point out samples/limits/editor. (1 min)
2. Submit correct Python → verdict streams Accepted, open per-test table. (2 min)
3. Submit buggy version → Wrong Answer showing the failed test. Mention 30s cooldown if hit. (2 min)
4. Contest: admin publishes; contestant registers; arena; standings row appears with penalty math. (2 min)
5. Admin close: users/roles, observability metrics. (1 min)
- If anything stalls: "The UI/API layer is up; the judge host is unreachable — here is the recorded run," and show the backup screenshot. Never invent a verdict.

## 12:00–13:30 — Testing (Speaker 4)
"45-check E2E sweep, zero critical issues; typecheck, lint, and build gate every change;
each phase passed independent review. Honest gaps: no load test yet, no committed test
runner — next step is CI with unit, integration, E2E, and load suites."

## 13:30–15:00 — Conclusion (Speaker 4)
"Working college-scale judge, live in production today: owned problems and contests,
role-separated admin, isolated judging that never returns a false verdict, ICPC rankings.
Next: production auth instance, load evidence, custom checkers. Questions?"

## Viva standby (all)
Submit→verdict flow whiteboard-ready. Penalty formula from memory. rlimit-not-containers.
DB-roles-not-Clerk. Trade-off + limitation each. Never "my teammate's part" for core questions.
