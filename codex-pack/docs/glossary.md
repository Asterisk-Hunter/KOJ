# Glossary

| Term | Definition |
|---|---|
| **AC** | Accepted — submission verdict when output matches expected (`submission_status=accepted`) |
| **WA** | Wrong Answer — output differs from expected (`wrong_answer`) |
| **TLE** | Time Limit Exceeded — execution exceeded `time_limit_ms` (`time_limit_exceeded`) |
| **MLE** | Memory Limit Exceeded — memory exceeded `memory_mb` (`memory_limit_exceeded`, via `RLIMIT_AS` / `MemoryError`) |
| **RE** | Runtime Error — program crashed (`runtime_error`) |
| **CE** | Compilation Error — `py_compile` failure (`compilation_error`) |
| **Realtime (planned)** | Redis cache/pub-sub → Next.js SSE for live leaderboard/submission status (not Supabase Realtime) |
| **SSE** | Server-Sent Events — planned realtime transport from Next.js to browser |
| **Leaderboard** | Rankings sorted by problems solved DESC, then penalty ASC (ICPC style) |
| **Penalty** | `minutes(first_AC - contest.startsAt) + 20 * wrong_before_first_AC` |
| **Sandbox** | Execution environment with `RLIMIT_AS` + wall timeout + `py_compile` check (POSIX; skipped on Windows dev) |
| **Subprocess** | Isolated `subprocess.run([sys.executable, tmp.py])` per test case |
| **Verdict** | Judge result: `status` + `passed_tests/total_tests` + `execution_time_ms` + `error_message` + per-case results |
| **Problem Setter** | `user_role=problem_setter` — can author problems (today via admin gate) |
| **Contest Setter** | Proposed role for contest creation — **not implemented** (no `contest_setter` enum value yet; see `docs/status.md`) |
| **Contestant** | `user_role=contestant` — registers, submits, views rankings |
| **Admin** | `user_role=admin` or Clerk `org:admin` — manages catalogue via `/api/admin/*` |
| **Archive** | Public `published` problems available 24/7 for practice (`GET /api/problems`) |
| **Drizzle** | TypeScript ORM for Neon Postgres (`drizzle-orm@0.36.4`) |
| **Neon** | Serverless Postgres — authoritative DB (not Supabase Postgres) |
| **Clerk** | Auth provider with Organizations enabled; `proxy.ts` + `auth().has({role:"org:admin"})` |
| **FastAPI** | Python judge service (`api/app/main.py` + `api/app/judge.py`); `POST /judge` internal |
| **Supabase** | Not used by KOJ — previous docs referencing Supabase Auth/Realtime are obsolete |
