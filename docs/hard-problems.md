# Hard Problems

## Problems we solve

### 1. Safe Code Execution Under Resource Limits

**The challenge:** Run arbitrary student code without letting it crash the judge server, consume infinite resources, or access the filesystem.

**Our solution:**
- Process-level isolation via `resource.setrlimit` (CPU time, memory, file descriptor limits)
- Wall-clock timeout via subprocess timeout
- Runs as an unprivileged OS user (`nobody` or a dedicated judge user)
- Stdout/stderr captured; program has no access to other files or network

**Trade-off:** Sufficient for trusted college users but not for the public internet. Documented explicitly.

---

### 2. Judge Correctness Under Edge Cases

**The challenge:** Two programs output `42\n` vs `42` — are they the same? What about floating point `1.000000` vs `1.0`?

**Our solution:**
- Whitespace normalization: strip leading/trailing whitespace, normalize line endings
- String equality after normalization
- For floating point, problem setter phrases the problem as "output an integer" not "output a real number"

**Acknowledged limitation:** No custom checker programs. For multi-answer problems, the setter phrases it as "output any valid X" and we accept one reference output.

---

### 3. Leaderboard Consistency Under Concurrent Updates

**The challenge:** Three submissions arrive simultaneously. Which one appears first on the leaderboard? Does the leaderboard show the same ranking to all viewers?

**Our solution:**
- Database writes are atomic (Postgres ACID guarantees)
- Leaderboard is computed from the DB state at a fixed moment
- Redis cache + Realtime subscription ensure all clients converge to the same ranking quickly

**Acknowledged limitation:** Eventual consistency model (might lag 1–2 seconds during peak load). For a college contest, this is acceptable.

---

### 4. Real-Time Updates Without Polling

**The challenge:** 30 students viewing the leaderboard, refreshing every second, generates 1800 requests/minute to a single endpoint.

**Our solution:**
- Supabase Realtime: client opens a WebSocket, subscribes to changes in the `submissions` table
- When a verdict is inserted, Postgres notifies Realtime
- Realtime broadcasts the change to all subscribed clients
- Clients recompute leaderboard locally from the change

**Result:** One WebSocket connection per client instead of 60 HTTP requests per minute per client.

---

### 5. Problem Lifecycle Across Contest/Archive

**The challenge:** A problem needs different behavior during a contest (hidden until start, visible during contest, locked after end) vs. in the archive (always visible, always submittable).

**Our solution:**
- Problem has a state: Draft → Contest-Active → Published
- Contest-Active: only visible and submittable within the contest time window
- Published: visible and submittable 24/7
- Automatic state transition when contest ends

**Result:** One Problem object, different behavior based on state. No code duplication, clean state machine.

---

## Problems we explicitly don't solve

| Problem | What production systems do | What we do | Why |
|---|---|---|---|
| **Sandbox escape** | VM-level isolation (gVisor, Firecracker), seccomp | Process-level rlimit + unprivileged user | We trust college users |
| **Plagiarism** | ML-based AST/token comparison, mosaic detection | Manual instructor review | ML adds weeks of work; manual review scales fine |
| **Interactive problems** | Bidirectional stdio communication | Output-only only | 5% of competitive programming; not worth MVP complexity |
| **Custom checkers** | Sandbox the checker as you sandbox submissions | Single-output only | Recursive sandboxing is complex; covers 95% of problems |
| **Distributed judge** | Redis queue, worker pool on multiple machines | Single worker in thread pool | 30 concurrent submissions don't need distribution |
| **Floating-point checker** | Epsilon-based comparison | Integer/string outputs only | Floating-point is error-prone without problem-specific metadata |
| **Timing fairness** | Per-language time limit multipliers | Single time limit | Fair — this is how real contests work |
| **Production uptime** | 99.99% SLA, redundancy, failover | Single server, honest restart window | College contest is predictable and scheduled |
