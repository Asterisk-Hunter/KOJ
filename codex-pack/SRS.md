# KOJ — SRS v1.0 Requirement Catalog (with implementation status)

Reconstructed 2026-09-21 from per-requirement code audits (each item verified against
file:line evidence + independent review gates). Priority scheme is the SRS's own:
High = must-have v1 (all met), Medium/Low = explicitly deferrable.

## 4.1 Authentication & User Management — all High met

- REQ-AUTH-01 email/password registration — MET (Clerk catch-all routes)
- REQ-AUTH-02 OAuth GitHub + Google — MET (dashboard SSO, buttons live)
- REQ-AUTH-03 default `contestant` role — MET (DB default)
- REQ-AUTH-04 admin role change — MET (admin users API + UI, self-change refused)
- REQ-AUTH-05 Clerk JWT sessions — MET (proxy + `auth()` on writes)
- REQ-AUTH-06 duplicate email rejection — MET (unique constraint + webhook dedupe)
- REQ-AUTH-07 password reset via email — Medium; Clerk-provided, unverified end-to-end

## 4.2 Problem Management — all High met

- REQ-PROB-01 create (title/statement/time/memory/difficulty) — MET (+ bulk/Polygon import, KaTeX math)
- REQ-PROB-02 test cases as input/output pairs — MET
- REQ-PROB-03 10MB per-file cap — MET (all upload paths)
- REQ-PROB-04 state machine Draft → Contest-Active → Published — MET (lifecycle transitions)
- REQ-PROB-05 draft visible to setter/admin only — MET (404 otherwise)
- REQ-PROB-06 contest-active visible to registered participants only — MET
- REQ-PROB-07 published visible to all — MET
- REQ-PROB-08 markdown rendering — Medium, MET (react-markdown + KaTeX)
- REQ-PROB-09 draft editing — MET
- REQ-PROB-10 post-start edit lock — MET (403 + UI badges)

## 4.3 Code Submission & Judge Pipeline — all High met

- REQ-JUDGE-01 POST → 202 + submission ID — MET
- REQ-JUDGE-02 C, C++, Python, Java — MET (Go/Rust/JS are Medium, deferred)
- REQ-JUDGE-03 gcc/g++/javac (+ Java Main/Solution detect) — MET
- REQ-JUDGE-04 CPU rlimit — MET
- REQ-JUDGE-05 wall-clock timeout — MET
- REQ-JUDGE-06 memory rlimit (−Xmx for Java) — MET
- REQ-JUDGE-07 fork-bomb guard — MET
- REQ-JUDGE-08 isolated working directory — MET
- REQ-JUDGE-09 whitespace-normalized comparison — MET
- REQ-JUDGE-10 all test cases → single verdict — MET
- REQ-JUDGE-11 AC/WA/TLE/MLE/RE/CE/PE — MET
- REQ-JUDGE-12 realtime verdict delivery — MET (SSE + EventSource + fallback)
- REQ-JUDGE-13 10 concurrent judges — MET (4 workers + autoscale + concurrency cap)
- REQ-JUDGE-14 DB logging of results — MET (incl. per-test `case_results`)
- REQ-JUDGE-15 custom checkers — Medium/v2, DEFERRED
- REQ-JUDGE-16 custom time limit per problem (default 2s) — MET
- REQ-JUDGE-17 custom memory limit per problem (default 256MB) — MET

## 4.4 Contest Management — all High met

- REQ-CONT-01 create (title/desc/start/end/mode) — MET (+ full CRUD + publish/unpublish/archive)
- REQ-CONT-02 open + invite-code registration — MET (scrypt-hashed codes)
- REQ-CONT-03 add existing problems — MET
- REQ-CONT-04 auto visible-at-start / lock-at-end — MET (lazy settler on reads + writes)
- REQ-CONT-05 one-click open registration — MET
- REQ-CONT-06 invite-code path — MET
- REQ-CONT-07 post-end submission lock — MET
- REQ-CONT-08 countdown timer — Medium, MET
- REQ-CONT-09 team mode — Low, DEFERRED

## 4.5 Live Leaderboard — all High met

- REQ-LB-01 ICPC scoring — MET
- REQ-LB-02 penalty formula — MET (wrong-only verdicts filtered)
- REQ-LB-03 realtime push — MET (SSE ticker, Redis-accelerated)
- REQ-LB-04 update ≤2s — MET (2s ticks; architecturally sound, unloaded-tested)
- REQ-LB-05 visible during + after — MET (live/ended/archived)
- REQ-LB-06 per-problem status — Medium, MET (cells + attempts + solve counts + balloons)

## 4.6 Rate Limiting — all High met

- REQ-RATE-01 1 submission / 30s / user / problem — MET
- REQ-RATE-02 429 + Retry-After — MET
- REQ-RATE-03 submit-button countdown — Medium, MET

## 5. Nonfunctional — High met, perf partially load-verified

- PERF-01 submission ID ≤1s, PERF-03 50 concurrent users, PERF-04 leaderboard ≤2s — MET by architecture, not load-tested
- PERF-02 verdict ≤5s, PERF-06 10 concurrent judges — same caveat
- SAFE-01/02/03 sandbox/kill/fork-guard — MET (process-level rlimits; Docker/seccomp is v2)
- SEC-01 HTTPS, SEC-02 bcrypt-via-Clerk, SEC-03 JWT on routes, SEC-04 admin gates, SEC-06 sanitization — MET; SEC-05 CSRF Medium, framework-handled

## 2.6 Documentation deliverables — all present

README, problem setter guide, user guide, deployment guide — all in `docs/` (copied into this pack).
