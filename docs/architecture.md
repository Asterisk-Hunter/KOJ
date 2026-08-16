# Architecture

## System diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 16 + React)             │
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

## Architectural styles

| Style | Where | Why | Concrete example |
|---|---|---|---|
| **Layered** | Entire system | Separation of concerns across presentation, business logic, data access | Next.js UI → FastAPI routes → DB queries |
| **Pipe-and-Filter** | Judge module | Each stage has a single responsibility, fixed input/output | Read code → Compile → Execute test by test → Compare output → Aggregate verdict |
| **MVC** | Frontend | Model (problem state), View (React components), Controller (Next.js page handlers) | Problem page loads problem from DB, renders statement, handles submission form submit |
| **Event-Driven / Broker** | Realtime leaderboard | DB event (verdict insert) triggers Realtime broadcast; UI is a subscriber | Submission → FastAPI writes verdict → Postgres change event → Supabase Realtime → live leaderboard |
| **Master-Slave** | Judge execution | Master (FastAPI endpoint) dispatches to slave (subprocess judge), collects result | Submission endpoint spawns judge subprocess, waits for verdict, writes result back |

### Why each pattern exists

- **Layered:** makes code testable (can test judge without web server)
- **Pipe-and-filter:** makes judge testable in parts (compile module independently, execution module independently)
- **Event-driven:** makes leaderboard updates responsive without polling (every 5 seconds)
- **Master-slave:** makes judge sandboxed (subprocess can't directly access web server state)

None of these patterns are forced. Each exists because it solves a real problem.

---

## Module decomposition

### Module 1: Judge Module (Python)

**Responsibility:** Execute untrusted code submissions safely, return verdicts.

**Key function:**
```python
judge_submission(code: str, language: str, testcases: List[str]) -> Verdict
```

**Subprocess isolation:**
- CPU limit via `resource.setrlimit(resource.RLIMIT_CPU, 2)` — CPU seconds, not wall time
- Memory limit via `resource.setrlimit(resource.RLIMIT_AS, 256*1024*1024)` — 256MB max
- Wall-clock timeout via `subprocess.run(..., timeout=3)` — if CPU limit doesn't fire, wall timeout does
- Runs as restricted OS user with no home directory, no network interface
- Stdout/stderr captured and returned as part of verdict

**Honest limitations:**
- No protection against fork bombs
- No seccomp filtering
- Timing variance due to server load is acknowledged

---

### Module 2: Problem API (FastAPI)

**Responsibility:** CRUD operations for problems, test case management, problem lifecycle state transitions.

**Endpoints:**
```
POST   /problems               Create a problem (problem setter)
GET    /problems/{id}          Fetch problem statement
POST   /problems/{id}/testcases Upload test case (problem setter)
PATCH  /problems/{id}/publish  Transition to Published (admin)
GET    /problems/archive       List all published problems (public)
```

**State machine:**
```
Draft ──(problem setter submits to contest)──> Contest-Active ──(contest ends)──> Published
```

---

### Module 3: Submission API (FastAPI)

**Responsibility:** Accept submissions, dispatch to judge, store verdicts, coordinate with Realtime.

**Endpoints:**
```
POST   /contests/{id}/submit       Submit code (contestant)
GET    /submissions/{id}           Fetch submission & verdict
GET    /users/me/submissions       List user's submissions
```

**Lifecycle:**
```
Pending ──(judge picks up)──> Running ──(judge finishes)──> Verdict(AC/WA/TLE/MLE/RE/CE)
```

**Background worker:** FastAPI runs a background thread pool. Submissions sit in an in-memory queue. Worker picks up, calls judge, writes verdict to DB. Writes trigger Supabase Realtime events.

---

### Module 4: Contest Engine (FastAPI)

**Responsibility:** Create contests, manage time windows, enforce submission deadlines, auto-publish problems.

**Endpoints:**
```
POST   /contests              Create contest (admin)
GET    /contests/{id}         Fetch contest details
POST   /contests/{id}/register Register for contest (contestant)
PATCH  /contests/{id}/start   Start contest (admin)
PATCH  /contests/{id}/end     End contest, auto-publish problems (admin)
```

**State machine:**
```
Draft ──(admin starts)──> Live ──(admin ends or deadline passes)──> Ended ──(auto-publish)──> Archived
```

---

### Module 5: Leaderboard (FastAPI + Redis + Supabase Realtime)

**Responsibility:** Compute and serve live contest rankings.

**Algorithm:**
```
For each contestant:
  solved_count = number of problems with AC
  penalty = sum over problems:
    if no AC: 0
    if AC: time_of_first_ac_minutes + 20 * (wrong_attempts_before_ac)

Sort by: (solved_count DESC, penalty ASC)
```

**Live updates:** Leaderboard cached in Redis. On new AC verdict, cache invalidated. Supabase Realtime broadcasts new ranking to all clients.

---

### Module 6: Frontend (Next.js + React)

**Components:**
- `ContestList` — browse available contests
- `ProblemView` — display problem statement, sample I/O, input area
- `SubmissionForm` — language dropdown, code textarea, submit button
- `SubmissionStatus` — live update (Pending → Running → Verdict)
- `Leaderboard` — real-time ranking via Realtime subscriptions
- `SubmissionHistory` — user's past submissions with verdicts
