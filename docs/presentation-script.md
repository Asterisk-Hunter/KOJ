# KOJ — Presentation + Demo Script (15 min total, 4 speakers)

Site: **https://koj-peach.vercel.app**. Three signed-in windows ready before you start:
**A-contestant** (PRAJWAL KUMAR K), **B-setter** (Chandra Teja), **C-admin** (you).
Share A; switch on cues. C++ solutions for Two Sum + Watermelon in a scratch file.
Rehearse with a timer. Never read slides — talk over them.

## Talk (~6 min — PPT has 10 slides, §docs/ppt-outline.md)

### 0:00–0:30 — Title (Speaker 1)
"Kottayam Online Judge — our college's own contest platform: practice,
timed contests, isolated judging, live ICPC rankings. Team of four." Advance.

### 0:30–2:00 — Problem (Speaker 1)
"College contests depend on external platforms: no control over availability,
config, or data — and contest problems scatter instead of becoming an archive.
KOJ gives the institution its own problems, users, rules, and reusable practice
material." **Handoff: "The requirements this forced —" Speaker 2.**

### 2:00–3:30 — Requirements (Speaker 2)
"Three roles — contestant, setter, admin. Must-haves: auth with roles, problem
lifecycle draft→contest_active→published, timed contests with open and
invite registration, isolated 7-language judging with full verdicts, live ICPC
boards, 30-second rate limiting. Team mode and custom checkers are SRS v2 —
we say so openly." Name two deviations only if asked (SSE, staff-run contests).

### 3:30–5:00 — Architecture (Speaker 2)
Walk the diagram top to bottom: "Browser never touches untrusted code. Next.js
validates and persists; the FastAPI judge executes under kernel rlimits on
Cloud Run; Neon stores truth; SSE pushes updates. Layered, pipe-and-filter
judge, event-driven UI, master dispatches to sandbox slave."
**Handoff: "Enough boxes — watch it run. Speaker 3, demo."**

## LIVE DEMO (~7 min — Speaker 3)

1. **Archive (1 min, A).** `/problems` — filters, acceptance %. Open Two Sum:
   markdown, limits, samples. **Run** C++ → per-case badges. "Run hits samples;
   Submit hits everything including hidden."
2. **Submit (1.5 min, A).** Submit Two Sum → Accepted streams in with hidden
   cases counted. Then the 1-indexed variant → Wrong Answer + diff. Mention the
   30s cooldown only if it triggers.
3. **Contest (2 min, A).** `/contests` → Demo Sprint (Active) → **Register**,
   one click. Countdown → **Enter Arena**: A/B lettering, balloons. Open
   B/Watermelon → custom stdin `8` → Submit → Accepted. `/rankings`: your row
   appears — "penalty is minutes plus 20 per wrong, CE excluded."
4. **Setter (1 min, B).** `/admin` as setter: TESTS drawer — sample/hidden
   toggle, 10 MB / 100-case caps. Open a Demo problem's tests → locked
   (BR-08: live contest, edits 403). Mention the 1-click importer. Change
   nothing.
5. **The money moment (1.5 min, C→A).** As admin: Role management (10 users,
   search, promote — REQ-AUTH-04), metrics. Contests → **End Demo Sprint**.
   Switch to A, reload `/problems` → **Demo: Watermelon is in the archive.**
   "Contest-owned state, no cron — ending publishes atomically."

## Testing + close (~2 min — Speaker 4)

"107 committed unit tests green — 83 judge, 24 scoring/invite — plus typecheck,
lint, and build gating every push. Honest gaps: no load test yet, team mode
and custom checkers are scheduled v2." Then: "Working college-scale judge,
live in production today. Questions?"

## Viva standby (all)

Penalty formula from memory. rlimit-not-containers. DB-roles-not-Clerk.
Deviations in prep.md §7b. Trade-off + limitation each. Never "my teammate's
part" for core questions. If anything stalls live: "The UI/API layer is up;
the judge host is unreachable — here is the recorded run." Never invent a verdict.
