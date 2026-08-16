# KOJ: Kottayam Online Judge
## Comprehensive Project Documentation

---

## 1. Project Overview

**Name:** KOJ (Kottayam Online Judge)

**Type:** Contest hosting platform with an integrated problem archive

**Target Users:** IIIT Kottayam students and competitive programming community

**Core Problem:** IIIT Kottayam has hosted internal programming contests on Codeforces. Codeforces is a production-grade platform but not self-hostable and has experienced downtime during critical moments (mid-contest, peak registration). KOJ solves the platform availability and institutional control problem by providing a self-hosted alternative specifically designed for college contests.

**Key Value Prop:** After a contest ends, problems automatically publish to a public practice archive. This turns one-off contests into cumulative institutional knowledge — a growing problem bank that models SPOJ or Codeforces's problem archive, but built and owned by the college.

---

## 2. Problem Statement

### Current State
- College contests depend on external platforms (Codeforces, AtCoder)
- Codeforces has experienced downtime during actual contests
- No institutional control over contest environment or problem curation
- Contest problems are lost after the event — no reusable archive

### Desired State
- Self-hosted platform under college control
- Problem archive that grows with each contest
- Reliable infrastructure for college-scale concurrent load (20–50 students)
- Transparent, understandable codebase that students can learn from or contribute to

### Why Not Just Use Codeforces?
Codeforces is excellent but not self-hostable. We need institutional control, guaranteed uptime for internal events, and the ability to run contests without depending on external infrastructure availability. A college-scale system needs different tradeoffs than Codeforces (which optimizes for global contests of 10,000+ participants).

---

## 3. Objectives

### Technical Objectives
1. Build a working contest hosting platform that reliably judges code submissions across multiple languages
2. Implement a distributed judging architecture (judge isolated from web layer) that demonstrates architectural patterns
3. Create a problem lifecycle system where contest problems transition to a public archive post-contest
4. Implement real-time leaderboard updates using event-driven architecture (Supabase Realtime subscriptions)
5. Support concurrent contest load (30 simultaneous submissions) without performance degradation

### Educational Objectives (for SE course)
1. Demonstrate full software engineering process: requirements specification, design with UML, testing strategy, project management
2. Justify every architectural decision with reference to functional or non-functional requirements
3. Differentiate between architectural styles (layered, pipe-and-filter, event-driven, master-slave) with concrete examples from the codebase
4. Document design tradeoffs: what we chose to include (process-level sandboxing) vs. what we explicitly didn't (production-grade VM isolation)
5. Show testing taxonomy: unit, integration (bottom-up and top-down), validation, stress, alpha, beta, regression testing

### Resume Objectives
1. Ship a real product used by real people (actual college contests with real students)
2. Demonstrate full-stack engineering: backend judge, API layer, frontend UI, database, real-time infrastructure
3. Show thoughtful architectural decisions and their justification
4. Provide concrete, verifiable metrics (N contests hosted, X problems archived, Y students participated)

---

## 4. Scope of Work

### 4.1 Core Features (MVP) — What We Build

#### Authentication & Authorization
- User registration and login
- Three roles: **Contestant**, **Problem Setter**, **Admin**
- Role-based access control (students see contests only, setters can create problems, admins manage system)
- Session management via JWT or Supabase auth

#### Problem Authoring System
- **Problem creation form:** title, statement (Markdown rendered to HTML), input/output format specification, constraints
- **Test case management:** problem setters upload multiple test cases as plaintext files
- **Test case display:** sample input/output shown to contestants; hidden test cases used only during judging
- **Time and memory limits:** configurable per-problem, with sane defaults (1s, 256MB)
- **Problem status:** Draft (editor-only) → Contest-Active (during contest) → Published (public archive after contest)

#### Contest Engine
- **Contest creation:** admin creates a contest with a name, start time, end time, list of problems
- **Registration:** students register for contests before they start
- **Visibility rules:** before start (problems hidden, students can see contest but not problems), during contest (all problems visible, submissions open), after contest (submissions closed, verdicts visible, problems auto-published)
- **Timed enforcement:** submissions rejected if received after contest end time

#### Code Submission & Judging
- **Submission UI:** text area or file upload, language selector (C++, Python initially)
- **Submission flow:** code sent to FastAPI endpoint → queued for judge → judge runs → verdict written to DB → Realtime event triggers UI update
- **Judge module:** Python subprocess execution with:
  - `resource.setrlimit` for CPU and memory limits (RLIMIT_CPU, RLIMIT_AS)
  - `signal.alarm` or threading timeout for wall-clock time limit
  - Runs as restricted OS user (no filesystem or network access except scratch directory)
  - Whitespace-normalized string comparison against expected output
