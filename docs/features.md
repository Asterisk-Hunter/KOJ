# Features

## MVP features

### Authentication & Authorization
- User registration and login
- Three roles: **Contestant**, **Problem Setter**, **Admin**
- Role-based access control (students see contests only, setters can create problems, admins manage system)
- Session management via JWT or Supabase auth

### Problem Authoring System
- **Problem creation form:** title, statement (Markdown rendered to HTML), input/output format specification, constraints
- **Test case management:** problem setters upload multiple test cases as plaintext files
- **Test case display:** sample input/output shown to contestants; hidden test cases used only during judging
- **Time and memory limits:** configurable per-problem, with sane defaults (1s, 256MB)
- **Problem status:** Draft (editor-only) → Contest-Active (during contest) → Published (public archive after contest)

### Contest Engine
- **Contest creation:** admin creates a contest with a name, start time, end time, list of problems
- **Registration:** students register for contests before they start
- **Visibility rules:** before start (problems hidden), during contest (all visible, submissions open), after contest (submissions closed, problems auto-published)
- **Timed enforcement:** submissions rejected if received after contest end time

### Code Submission & Judging
- **Submission UI:** text area or file upload, language selector (C++, Python initially)
- **Submission flow:** code sent to FastAPI endpoint → queued for judge → judge runs → verdict written to DB → Realtime event triggers UI update
- **Judge module:** Python subprocess execution with `resource.setrlimit` for CPU/memory limits
- **Verdict types:** AC (Accepted), WA (Wrong Answer), TLE (Time Limit Exceeded), MLE (Memory Limit Exceeded), RE (Runtime Error), CE (Compilation Error)
- **Multiple submissions:** contestant can submit multiple times; only the last verdict is shown, but all submissions are stored

### Real-Time Submission Status
- Contestant submits → status immediately shows "Queued"
- Judge starts running → status updates to "Running" (30s timeout before TLE)
- Judge finishes → status updates to final verdict
- UI updates live via Supabase Realtime subscriptions, no polling

### Leaderboard
- **Ranking:** problems solved (descending), then penalty time (ascending)
- **Penalty calculation:** time of first AC submission + 20 minutes for each wrong attempt before the AC
- **Live updates:** leaderboard refreshes automatically as new AC verdicts arrive during the contest
- **Post-contest:** leaderboard is frozen and visible as a read-only final ranking

### Problem Archive
- After a contest ends, all problems are automatically published to a public archive
- Students can submit practice solutions to archived problems anytime (24/7)
- Practice submissions are judged with the same judge, but don't contribute to any leaderboard
- Submission history for practice problems is stored and visible to the user

### Submission History
- Students can view all their submissions per problem: code, timestamp, language, verdict, execution time/memory
- Can re-read the code of any past submission

---

## Non-Functional Requirements

| Requirement | Target | Rationale |
|---|---|---|
| Verdict latency | ≤10 seconds from submission to verdict | Contestant feedback loop during contest |
| Leaderboard update latency | ≤5 seconds from AC verdict to leaderboard rank change | Live contest excitement |
| Concurrent submissions | 30 simultaneous submissions without timeout | College contest peak load |
| Judge accuracy | 100% verdicts match manual verification | Wrong verdicts break trust in the system |
| Submission queue throughput | 60 submissions/minute sustained | Average college contest throughput |
| Uptime during contest | No unplanned downtime during scheduled contest window | Core reliability requirement |

---

## Stretch goals

- Support for a third language (Java or JavaScript)
- Basic syntax highlighting in the code submission textarea
- Discussion/editorial threads per problem, unlocked after contest ends
- Code similarity detection (simple token-based, not cryptographic) to flag potential plagiarism
- Email notifications for contest start/end
- Codeforces-style rating system (Elo rating updates after each contest)
- Problem difficulty tags and filterable problem archive
- A "hack-a-submission" feature: allow contestants to submit failing test cases against others' AC submissions

---

## Explicitly out of scope

### 1. Production-Grade Code Sandboxing
- **What we don't do:** Docker-per-submission, gVisor/Firecracker microvms, seccomp syscall filtering, chroot jails
- **What we do:** process-level isolation via `resource.setrlimit`, running submissions as a restricted OS user
- **Why:** Production sandboxing adds weeks of hardening and DevOps complexity. For a trusted college user base, process-level isolation is sufficient.

### 2. Plagiarism Detection at Scale
- **What we don't do:** cryptographic AST comparison, mosaic detection, ML plagiarism models
- **Why:** Significant algorithmic and ML overhead. Instructors should manually review suspicious solutions.

### 3. Interactive Problems
- **What we don't do:** bidirectional piped communication between judge and submission
- **Why:** Interactive judging requires two-way communication, harder to sandbox and debug. Most competitive programming contests are output-only anyway.

### 4. Custom Checkers / Special Judges
- **What we don't do:** allow problem setters to provide custom checker programs
- **Why:** Running untrusted checker code requires sandboxing the checker itself. For initial scope, only single-output problems.

### 5. Distributed Judge Workers
- **What we don't do:** Redis job queue, multiple judge worker processes on different machines
- **Why:** For college-scale load (30 concurrent submissions), a single judge worker in a background thread pool is sufficient.

### 6. Floating-Point Checker
- **What we don't do:** epsilon-based comparison for real-number answers
- **Why:** Floating-point comparison is error-prone. Problem setter must phrase problems as integer/string outputs.
