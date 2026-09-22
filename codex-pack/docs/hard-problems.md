# Hard Problems

## Problems we solve

### 1. Safe Code Execution Under Resource Limits

**The challenge:** Run arbitrary student code without letting it crash the judge server, consume infinite resources, or access the filesystem.

**Our solution (implemented for Python):**
- `py_compile` syntax check before execution
- Per-case `subprocess.run` with `resource.setrlimit(RLIMIT_AS, memory_mb)` on POSIX + wall timeout `time_limit_ms+2s`
- Stdout/stderr truncated 4KB per case; judge aggregates verdict
- No privileged access; program has no DB/network access

**Trade-off:** Sufficient for trusted college users but not for the public internet. See `docs/status.md` pipeline.

---

### 2. Judge Correctness Under Edge Cases

**The challenge:** Two programs output `42\n` vs `42` — are they the same? What about floating point `1.000000` vs `1.0`?

**Our solution:**
- Whitespace normalization: rstrip per line, drop trailing empty lines, then line-by-line equality (`api/app/judge.py:_normalize_output`)
- String equality after normalization
- For floating point, problem setter phrases the problem as "output an integer" not "output a real number"

**Acknowledged limitation:** No custom checker programs. For multi-answer problems, the setter phrases it as "output any valid X" and we accept one reference output.

---

### 3. Leaderboard Consistency Under Concurrent Updates

**The challenge:** Three submissions arrive simultaneously. Which one appears first on the leaderboard? Does the leaderboard show the same ranking to all viewers?

**Our solution (current):**
- Database writes are atomic (Neon Postgres ACID)
- Leaderboard is computed on demand from `submissions` (`GET /api/rankings?contestId=`) — sorted `solved DESC, penalty ASC`

**Planned improvement (not implemented):**
- Redis cache + pub/sub → Next.js SSE so all clients converge quickly; invalidation on new `accepted` verdict. See `docs/status.md` Realtime plan.

**Acknowledged limitation:** On-demand today; eventual consistency with 1–2s lag once Redis/SSE lands. Acceptable for college scale.

---

### 4. Real-Time Updates Without Polling

**The challenge:** 30 students viewing the leaderboard, refreshing every second, generates 1800 requests/minute to a single endpoint.

**Intended solution (planned, not implemented):**
- Redis pub/sub: verdict insert → publish event
- Next.js SSE: clients subscribe once, receive leaderboard delta
- Clients update ranking locally from event

**Current state:** No Redis, no SSE — leaderboard is fetched on demand. Previous Supabase Realtime description is obsolete; realtime is Redis→SSE per `docs/stack.md` and `docs/status.md`.

**Result when implemented:** One SSE connection per client instead of 60 HTTP requests/min/client.

---

### 5. Problem Lifecycle Across Contest/Archive

**The challenge:** A problem needs different behavior during a contest (hidden until start, visible during contest, locked after end) vs. in the archive (always visible, always submittable).

**Our solution:**
- Problem has a state: `draft` → `contest_active` → `published` (`problem_status` enum)
- Contest-Active: intended to be visible only within contest window (enforced in `POST /api/submissions` for live contests)
- Published: visible and submittable 24/7 (`GET /api/problems` lists only `published`)
- Automatic state transition when contest ends — planned as part of contest CRUD (see `docs/status.md` remaining work)

**Result:** One Problem object, different behavior based on status. Seed creates 8 `published` problems; transitions are future work.

---

## Problems we explicitly don't solve

| Problem | What production systems do | What we do | Why |
|---|---|---|---|
| **Sandbox escape** | VM-level isolation (gVisor, Firecracker), seccomp | Process-level `RLIMIT_AS` + wall timeout + `py_compile` (POSIX) | We trust college users |
| **Plagiarism** | ML-based AST/token comparison, mosaic detection | Manual instructor review | ML adds weeks of work; manual review scales fine |
| **Interactive problems** | Bidirectional stdio communication | Output-only only | 5% of competitive programming; not worth MVP complexity |
| **Custom checkers** | Sandbox the checker as you sandbox submissions | Single-output only | Recursive sandboxing is complex; covers 95% of problems |
| **Distributed judge** | Redis queue, worker pool on multiple machines | Single synchronous `POST /judge` (HTTP) | 30 concurrent submissions don't need distribution yet |
| **Floating-point checker** | Epsilon-based comparison | Integer/string outputs only | Floating-point is error-prone without problem-specific metadata |
| **Timing fairness** | Per-language time limit multipliers | Single `time_limit_ms` per problem | Fair — this is how real contests work |
| **Production uptime** | 99.99% SLA, redundancy, failover | Single Vercel + single FastAPI + Neon, honest restart window | College contest is predictable and scheduled |