- **Verdict types:** AC (Accepted), WA (Wrong Answer), TLE (Time Limit Exceeded), MLE (Memory Limit Exceeded), RE (Runtime Error), CE (Compilation Error)
- **Multiple submissions:** contestant can submit multiple times; only the last verdict is shown, but all submissions are stored

#### Real-Time Submission Status
- Contestant submits → status immediately shows "Queued" in the UI
- Judge starts running → status updates to "Running" (Submission timeout: 30 seconds before we bail and return TLE)
- Judge finishes → status updates to final verdict (AC/WA/TLE/MLE/RE/CE)
- UI updates live via Supabase Realtime subscriptions, no polling

#### Leaderboard
- **Ranking:** problems solved (descending), then penalty time (ascending)
- **Penalty calculation:** time of first AC submission + 20 minutes for each wrong attempt on that problem before the AC
- **Live updates:** leaderboard refreshes automatically as new AC verdicts arrive during the contest
- **Post-contest:** leaderboard is frozen and visible as a read-only final ranking

#### Problem Archive
- After a contest ends, all problems are automatically published to a public archive
- Students can submit practice solutions to archived problems anytime (24/7), not just during contest windows
- Practice submissions are judged with the same judge, but don't contribute to any leaderboard
- Submission history for practice problems is stored and visible to the user

#### Submission History
- Students can view all their submissions per problem: code, timestamp, language, verdict, execution time/memory
- Can re-read the code of any past submission

---

### 4.2 Non-Functional Requirements

| Requirement | Target | Rationale |
|---|---|---|
| Verdict latency | ≤10 seconds from submission to verdict | Contestant feedback loop during contest |
| Leaderboard update latency | ≤5 seconds from AC verdict to leaderboard rank change | Live contest excitement |
| Concurrent submissions | 30 simultaneous submissions without timeout | College contest peak load |
| Judge accuracy | 100% verdicts match manual verification | Wrong verdicts break trust in the system |
| Submission queue throughput | 60 submissions/minute sustained | Average college contest throughput |
| Uptime during contest | No unplanned downtime during scheduled contest window | Core reliability requirement |

---

### 4.3 Stretch Goals (If Time Permits)

- Support for a third language (Java or JavaScript)
- Basic syntax highlighting in the code submission textarea
- Discussion/editorial threads per problem, unlocked after contest ends
- Code similarity detection (simple token-based, not cryptographic) to flag potential plagiarism
- Email notifications for contest start/end
- Codeforces-style rating system (Elo rating updates after each contest)
- Problem difficulty tags and filterable problem archive
- A "hack-a-submission" feature: allow contestants to submit failing test cases against others' AC submissions (Codeforces-style)

---

### 4.4 Explicitly Out of Scope

#### Why These Are Out of Scope (And Documented Honestly)

**1. Production-Grade Code Sandboxing**
- What we don't do: Docker-per-submission, gVisor/Firecracker microvms, seccomp syscall filtering, chroot jails
- What we do: process-level isolation via `resource.setrlimit`, running submissions as a restricted OS user, no network/filesystem access
- Why this tradeoff: Production sandboxing adds weeks of hardening and DevOps complexity. For a trusted college user base (known students, instructors curating problems), process-level isolation is sufficient. If a student maliciously escapes the sandbox, they're doing so on a computer they already have access to physically.
- Honest boundary: This system is not suitable for running untrusted code from the public internet. It's suitable for college-internal contests.

**2. Plagiarism Detection at Scale**
- What we don't do: cryptographic AST comparison, mosaic detection, machine learning plagiarism models
- Why: These require significant algorithmic and ML overhead. Instead, we document that instructors should manually review suspicious solutions (two solutions that are structurally identical), similar to current practice.

**3. Interactive Problems**
- What we don't do: bidirectional piped communication between judge and submission, synchronization of interactive exchanges
- Why: Interactive judging requires two-way communication, which is harder to sandbox and debug. Most competitive programming contests are output-only anyway.

**4. Custom Checkers / Special Judges**
- What we don't do: allow problem setters to provide custom checker programs for problems with multiple correct answers
- Why: Running untrusted checker code requires sandboxing the checker itself (recursion). For initial scope, we only support problems with single correct outputs.
- Workaround: for problems with multiple valid outputs, the problem setter can phrase it as a format string, e.g., "output any valid topological sort" — the contestant just needs to output one valid answer and we compare against one reference.

