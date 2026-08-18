# KOJ UI Design

This document describes the UI milestone. Data and judge results are mock/static; the routes and interactions demonstrate the user experience described by the SRS and use cases.

## Major Screens

### 1. Home (`/`)

```text
+------------------------------------------------------------------+
| KOJ / Home     Problems   Contests   Rankings   Sign in           |
+------------------------------------------------------------------+
| KOJ                                      [terminal system view]   |
| Kottayam Online Judge                      boot / judge output   |
| Host contests. Practice problems.          [Get Started]         |
+------------------------------------------------------------------+
| PROBLEMS INDEXED | ACTIVE CONTESTS | DAILY SUBMISSIONS           |
+------------------------------------------------------------------+
| Featured problem                         Upcoming contest        |
+------------------------------------------------------------------+
```

Purpose: Main entry point and product overview. Components: branding, hero, terminal preview, stats, featured problem, upcoming contest. Actions: sign in/up, browse problems, view contests, open featured content. Functionality: links to the public archive and contest schedule.

### 2. Problem List (`/problems`)

```text
+------------------------------------------------------------------+
| PROBLEM ARCHIVE                         [search] [difficulty]     |
| 008 indexed · practice catalogue                                |
+------------------------------------------------------------------+
| ID | Problem | Difficulty | Topic | Acceptance | Status            |
| 001| Two Sum | Easy       | Arrays| 85.2%      | Solved            |
| 002| ...                                                       |
+------------------------------------------------------------------+
```

Purpose: Browse available programming problems. Components: search, difficulty filters, archive table, status indicators. Actions: filter/search and open any problem. Functionality: client-side filtering over mock archive records.

### 3. Problem View and Submission (`/problems/[id]`)

```text
+-----------------------------------+------------------------------+
| Problem title / difficulty        | SUBMIT SOLUTION [language]   |
| Statement                         |                              |
| Input / Output / Constraints      | [editable code textarea]     |
| Samples / limits                  | [RUN SAMPLE] [SUBMIT]        |
|                                   | Recent verdicts              |
+-----------------------------------+------------------------------+
```

Purpose: Read a problem and prepare a solution. Components: statement sections, samples, limits, language selector, code textarea, verdict list. Actions: change language, edit code, run sample, submit. Functionality: run shows a local message; submit opens `/submissions/1042`.

### 4. Submission Status (`/submissions/[id]`)

```text
+------------------------------------------------------------------+
| Submission #1042                              PENDING / RUNNING  |
+------------------------------------------------------------------+
| Problem | Language | Submitted | Verdict                         |
| TEST CASE PROGRESS                       [======------] 7 / 12   |
+------------------------------------------------------------------+
| Runtime 0.42 s       Memory 18 MB       Queue state ACCEPTED     |
+------------------------------------------------------------------+
```

Purpose: Show judge progress and result. Components: submission metadata, state badge, progress bar, runtime/memory cards. Actions: return to problem. Functionality: mock state advances Pending → Running → Accepted.

### 5. Contest Page (`/contests`, `/contests/[id]`)

```text
+------------------------------------------------------------------+
| CONTEST ARENA                 [All] [Registration Open] [Active] |
+------------------------------------------------------------------+
| Contest title       status                  start / end           |
| description         problems / participants [ENTER] [REGISTER]  |
+------------------------------------------------------------------+
| Contest detail: countdown | problem queue | register | leaderboard|
+------------------------------------------------------------------+
```

Purpose: Discover contests and enter an arena. Components: status filters, contest cards, countdown, problem list, registration and leaderboard links. Actions: register, view details, join active contest. Functionality: registration and countdown are local UI state; arena is available at `/contests/[id]/arena`.

### 6. Leaderboard (`/rankings`)

```text
+------------------------------------------------------------------+
| LEADERBOARD                 [contest selector]   ● LIVE            |
+------------------------------------------------------------------+
| Rank | User | A | B | C | D | Solved | Penalty                  |
|  1   | Shiv | ✓ | ✓ | - | ✓ |   3    | 142 min                   |
|  2   | Hari | ✓ | - | ✓ | ✓ |   3    | 157 min                   |
+------------------------------------------------------------------+
```

Purpose: Show contest ranking. Components: contest selector, live indicator, standings table, per-problem verdicts. Actions: switch contest. Functionality: mock values demonstrate solved-descending and penalty-ascending ranking.

### 7. Admin Dashboard (`/admin`)

```text
+------------------------------------------------------------------+
| ADMIN DASHBOARD                              [CREATE PROBLEM]    |
| users | problems | active contests | submissions                 |
+-------------------------------+----------------------------------+
| Problem management             | Contest management              |
| list / VIEW / EDIT / CREATE    | list / MANAGE / CREATE          |
+------------------------------------------------------------------+
| User management: user | email | role selector | SAVE ROLE         |
+------------------------------------------------------------------+
```

Purpose: Provide platform administration UI. Components: statistics, problem management, contest management, user management. Actions: view/edit/create mock actions, manage contests, change roles among Contestant, Problem Setter, and Admin. Functionality: controls update local UI state and show confirmation messages.

## Navigation Flow

```text
                              HOME /
                                |
             +------------------+------------------+
             |                  |                  |
         PROBLEMS           CONTESTS            RANKINGS
             |                  |                  |
             v                  v                  |
       PROBLEM VIEW       CONTEST DETAILS <---------+
             |                  |
             v                  v
     SUBMISSION STATUS    CONTEST ARENA

ADMIN / ADMIN DASHBOARD
             |
       +-----+------+--------+
       |            |        |
   PROBLEMS      CONTESTS  USERS
```

Authentication routes remain `/sign-in/[[...sign-in]]` and `/sign-up/[[...sign-up]]`. The UI milestone exposes the main screens to allow navigation without requiring backend authentication.

## Route Inventory

| Route | Screen |
|---|---|
| `/` | Home |
| `/problems` | Problem archive |
| `/problems/[id]` | Problem statement and submission |
| `/submissions/[id]` | Submission status |
| `/contests` | Contest listing |
| `/contests/[id]` | Contest details |
| `/contests/[id]/arena` | Active contest arena |
| `/rankings` | Leaderboard |
| `/admin` | Admin dashboard |

## Implementation Notes

- Mock records live in `mock/data.ts` rather than being scattered through pages.
- No database, judge process, WebSocket, or submission API is used by these screens.
- The leaderboard live label and submission progression are simulated UI states only.
