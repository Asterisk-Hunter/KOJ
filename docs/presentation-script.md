# KOJ — 15-Minute Presentation Script (demo + viva split)

Total 20 min: 15 presentation + demo, 5 viva. Speakers rotate per section; handoffs in bold.
Rehearse with a timer. URLs are production: https://koj-peach.vercel.app.
Have admin + contestant windows signed in before starting.

## 0:00–0:30 — Title (Speaker 1)
"Kottayam Online Judge — a self-hosted contest platform for IIIT Kottayam: practice,
timed contests, secure judging, live rankings. Team of four." Advance.

## 0:30–2:00 — Problem (Speaker 1)
"College contests depend on external platforms: no control over availability, config, or
data — and contest problems scatter instead of becoming an archive. KOJ gives the
institution its own problems, users, rules, and reusable practice material."
**Handoff: "To the requirements this forced on us —" Speaker 2.**

## 2:00–3:30 — Requirements (Speaker 2)
"Three roles: contestants, staff setters, admins — enforced server-side, never just hidden.
Must-haves: auth with roles, problem lifecycle draft→contest_active→published, timed contests
with registration, isolated multi-language judging with seven verdicts, live ICPC leaderboards,
rate limiting. Medium and Low items — custom checkers, more languages, teams — deferred."

## 3:30–5:00 — Architecture (Speaker 2)
Walk the diagram top to bottom: "Browser never touches untrusted code. Next.js validates
and persists; the FastAPI judge executes under kernel resource limits on Cloud Run, Neon
stores truth, SSE pushes updates. Layered, pipe-and-filter judge, event-driven UI."
**Handoff: "Enough boxes — watch it run. Speaker 3, demo."**

## 5:00–12:00 — LIVE DEMO (Speaker 3, both windows ready)
Pre-seeded: "Demo Sprint" contest is live with "Demo: Two Sum" + "Demo: Watermelon";
your standings row already shows 2 solved, 52 penalty.
1. Problems (1 min): open `/problems` — note "Demo: Add Two Numbers" is ABSENT: it is
   locked inside the live "Demo Flash" contest and invisible by design. Open Demo Two Sum:
   samples, limits, editor.
2. Submit correct Python → verdict streams Accepted → per-test table 3/3. (2 min)
3. Submit buggy version → Wrong Answer naming the failed test → fix → resubmit → AC.
   Mention the 30s cooldown if it triggers. (2 min)
4. Standings (1 min): `/rankings?contestId=demo-sprint` → pre-seeded row plus the new live
   verdict landing on top. Penalty math live: 12 + 20×1 and 20 + 20×0.
5. LIFECYCLE MOMENT (2 min, the integrity story): switch to admin window → open Demo Flash
   → end the contest live → refresh `/problems` → "Demo: Add Two Numbers" appears.
   Say: "Contest problems are invisible until the contest ends — then they join the
   practice archive automatically. Draft, contest-locked, published: enforced, not promised."
6. Admin close (1 min): users/roles, observability metrics.
- If anything stalls: "The UI/API layer is up; the judge host is unreachable — here is the recorded run," and show the backup screenshot. Never invent a verdict.

## 12:00–13:30 — Testing (Speaker 4)
"107 committed unit tests (83 judge pipeline, 24 scoring and auth crypto) plus a 45-check
E2E sweep with zero critical issues; typecheck, lint, and build gate every change; each
phase passed independent review. Honest gaps: no load test yet; CI next."

## 13:30–15:00 — Conclusion (Speaker 4)
"Working college-scale judge, live in production today: owned problems and contests,
role-separated admin, isolated judging that never returns a false verdict, ICPC rankings.
Next: production auth instance, load evidence, custom checkers. Questions?"

## Viva standby (all)
Submit→verdict flow whiteboard-ready. Penalty formula from memory. rlimit-not-containers.
DB-roles-not-Clerk. Trade-off + limitation each. Never "my teammate's part" for core questions.