**5. Distributed Judge Workers and Job Queue**
- What we don't do: Redis job queue, multiple judge worker processes running on different machines
- Why: For college-scale load (30 concurrent submissions), a single judge worker in a background thread pool is sufficient. Adding Redis adds operational complexity without solving a real bottleneck at our scale.
- Tradeoff: if we ever want to scale to 100+ concurrent submissions, the first step is adding a Redis queue. The architecture is designed so that's a feasible upgrade.

---

## 5. Architecture Overview

### 5.1 System Architecture Diagram (Text)

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React/Next.js)             │
│  Problem List │ Contest View │ Submission Form │ Leaderboard │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│              Next.js API Routes / FastAPI Routes             │
│  POST /submit │ GET /problems │ GET /leaderboard │ WS events│
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Auth API   │   │  Problem API │   │Contest Engine│
│ (Supabase)   │   │ (FastAPI)    │   │  (FastAPI)   │
└──────────────┘   └──────────────┘   └──────────────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │ SQL
                           ▼
                    ┌──────────────────┐
                    │  Postgres (via   │
                    │  Supabase)       │
                    │  - Users         │
                    │  - Problems      │
                    │  - TestCases     │
                    │  - Submissions   │
                    │  - Contests      │
                    └──────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Judge Module (Python)                     │
│  ├─ Compiler Interface (invoke g++, python3, javac)          │
│  ├─ Process Isolation (setrlimit, signal.alarm)              │
│  ├─ Input/Output Pipes (communicate with subprocess)         │
│  ├─ Verdict Comparator (whitespace-normalized string compare)│
│  └─ Verdict Writer (write result back to DB + Realtime)      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│            Redis (Caching & Rate Limiting)                   │
│  ├─ Leaderboard Cache (invalidated on each new AC)           │
│  ├─ Rate Limiter (submissions per user per minute)           │
│  └─ Session Cache (optional, for performance)                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         Supabase Realtime (Event Distribution)               │
│  ├─ Subscription: contest participants subscribe to         │
│  │  submission updates for their contest                     │
│  ├─ Trigger: new submission verdict written to DB            │
│  ├─ Broadcast: all subscribed clients get live update        │
│  └─ Effect: leaderboard & submission status auto-update in UI│
└─────────────────────────────────────────────────────────────┘
```

---

### 5.2 Architectural Styles Used & Justification

| Style | Where | Why It's Used | Concrete Example |
|---|---|---|---|
| **Layered** | Entire system | Separation of concerns across presentation, business logic, data access | Next.js UI → FastAPI routes → DB queries |
| **Pipe-and-Filter** | Judge module | Each stage of judging has a single responsibility, fixed input/output | Read code → Compile → Execute test by test → Compare output → Aggregate verdict |
| **MVC** | Frontend | Model (problem state), View (React components), Controller (Next.js page handlers) | Problem page loads problem from DB, renders statement, handles submission form submit |
| **Event-Driven / Broker** | Realtime leaderboard updates | DB event (verdict insert) triggers Realtime broadcast; UI is a subscriber | Contestant submits → FastAPI writes verdict to DB → Postgres change event → Supabase Realtime → all clients get live leaderboard update |
| **Master-Slave** | Judge execution | Master (FastAPI endpoint) dispatches to slave (subprocess judge), collects result | Submission endpoint spawns judge subprocess, waits for verdict, writes result back |

**Key Design Principle:** None of these patterns are forced. Each exists because it solves a real problem:
- Layered: makes code testable (can test judge without web server)
- Pipe-and-filter: makes judge testable in parts (compile module independently, execution module independently)
- Event-driven: makes leaderboard updates responsive without polling (every 5 seconds)
- Master-slave: makes judge sandboxed (subprocess can't directly access web server state)

---

### 5.3 Module Decomposition

#### **Module 1: Judge Module** (Python/FastAPI)
**Responsibility:** Execute untrusted code submissions safely, return verdicts

**Key Functions:**
```python
judge_submission(code: str, language: str, testcases: List[str]) -> Verdict
```

**Subprocess Isolation:**
- CPU limit via `resource.setrlimit(resource.RLIMIT_CPU, 2)` — CPU seconds, not wall time
- Memory limit via `resource.setrlimit(resource.RLIMIT_AS, 256*1024*1024)` — 256MB max
- Wall-clock timeout via `subprocess.run(..., timeout=3)` — if CPU limit doesn't fire, wall timeout does
- Runs as restricted OS user with no home directory, no network interface, no `/etc/passwd` access
- Stdout/stderr captured and returned as part of verdict

**Honest Limitations:**
- No protection against fork bombs (rlimit can handle a few forks, but a program that rapidly forks faster than we can kill processes might still cause issues)
- No seccomp filtering (programs can make arbitrary syscalls, but they're restricted by OS user permissions)
- Timing variance due to server load is acknowledged — all submissions on the same machine experience the same variance

**Testing:** 40+ unit tests covering:
- TLE: does a `while True` loop correctly time out?
- MLE: does memory allocation in a loop correctly hit the limit?
- RE: does division by zero correctly return RE?
- WA: does output with extra whitespace correctly match expected?
- CE: does invalid C++ syntax correctly produce CE?

---

#### **Module 2: Problem API** (FastAPI)
**Responsibility:** CRUD operations for problems, test case management, problem lifecycle state transitions

**Key Endpoints:**
```
POST   /problems               Create a problem (problem setter)
GET    /problems/{id}          Fetch problem statement
POST   /problems/{id}/testcases Upload test case (problem setter)
PATCH  /problems/{id}/publish  Transition to Published (admin)
GET    /problems/archive       List all published problems (public)
```

**State Machine:**
```
Draft ──(problem setter submits to contest)──> Contest-Active ──(contest ends)──> Published
```

**Data Model:**
```
Problem {
  id: UUID
  title: str
  statement: str (Markdown)
  input_format: str
  output_format: str
  constraints: str
  time_limit_ms: int
  memory_limit_mb: int
  status: Enum[Draft, Contest-Active, Published]
  contest_id: Optional[UUID]  # only set when active in a contest
  created_at: DateTime
  updated_at: DateTime
}

