# KOJ — Software Requirements Specification (SRS v1.0)

**Canonical document:** `KOJ_SRS.pdf` — "Software Requirements Specification for Kottayam
Online Judge - KOJ", Version 1.0 approved, prepared by Prajwal, Chandra Teja, Shivkarthik,
Hari Krishnan S (Group 3, IIIT Kottayam), 4 August 2026. IEEE 830-1998 format.

**Searchable full text:** `SRS.txt` — extracted from the PDF and repaired so that all 68
`REQ-*` identifiers are intact and greppable:

```bash
grep -A3 'REQ-JUDGE-06' SRS.txt     # one requirement with its description
grep -n 'business rule\|BR-0' SRS.txt
```

**Implementation status:** `SRS-TRACEABILITY.md` maps every requirement to MET / PARTIAL /
DEVIATION / UNVERIFIED / NOT MET with the evidence that was actually checked.

> Do not treat the SRS as a description of what exists. It is the target. Where the running
> system differs, `SRS-TRACEABILITY.md` names the difference and `CONTEXT.md` explains why.

## Requirement index

Priority per the SRS: **H** = must have for v1, **M** = should have, **L** = nice to have.

### 4.1 Authentication and User Management (all H unless noted)

| ID | Requirement |
|---|---|
| REQ-AUTH-01 | Register with email and password |
| REQ-AUTH-02 | OAuth login via GitHub and Google |
| REQ-AUTH-03 | New users get the Contestant role by default |
| REQ-AUTH-04 | Admins can change user roles |
| REQ-AUTH-05 | Session state via Clerk (JWT verified through JWKS) |
| REQ-AUTH-06 | Reject duplicate email registration with a clear error |
| REQ-AUTH-07 | Password reset via email (**M**) |

### 4.2 Problem Management

| ID | Requirement |
|---|---|
| REQ-PROB-01 | Create problems with title, statement (markdown), time limit, memory limit, difficulty |
| REQ-PROB-02 | Upload test cases as input/output text-file pairs |
| REQ-PROB-03 | Enforce a 10 MB maximum per test-case file |
| REQ-PROB-04 | Problem state machine: Draft → Contest-Active → Published |
| REQ-PROB-05 | Draft problems visible only to their setter and admins |
| REQ-PROB-06 | Contest-Active problems visible only to registered participants during the contest |
| REQ-PROB-07 | Published problems visible to all users for practice |
| REQ-PROB-08 | Markdown rendering in statements (**M**) |
| REQ-PROB-09 | Setters can edit problems in Draft |
| REQ-PROB-10 | No editing of Contest-Active problems after the contest starts |

### 4.3 Code Submission and Judge Pipeline

| ID | Requirement |
|---|---|
| REQ-JUDGE-01 | Accept submissions via POST and return a submission ID |
| REQ-JUDGE-02 | Support C, C++, Python, Java (v1) |
| REQ-JUDGE-03 | Compile C/C++ with gcc/g++ and Java with javac |
| REQ-JUDGE-04 | CPU time limits via `resource.setrlimit(RLIMIT_CPU)` |
| REQ-JUDGE-05 | Wall-clock limits via subprocess timeout |
| REQ-JUDGE-06 | Memory limits via `resource.setrlimit(RLIMIT_AS)` |
| REQ-JUDGE-07 | Bound subprocess count per submission (fork-bomb guard) |
| REQ-JUDGE-08 | Execute in an isolated working directory containing only judge files |
| REQ-JUDGE-09 | Whitespace-normalised output comparison |
| REQ-JUDGE-10 | Run all test cases and return a single verdict |
| REQ-JUDGE-11 | Verdicts: AC, WA, TLE, MLE, RE, CE, PE |
| REQ-JUDGE-12 | Deliver verdicts in real time (spec: WebSocket) |
| REQ-JUDGE-13 | Handle 10 concurrent judging tasks |
| REQ-JUDGE-14 | Log every submission result (id, verdict, time, memory) |
| REQ-JUDGE-15 | Custom checker programs (**M**, v2) |
| REQ-JUDGE-16 | Per-problem time limit, default 2 s |
| REQ-JUDGE-17 | Per-problem memory limit, default 256 MB |

### 4.4 Contest Management

