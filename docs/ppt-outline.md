# KOJ — PPT Outline (exactly 10 slides, per notice)

Paste one section per slide. Minimal text on slides; the script (§presentation-script.md) carries the words.

## 1. Title
KOJ — Kottayam Online Judge · Group 3: Prajwal, Chandra Teja, Shivkarthik,
Hari Krishnan S · IIIT Kottayam · Live: koj-peach.vercel.app

## 2. Introduction
Self-hosted contest platform for the college: practice archive, timed
contests, isolated judging, live ICPC rankings. Own problems, own users,
own rules.

## 3. Problem Statement
External platforms: no control over availability, config, or data; contest
problems scatter instead of becoming reusable practice material.

## 4. Requirements
Roles (contestant/setter/admin) · lifecycle draft→contest_active→published ·
open + invite registration · 7-language judging, full verdicts · live ICPC
boards · 30s rate limit. Deferred per SRS: team mode, custom checkers (v2).

## 5. Architectural Diagram
Browser → Next.js API (auth/validate/persist) → FastAPI judge on Cloud Run
(rlimit sandbox) → Neon Postgres (truth) → SSE push to UI.
Labels: Layered · Pipe-and-Filter (receive→compile→execute→check→verdict) ·
Event-Driven · Master-Slave. No untrusted code touches web/DB creds.

## 6. Implementation Details
Next.js 16 + Clerk (identity) + DB roles (authority) · Drizzle/Neon ·
sample/hidden test cases (10 MB, ≤100) · scrypt invite codes · lazy contest
settlement (no cron) · 107 unit tests gating every push.

## 7. Testing Report
`npm test` green: 83 judge + 24 scoring/invite. `tsc`, `lint`, `build` gate
every push. Judge verified AC/WA/TLE/CE live; empty problems can't false-AC.
Honest gap: load test not yet run.

## 8. Demo (live, ~7 min)
Archive Two Sum → submit AC/WA → register + arena Watermelon → standings →
end contest → Watermelon appears in archive. (Speaker 3, three windows.)

## 9. Conclusion
Live in production today: owned problems and contests, role-separated staff,
isolated judging with no false verdicts, ICPC rankings. Next: load evidence,
custom checkers.

## 10. Thank You / Q&A
Viva standby: penalty math, rlimit, DB-roles, §7b deviations, one trade-off
and one limitation each. Never "my teammate's part" for core questions.