TestCase {
  id: UUID
  problem_id: UUID
  input: str
  expected_output: str
  is_sample: bool  # true for sample I/O shown to contestants
  created_at: DateTime
}
```

**Testing:**
- Unit: problem state transitions (Draft → Published only after contest)
- Integration: upload test case, fetch problem, verify test case is stored
- Validation: published problems must have at least one sample test case

---

#### **Module 3: Submission API** (FastAPI)
**Responsibility:** Accept submissions, dispatch to judge, store verdicts, coordinate with Realtime

**Key Endpoints:**
```
POST   /contests/{id}/submit       Submit code (contestant)
GET    /submissions/{id}           Fetch submission & verdict
GET    /users/me/submissions       List user's submissions
```

**Submission Lifecycle:**
```
Pending ──(judge picks up)──> Running ──(judge finishes)──> Verdict(AC/WA/TLE/MLE/RE/CE)
```

**Background Worker:**
- FastAPI runs a background thread pool using `asyncio` + `executor`
- Submissions sit in an in-memory queue
- Worker picks up a submission, calls `judge_module.judge_submission()`, writes verdict to DB
- Writes also trigger a Supabase Realtime event (DB change notification)

**Rate Limiting:**
- Redis counter per user per minute: max 20 submissions per minute
- If limit hit, return 429 (Too Many Requests)

**Testing:**
- Unit: verdict writes to DB correctly
- Integration: submit → judge → DB write → Realtime event sent
- Stress: 30 concurrent submissions, verify all verdicts correct

---

#### **Module 4: Contest Engine** (FastAPI)
**Responsibility:** Create contests, manage time windows, enforce submission deadlines, auto-publish problems

**Key Endpoints:**
```
POST   /contests              Create contest (admin)
GET    /contests/{id}         Fetch contest details
POST   /contests/{id}/register Register for contest (contestant)
PATCH  /contests/{id}/start   Start contest (admin)
PATCH  /contests/{id}/end     End contest, auto-publish problems (admin)
```

**Contest State Machine:**
```
Draft ──(admin starts)──> Live ──(admin ends or deadline passes)──> Ended ──(auto-publish)──> Archived
```

**Time Enforcement:**
- Submission endpoint checks `if current_time > contest.end_time: reject`
- Background job checks every minute if any contests have ended and auto-publishes problems

**Data Model:**
```
Contest {
  id: UUID
  title: str
  start_time: DateTime
  end_time: DateTime
  status: Enum[Draft, Live, Ended, Archived]
  problem_ids: List[UUID]  # ordered as A, B, C, D
  created_at: DateTime
}

