# Contestant User Guide

Welcome to **KOJ (Kottayam Online Judge)** — the competitive programming platform for IIIT Kottayam. This guide covers everything you need to know to practice problems, compete in contests, and track your progress.

---

## 1. Registration and Authentication

KOJ uses Clerk for secure account management.

- **Sign-up (`/sign-up`)**: Create an account using your email and password, or authenticate instantly using GitHub or Google OAuth.
- **Sign-in (`/sign-in`)**: Log into your existing account.
- **Profile Initialization**: Upon your first sign-in or submission, your contestant profile and database user record are automatically created.

You can browse problems and public contest details without signing in, but you must be signed in to submit solutions, run sample tests, register for contests, and view your personal dashboard.

---

## 2. Browsing the Problem Archive

The public problem archive is located at `/problems`. It contains problems available for open practice.

### Features and Filters
- **Search Bar**: Filter problems in real time by title or category.
- **Difficulty Badges**:
  - `Easy` (green)
  - `Medium` (yellow)
  - `Hard` (red)
- **Topic Filters**: Filter by subject areas such as `math`, `arrays`, `dp`, `graphs`, `strings`, etc.
- **Acceptance Rate**: Shows percentage of successful submissions across all participants.
- **Contestant Status Indicators**:
  - `● Solved` (green): You have solved this problem with an Accepted verdict.
  - `◐ Attempted` (yellow): You have submitted a solution, but have not yet achieved Accepted.
  - `○ Unsolved` (gray): You have not yet submitted a solution for this problem.

Click any problem row to open the full problem workspace.

---

## 3. Solving Problems

The problem interface (`/problems/[id]`) provides a split-view workspace with the problem statement on the left and the coding terminal on the right.

### Workspace Layout
- **Statement**: Full markdown problem description, input format, output format, constraints, and optional explanation notes.
- **Sample Cases**: Pre-configured sample inputs and expected outputs.
- **Resource Constraints**: Explicit per-case limits for CPU execution time (ms) and RAM memory (MB).

### Supported Programming Languages
Select your language from the dropdown menu in the code submission pane:
- **Python** (Python 3.11)
- **C** (GCC, `-O2`)
- **C++** (G++, `std=c++17`, `-O2`)
- **Java** (OpenJDK Headless)

Your code is read from standard input (`stdin`) and must write output to standard output (`stdout`).

### Submission Modes

| Action | Button | Scope | Impact on Standings |
|---|---|---|---|
| **Run Sample** | `RUN SAMPLE` | Tests code against **public sample cases** only. | None. Used to quickly check syntax, logic, and output formatting. |
| **Submit** | `SUBMIT` | Evaluates code against **all test cases** (sample + hidden). | Counts towards problem completion and contest leaderboard scoring. |

Both modes run your code through the isolated judge service and report execution time and status.

---

## 4. Understanding Verdicts

After running or submitting code, KOJ displays a verdict along with the count of passed test cases and execution time:

| Verdict | Acronym | Meaning | Typical Causes & Solutions |
|---|---|---|---|
| **Accepted** | **AC** | Your solution passed all test cases within the resource limits. | Correct output across all test cases. |
| **Wrong Answer** | **WA** | Output produced by your program did not match expected output. | Logical bug, missed edge case, off-by-one errors, or incorrect formula. |
| **Time Limit Exceeded** | **TLE** | Solution exceeded the CPU time limit (e.g. 1000 ms). | Inefficient algorithm complexity (e.g., $O(N^2)$ instead of $O(N \log N)$), infinite loop, or slow I/O. |
| **Memory Limit Exceeded** | **MLE** | Solution allocated more RAM than the memory limit (e.g. 256 MB). | Creating overly large arrays or recursion depth causing memory exhaustion. |
| **Runtime Error** | **RE** | Program crashed during execution or exited with a non-zero code. | Division by zero, index out of bounds, null pointer dereference, or unhandled exception. |
| **Compilation Error** | **CE** | Code failed to compile. | Syntax error, missing header or import, or type mismatch. Compiler output is displayed in the response notice. |
| **Presentation Error** | **PE** | Output content is logically correct, but whitespace/formatting differs. | Extra spaces at end of lines, missing newlines, or extra blank lines. |

---

## 5. Participating in Contests

Contests are organized at `/contests`.

### Contest Stages
1. **Upcoming**: Announced contest.
2. **Registration Open**: Registration is active; participants can register before contest start.
3. **Active**: The contest is live. Registered contestants can enter the arena and submit code.
4. **Finished**: The contest has concluded. Problems transition to the public archive and final standings are archived.

### Registration
- **Open Contests**: Click **REGISTER** to sign up.
- **Invite-Only Contests**: Enter the secret **Invite Code** distributed by organizers, then click **REGISTER NOW**.

### Countdown Timer
- Displays **starts in `HH:MM:SS`** prior to start.
- Displays **time remaining `HH:MM:SS`** while live.
- When the timer reaches zero, the page automatically refreshes to unlock the arena or finalize results.

### The Arena (`/contests/[id]/arena`)
When a contest is active and you are registered, click **ENTER ARENA** to open the live contest arena:
- Problems are letter-indexed (**A**, **B**, **C**, etc.).
- Submitting code from within the arena tags the submission with the `contestId`.
- Live standings reflect only submissions made during the contest window.

---

## 6. Leaderboard & ICPC Scoring

The contest standings are available at `/rankings?contestId=[id]` and update live during active contests via Server-Sent Events (SSE).

### ICPC Scoring Rules
1. **Rank Order**: Contestants are ranked primarily by **number of solved problems (descending)**.
2. **Tie-Breaking**: If contestants have solved the same number of problems, the contestant with the **lowest total penalty time (ascending)** is ranked higher.
3. **Penalty Calculation**:
   - **Penalty for a Solved Problem** = Time in minutes from contest start to your first Accepted (AC) submission + **20 minutes** for each rejected submission on that problem made prior to the first AC.
   - Example: You solve problem A at minute 35 after 2 Wrong Answers. Penalty for problem A = $35 + (2 \times 20) = 75$ minutes.
   - **Submissions after AC**: Subsequent submissions after solving a problem do not add penalty.
   - **Unsolved Problems**: If a problem is never solved, zero penalty is added for failed attempts on that problem.

---

## 7. Rate Limits and Policies

To ensure fair judging and system stability:
- **Rate Limit**: Maximum **1 submission every 30 seconds per problem** per user (`REQ-RATE-01/02`).
- Applies to both `RUN SAMPLE` and `SUBMIT` actions.
- The submit button displays a live cooldown countdown (`WAIT 30s`).
- Attempting to bypass the cooldown results in an `HTTP 429 Too Many Requests` error with a `Retry-After` header.
- **Code Size Limit**: Submissions are limited to **100 KB** of source code.

---

## 8. Contestant Dashboard

Your personal dashboard is located at `/dashboard`:
- **Summary Metrics**: View total problems in the catalogue, active live contests, total registered users, and submissions made today.
- **Active Contests**: Quick links and time-remaining indicators for running competitions.
- **Quick Links**: Jump straight into the arena or the problem archive.