| ID | Requirement |
|---|---|
| REQ-CONT-01 | Admins create contests with title, description, start, end, registration mode |
| REQ-CONT-02 | Two registration modes: Open Enrollment and Invite-Based |
| REQ-CONT-03 | Add existing problems to a contest |
| REQ-CONT-04 | Problems open automatically at start, lock at end |
| REQ-CONT-05 | One-click registration for open contests |
| REQ-CONT-06 | Invite-code registration for private contests |
| REQ-CONT-07 | No submissions to contest problems after the end time |
| REQ-CONT-08 | Countdown timer showing time remaining (**M**) |
| REQ-CONT-09 | Team contest mode (**L**) |

### 4.5 Live Leaderboard

| ID | Requirement |
|---|---|
| REQ-LB-01 | Rank by problems solved (desc) then penalty (asc) |
| REQ-LB-02 | Penalty = first-AC time in minutes + 20 × wrong before first AC |
| REQ-LB-03 | Real-time update via push from the backend |
| REQ-LB-04 | Leaderboard updates within 2 seconds of a verdict |
| REQ-LB-05 | Visible to all users during and after the contest |
| REQ-LB-06 | Per-problem status (solved/unsolved/attempted) (**M**) |

### 4.6 Rate Limiting and Abuse Prevention

| ID | Requirement |
|---|---|
| REQ-RATE-01 | 1 submission per 30 seconds per user per problem |
| REQ-RATE-02 | HTTP 429 with a `Retry-After` header when exceeded |
| REQ-RATE-03 | Visible countdown on the submit button (**M**) |

### 5.1 Performance

| ID | Requirement |
|---|---|
| REQ-PERF-01 | Submission accepted with an ID within 1 second |
| REQ-PERF-02 | Verdict within 5 seconds for simple problems |
| REQ-PERF-03 | 50 concurrent users without responses over 3 seconds |
| REQ-PERF-04 | Leaderboard updates within 2 seconds of a verdict write |
| REQ-PERF-05 | Problem list page loads within 2 seconds (**M**) |
| REQ-PERF-06 | Up to 10 concurrent judging tasks per instance |

### 5.2 Safety

| ID | Requirement |
|---|---|
| REQ-SAFE-01 | Submitted code cannot access or modify files outside the sandbox |
| REQ-SAFE-02 | Kill any submission exceeding its CPU or wall-clock limit |
| REQ-SAFE-03 | Limit child processes to prevent fork bombs |
| REQ-SAFE-04 | Never expose one user's source code to another (**M**) |

### 5.3 Security

| ID | Requirement |
|---|---|
| REQ-SEC-01 | HTTPS for all frontend↔backend traffic |
| REQ-SEC-02 | Passwords hashed with bcrypt (Clerk) |
| REQ-SEC-03 | Validate JWT tokens on authenticated routes |
| REQ-SEC-04 | Admin-only endpoints verify the Admin role before processing |
| REQ-SEC-05 | CSRF protection for state-changing requests (**M**) |
| REQ-SEC-06 | Sanitise input against SQL injection and XSS |

### 5.4 Quality attributes and 5.5 Business rules

Availability 99.5 % during contests · Reliability (no incorrect AC) · Maintainability ·
Testability (40+ judge unit tests) · Usability (no tutorial needed) · Portability (Docker-free
deployment).

| ID | Business rule |
|---|---|
| BR-01 | Only Admins can create contests |
| BR-02 | Only Problem Setters and Admins can create problems |
| BR-03 | Only Admins can change user roles |
| BR-04 | A problem must be in Draft before it can be added to a contest |
| BR-05 | Submissions to a contest problem are locked after the contest end time |
| BR-06 | A user can only register for a contest before it starts |
| BR-07 | Penalty counts only after the first AC; later ACs do not change it |
| BR-08 | Problems in an active contest cannot be edited |

### §6 Other requirements and Appendix B (TBD list)

Database must contain users, problems, test_cases, submissions, contests, contest_problems,
contest_registrations and leaderboards · realtime SSE/push + optional Redis (TBD-01, now
implemented as optional) · custom checkers via testlib (TBD-02) · Go/Rust/JS (TBD-03) · team
mode (TBD-04) · password reset (TBD-05) · exact Azure/GCP deployment (TBD-06) · interactive
problems (TBD-07).