ContestRegistration {
  id: UUID
  user_id: UUID
  contest_id: UUID
  registered_at: DateTime
}
```

**Testing:**
- Submissions before contest starts are rejected
- Submissions after contest ends are rejected
- Problems auto-publish when contest transitions to Ended

---

#### **Module 5: Leaderboard** (FastAPI + Redis + Supabase Realtime)
**Responsibility:** Compute and serve live contest rankings

**Algorithm:**
```
For each contestant in the contest:
  solved_count = number of problems with AC verdict
  penalty = sum over all problems:
    if no AC: 0
    if AC: time_of_first_ac_in_minutes + 20 * (number_of_wa_verdicts)

Sort by: (solved_count DESC, penalty ASC)
```

**Live Updates:**
- Leaderboard is cached in Redis as a sorted set (efficient range queries)
- When a new AC verdict arrives, the cache is invalidated
- Next leaderboard fetch triggers a recompute
- Supabase Realtime broadcasts the new ranking to all subscribed clients

**Correctness Guarantee:**
- Leaderboard reflects the DB state at the moment of computation
- Eventual consistency model: might lag by 1–2 seconds during peak load, but converges correctly

**Testing:**
- Unit: penalty calculation for various submission histories
- Integration: submit multiple solutions, verify leaderboard ranking is correct
- Stress: 30 concurrent submissions in 10 seconds, verify leaderboard eventually correct

---

#### **Module 6: Frontend** (Next.js + React)
**Components:**
- `ContestList`: browse available contests
- `ProblemView`: display problem statement, sample I/O, input text area
- `SubmissionForm`: language dropdown, code textarea, submit button
- `SubmissionStatus`: live update of submission status (Pending → Running → Verdict)
- `Leaderboard`: real-time ranking, subscribed to Realtime updates
- `SubmissionHistory`: list of user's past submissions with verdicts

**State Management:**
- React hooks (`useState`, `useContext`) for local component state
- Supabase client library for real-time subscriptions

**Testing:**
- Jest unit tests for component rendering
- Playwright end-to-end tests for full submission flow (register → join contest → submit → see verdict)

---

## 6. Technology Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | Next.js 14, React, TypeScript, Tailwind CSS | Modern, familiar, rapid UI iteration; Next.js gives us API routes |
| **Backend API** | FastAPI (Python), Uvicorn | Fast async framework, easy to prototype, good for educational clarity |
| **Database** | Postgres (via Supabase) | Relational schema fits our data model; Supabase gives us Realtime + auth |
| **Real-time** | Supabase Realtime | Postgres change notifications → WebSocket broadcast to clients |
| **Caching** | Redis | Leaderboard caching, rate limiting |
| **Judge Execution** | Python `subprocess`, `resource`, `signal` modules | Sandboxing via OS-level limits |
| **Authentication** | Supabase Auth (JWT-based) | Handled by Supabase, frees us from auth security headaches |
| **Deployment** | Docker + Docker Compose locally; cloud TBD | Single-compose file for dev; cloud deployment (Railway, Render, or DigitalOcean) for production |
| **Testing** | pytest (backend), Jest (frontend), Playwright (E2E) | Standard tools, well-integrated with stack |

---

## 7. Hard Problems We Solve

### Problem 1: Safe Code Execution Under Resource Limits
**The Challenge:** Run arbitrary student code without letting it crash the judge server, consume infinite resources, or access the filesystem.

**Our Solution:** 
- Process-level isolation via `resource.setrlimit` (CPU time, memory, file descriptor limits)
- Wall-clock timeout via subprocess timeout
- Runs as an unprivileged OS user (`nobody` or a dedicated judge user)
- Stdout/stderr captured; program has no access to `/etc/passwd`, other files, or network

**Trade-off:** This is sufficient for trusted college users but not for the public internet. We document this explicitly.

---

### Problem 2: Judge Correctness Under Edge Cases
**The Challenge:** Two programs output `42\n` vs `42` — are they the same? What about floating point `1.000000` vs `1.0`?

**Our Solution:**
- Whitespace normalization: strip leading/trailing whitespace, normalize line endings
- String equality after normalization
- For floating point, problem setter must know to phrase the problem as "output an integer" not "output a real number"

**Acknowledged Limitation:** We don't support custom checker programs (which would require sandboxing the checker itself). For multi-answer problems, the problem setter phrases it as "output any valid X" and we accept one reference output.

---

### Problem 3: Leaderboard Consistency Under Concurrent Updates
**The Challenge:** Three submissions arrive simultaneously. Which one appears first on the leaderboard? Does the leaderboard show the same ranking to all viewers?

**Our Solution:**
- Database writes are atomic (Postgres's ACID guarantees)
- Leaderboard is computed from the DB state at a fixed moment
- Redis cache + Realtime subscription ensure all clients converge to the same ranking quickly

**Acknowledged Limitation:** Eventual consistency model (might lag 1–2 seconds during peak load), not strong consistency. For a college contest, this is acceptable — leaderboard lag of 1–2 seconds doesn't affect contest fairness.

---

### Problem 4: Real-Time Updates Without Polling
**The Challenge:** 30 students viewing the leaderboard, refreshing every second, generates 1800 requests/minute to a single endpoint.

**Our Solution:**
- Supabase Realtime: client opens a WebSocket, subscribes to changes in the `submissions` table
- When a verdict is inserted, Postgres notifies Realtime
- Realtime broadcasts the change to all subscribed clients
- Clients recompute leaderboard locally from the change

**Result:** One WebSocket connection per client instead of 60 HTTP requests per minute per client. Massive reduction in server load.

---

### Problem 5: Problem Lifecycle Across Contest/Archive
**The Challenge:** A problem needs different behavior during a contest (hidden until start, visible during contest, locked after end) vs. in the archive (always visible, always submittable).

**Our Solution:**
- Problem has a state: Draft → Contest-Active → Published
- Contest-Active: only visible and submittable within the contest time window
- Published: visible and submittable 24/7
- Automatic state transition when contest ends

**Result:** One Problem object, different behavior based on state. No code duplication, clean state machine.

---

## 8. Hard Problems We Explicitly Don't Solve (And Why)

| Problem | What Production Systems Do | What We Do | Why |
|---|---|---|---|
| **Sandbox Escape** | VM-level isolation (gVisor, Firecracker), seccomp syscall filtering | Process-level rlimit + unprivileged user | We trust college users; escaping puts you on a computer you already have physical access to |
| **Plagiarism** | ML-based AST/token comparison, mosaic detection | Manual instructor review or none | ML adds weeks of work; manual review scales fine for college contests |
| **Interactive Problems** | Bidirectional stdio communication, judge ↔ submission sync | Output-only problems only | Interactive problems are 5% of competitive programming; adds complexity; not worth it for MVP |
| **Custom Checkers** | Sandbox the checker program as you sandbox submissions | Support only single-output problems | Recursive sandboxing (sandbox a checker that runs submissions) is complex; single-output covers 95% of problems |
| **Distributed Judge** | Redis queue, worker pool on multiple machines, load balancing | Single worker in background thread pool | 30 concurrent submissions don't need distributed judging; one server handles it fine |
| **Floating-Point Checker** | Epsilon-based comparison for problems with real-number answers | Only support integer/string outputs | Floating-point comparison is error-prone without problem-specific metadata; we punt to problem setter |
| **Timing Fairness Across Languages** | Per-language time limit multipliers (e.g. Python gets 2x C++ time) | Single time limit, Python is inherently slower | Fair — this is how real contests work; Python solutions are harder to write fast |
| **Production Uptime** | 99.99% SLA, redundancy, failover | Single server, honest restart window | College contest is predictable and scheduled; 99.9% is fine; no need for complex failover |

**Philosophy:** We say "no" explicitly and document why. This shows maturity — you understand the problem space and made conscious tradeoffs, not just built whatever was easiest.

---

## 9. Team Structure & Roles

| Role | Member | Modules | Documentation Ownership |
|---|---|---|---|
| **Backend Lead / Judge** | (Strongest backend engineer — likely you) | Judge module, Submission API, Process isolation | SRS §Judge, §Submission; Unit test plan for judge; Sequence diagram for verdict flow |
| **Backend / Contest** | (Backend #2) | Contest engine, Problem API, Problem lifecycle | SRS §Contest, §Problem; State machine diagrams; Integration test plan |
| **Frontend / Problem UI** | (Frontend #1) | Problem statement display, Submission form, Submission status | SRS §UI; React component design; Frontend unit tests |
| **Frontend / Leaderboard** | (Frontend #2) | Auth UI, Leaderboard, Realtime subscriptions | SRS §Auth, §Leaderboard; E2E test plan (full contest simulation) |
| **Cross-cutting (all)** | All members | SRS, UML diagrams, testing strategy, project management, presentation |  |

**Weekly Sync:** 
- Tuesday: standup on progress, blockers, code review for merged PRs
- Friday: demo of completed features to the group, planning next sprint

---

## 10. Software Engineering Artifacts (For Course)

### 10.1 Requirements Specification (SRS)
**IEEE 830 style, ~20 pages**

**Sections:**
1. Introduction (problem statement, scope)
2. Overall description (user classes, assumptions, constraints)
3. Specific requirements:
   - Functional: every feature listed above with acceptance criteria
   - Non-functional: verdict latency, leaderboard lag, concurrent load, uptime
   - Interface requirements: API endpoints, UI mockups
   - Quality attributes: correctness, performance, usability
4. Appendix: glossary, architecture overview

**Evaluation Criteria:** Does every feature have a clear, testable acceptance criterion? Can you verify you've met each one?

---

### 10.2 Architecture & Design (UML + Rationale)
**~15 pages + diagrams**

**Diagrams:**
- **Use case:** contestant, problem setter, admin; actions and interactions
- **Class:** User, Contest, Problem, Submission, Verdict, LeaderboardEntry; relationships
- **Sequence:** submission flow (contestant → UI → API → Judge → DB → Realtime → UI)
- **State machine:** Problem lifecycle (Draft → Contest-Active → Published)
- **State machine:** Submission lifecycle (Pending → Running → AC/WA/TLE/MLE/RE/CE)
- **Activity:** judge pipeline (receive → compile → execute → compare → verdict)
- **Component:** modules and their interfaces

**Rationale Document:**
- Why layered architecture?
- Why pipe-and-filter judge?
- Why Realtime over polling?
- Why process-level sandboxing?
- Why NOT Docker, why NOT distributed queue?

---

### 10.3 Testing Strategy
**~10 pages**

**Test Plan by Type:**

| Type | Responsibility | Test Cases | Metrics |
|---|---|---|---|
| **Unit** | Judge module; problem state machine; penalty calculation | TLE, MLE, RE, WA, AC; state transitions | 40+ tests, 85% code coverage |
| **Integration (bottom-up)** | Judge + Submission API + DB | Submit → judge → DB verdict | 15+ tests |
| **Integration (top-down)** | Contest flow with stubbed judge | UI → API → judge stub → verdict | 10+ tests |
| **Validation** | Full system vs. SRS requirements | Run all acceptance criteria | Pass/fail checklist |
| **Stress** | 30 concurrent submissions in 10s | Leaderboard lag, verdict correctness under load | Max 5s lag; 100% verdict accuracy |
| **Alpha** | Internal team testing | Host a mock contest, find edge cases | Defect log |
| **Beta** | Real college contest | 20+ students, 50+ submissions | Feedback survey |
| **Regression** | After each sprint, re-run full test suite | All tests from above | No new failures |

---

### 10.4 Project Management Plan
**~8 pages**

**Sections:**
- **Estimation:** COCOMO or similar (3000 LOC → rough estimate)
- **Scheduling:** 3 sprints of 4–5 weeks each; Gantt chart
- **Risk Register:** 5 top risks (sandbox escape, judge TLE variance, Realtime lag, scope creep, deployment failure) with mitigation
- **Quality Metrics:** code coverage, test pass rate, bug escape rate
- **Staffing:** 4 people, roles, time allocation per sprint

**Sprint Plan:**
```
Sprint 1 (Weeks 1–4): Auth + Judge + Problem API
  Goal: core judge works, can create problems, can submit
  Demo: submit a solution, see verdict

Sprint 2 (Weeks 5–8): Contest engine + Leaderboard + UI
  Goal: can host a contest, see live leaderboard
  Demo: run a mini-contest with the team

Sprint 3 (Weeks 9–12): Archive + Polish + Testing + Docs
  Goal: auto-publish problems, full test suite, documentation
  Demo: beta contest with real students
```

---

## 11. Deployment & Deployment Context

**Target Environment:**
- Locally: Docker Compose (dev database, Redis, backend, frontend all run locally)
- College deployment: Single Linux VM (4 CPU, 8GB RAM) running Docker containers
- Alternatively: Managed platform like Railway or Render for Postgres + app

**Infrastructure:**
```
┌─ Docker Network ─────────────────────┐
│  ├─ Postgres (Supabase)              │
│  ├─ Redis                            │
│  ├─ FastAPI backend                  │
│  ├─ Next.js frontend                 │
│  └─ Judge (isolated as subprocess)   │
└──────────────────────────────────────┘
```

**Realistic Constraints:**
- Single server; no multi-machine load balancing
- Storage: ~500MB for a year of contests + problems
- Network: college LAN; assume reliable, low-latency connections

---

## 12. Why This Project is Ideal for the Course

### Maps to Syllabus Requirements

| Syllabus Topic | How KOJ Demonstrates It |
|---|---|
| Life cycle model | Agile with 3 sprints; iterative judging behavior discovery |
| Requirements engineering | Formal SRS with functional/non-functional/constraint requirements |
| System design & UML | 6+ UML diagram types, all real |
| Architectural styles | Layered, pipe-and-filter, event-driven, master-slave — all justified |
| Coupling & cohesion | Judge module is highly cohesive & loosely coupled; problem/contest separation |
| Design tradeoffs | Explicit documentation of what we chose and what we rejected |
| Testing taxonomy | All 8 testing types with real test cases |
| Project management | Gantt chart, risk register, COCOMO estimate |

### Why It's Easy to Present

1. **Real motivation:** Codeforces went down during actual college contests. This is not hypothetical.
2. **Real users:** You run an actual contest before submission. You have real data (N students, X problems, Y submissions).
3. **Honest scoping:** Every architectural decision has a documented reason. You didn't include X because Y; you're not claiming to solve problems you didn't solve.
4. **Interesting design decisions:** Problem lifecycle, leaderboard consistency, event-driven updates — these are the kinds of things you talk about in interviews, not just course projects.
5. **Resume-worthy:** It's not just an assignment. It's a product you deployed and used.

### Evaluation Talking Points (Prepare These)

- *"We chose Agile because the judging behavior wasn't fully specifiable upfront. Waterfall would have locked us into assumptions that failed in practice."*
- *"The judge is pipe-and-filter because each stage (compile, execute, compare) has a single responsibility and can be tested independently. This made debugging edge cases like TLE much easier."*
- *"We use Realtime instead of polling because 30 concurrent students polling every second would overwhelm a naive endpoint. The event-driven model scales gracefully."*
- *"We didn't use Docker per submission because the cold-start overhead and privilege requirements are disproportionate for college-scale load. Process-level isolation is sufficient and honestly documented."*
- *"Our beta testing was real — we hosted an actual contest with [X] students and [Y] submissions. The defects we found informed our second sprint."*

---

## 13. Success Criteria

**Course Submission Success:**
- [ ] SRS is formally written, every requirement is testable
- [ ] UML diagrams cover all 6+ types, each with real system components
- [ ] Testing strategy documents 8 testing types with concrete test cases
- [ ] Project management plan includes Gantt chart and risk register
- [ ] Code is clean, well-commented, follows PEP 8 (Python) and ESLint (JS)
- [ ] Documentation is honest about limitations (sandboxing, no custom checkers)
- [ ] Presentation is confident and justifies every decision

**Product Success:**
- [ ] Platform is deployed and working
- [ ] At least one real contest has been hosted and completed
- [ ] All users (contestants, problem setters, admins) can perform their core workflows
- [ ] Verdict accuracy is 100% on all test cases
- [ ] Leaderboard updates live with <5s lag

**Resume Success:**
- [ ] You can explain the architecture to a senior engineer in 10 minutes
- [ ] You can describe your specific module (judge, contest engine, frontend) and how it fits the system
- [ ] You can show a real contest that ran on the system with real students participating
- [ ] You can explain the hardest decision you made (why X not Y) and defend it

---

## 14. Next Steps

1. **Week 1:** Finalize SRS (requirements), create detailed UML, assign modules to team members
2. **Week 2–3:** Build judge module + Submission API (you), Contest engine (backend #2), Auth UI (frontend #2)
3. **Week 4:** Integrate everything, host first internal test contest
4. **Week 5–8:** Leaderboard, Realtime, UI polish, Redis caching
5. **Week 9–12:** Full test suite, documentation, beta contest, presentation prep

---

## Glossary

- **AC:** Accepted — submission verdict when output matches expected
- **WA:** Wrong Answer — output differs from expected
- **TLE:** Time Limit Exceeded — execution time exceeded the limit
- **MLE:** Memory Limit Exceeded — memory usage exceeded the limit
- **RE:** Runtime Error — program crashed or segfaulted
- **CE:** Compilation Error — code doesn't compile
- **Realtime:** Supabase Realtime; Postgres change notifications pushed to clients via WebSocket
- **Leaderboard:** Rankings sorted by problems solved, then penalty time
- **Penalty:** Time of AC + 20 minutes per wrong attempt
- **Sandbox:** Execution environment with restricted resources and access
- **Subprocess:** Isolated process spawned by the judge to run submitted code
- **Verdict:** Judge's response: the verdict type and any relevant data (runtime, memory, error message)

---

**Version:** 1.0  
**Last Updated:** August 2026  
**Audience:** IIIT Kottayam Software Engineering Course, External Collaborators, Hiring Managers
