# Google Stitch Prompt — KOJ Screen Design

> Copy the sections below into Google Stitch to generate screens for the KOJ (Kottayam Online Judge) contest platform.

---

## Project Context

KOJ is a self-hosted contest hosting platform with an integrated problem archive for IIIT Kottayam students. It is a competitive programming judge (like Codeforces or SPOJ) built for college-scale use (20-50 concurrent users). The platform supports: problem authoring, contest hosting, code submission and judging, real-time leaderboards, and a public problem archive.

**Tech stack:** Next.js 16, React 19, Tailwind CSS v4, Drizzle ORM (Neon Postgres), FastAPI (Python), Supabase Realtime.

---

## Design System

### Theme
- **Dark mode default** (respect `prefers-color-scheme`)
- **Primary palette:** zinc-950 background, zinc-50 text, zinc-400 muted text
- **Accent color:** emerald-500 (#10b981) — used for AC (Accepted), positive states, primary CTAs
- **Warning:** amber-500 — for TLE, pending states
- **Error:** red-500 — for WA (Wrong Answer), RE, MLE, CE
- **Info:** sky-500 — for neutral states, running submissions
- One accent per page. No purple gradients. No neon glows.

### Typography
- **Display / Headlines:** Geist Sans, `text-2xl md:text-4xl tracking-tight font-semibold`
- **Body:** Geist Sans, `text-sm text-zinc-400 leading-relaxed`
- **Monospace / Code:** JetBrains Mono or Geist Mono, `text-sm`
- No serif fonts. No Inter. No decorative typography.

### Spacing & Layout
- Max content width: `max-w-7xl mx-auto`
- Section padding: `py-8` to `py-12`
- Card gap: `gap-4` to `gap-6`
- Border radius: `rounded-xl` (12px) for cards, `rounded-lg` (8px) for buttons/inputs
- 1px borders: `border border-zinc-800` for card edges

### Components
- Cards: minimal, border-only (no heavy shadows)
- Buttons: solid fill for primary, ghost/outline for secondary
- Inputs: dark background (`bg-zinc-900`), zinc-700 border, emerald-500 focus ring
- Badges/pills: small, solid background, monospace text
- Tables: no border-t + border-b on every row; use divide-y sparingly or card-based rows

### Anti-patterns to avoid
- No centered hero with dark mesh gradient
- No three identical feature cards
- No purple/blue AI gradients
- No glassmorphism
- No em-dashes (use hyphens or periods)
- No "Scroll to explore" cues
- No version labels (V0.6, BETA) in hero
- No fake screenshots (use described placeholders)
- No Inter as default font

---

## Screen 1: Home / Landing

**Purpose:** First impression. Explain what KOJ is, show active contests, drive sign-up.

**Layout:**
- **Hero section:** Left-aligned headline + subtext + CTA button. No centered hero. No gradient mesh background.
  - Headline: "KOJ" (large, bold) or "Kottayam Online Judge"
  - Subtext (max 20 words): "Host programming contests. Judge submissions in real-time. Build a growing archive of problems."
  - Primary CTA: "Get Started" (emerald-500 bg)
  - Secondary CTA: "View Problems" (ghost/outline)
- **Stats strip** (below hero): 3 metrics in a row — "Problems" count, "Contests" count, "Submissions" count. Each is a number + label, no cards, just inline.
- **Active contests section:** 2-3 contest cards showing name, date, status badge (Upcoming / Live / Ended). Cards have border, hover state (subtle emerald border glow).
- **Recent submissions feed** (optional): small list of recent submissions with verdict badges (AC green, WA red). Shows the platform is alive.
- **Footer:** Simple. GitHub link, IIIT Kottayam branding.

**Dark mode:** zinc-950 bg, zinc-50 text, emerald accents.

---

## Screen 2: Problem Archive

**Purpose:** Browse and search all published problems. Filter by difficulty, tag, status.

**Layout:**
- **Header bar:** "Problem Archive" title + search input (left) + filter dropdowns (right: Difficulty, Tag, Status)
- **Problem list:** Card-based, not table-based. Each card shows:
  - Problem ID (monospace, e.g., "P001")
  - Problem title (bold, zinc-50)
  - Difficulty badge (Easy=emerald, Medium=amber, Hard=red)
  - Tags as small pills (e.g., "dp", "graphs", "greedy")
  - Submissions count + AC rate (small, muted text)
  - Solved indicator (green checkmark if user solved it)
- **Empty state:** "No problems found. Try adjusting your filters." with a ghost button to clear filters.
- **Pagination:** Simple numbered pagination at bottom, or infinite scroll.

**Card style:** `bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors`

---

## Screen 3: Problem Detail

**Purpose:** View problem statement, sample I/O, constraints, and submit code.

**Layout (two-column on desktop, stacked on mobile):**

**Left column (60%):**
- Problem title + difficulty badge + tags
- **Statement** (Markdown rendered): problem description, input format, output format, constraints
- **Sample Input / Output** blocks: monospace, with a "Copy" button on each. Each sample has input and output side by side or stacked.
- **Explanation** (if provided): text explaining the sample

**Right column (40%, sticky on scroll):**
- **Submission form:**
  - Language dropdown (C++, Python, Java)
  - Code editor (textarea with monospace font, line numbers optional)
  - "Submit" button (emerald-500, full width)
  - Submission count for this problem (muted text)
- **Recent submissions** (if logged in): small list of user's past submissions for this problem with verdict badges

**Mobile:** Stacked vertically. Statement first, then submission form below.

---

## Screen 4: Contest List

**Purpose:** Browse upcoming, live, and past contests.

**Layout:**
- **Tab bar:** "Upcoming" | "Live" | "Past" (emerald underline on active tab)
- **Contest cards:** Each card shows:
  - Contest name (bold)
  - Date + time range (e.g., "Aug 15, 2026 . 14:00 - 17:00")
  - Status badge (Upcoming=sky, Live=emerald with pulse, Past=zinc)
  - Problem count (e.g., "5 problems")
  - Participant count (e.g., "32 registered")
  - "Register" / "Enter" / "View" button (context-dependent)
- **Empty state per tab:** "No upcoming contests" / "No live contests" / "No past contests"

---

## Screen 5: Contest View (Live Contest)

**Purpose:** During an active contest. Shows problems, submission area, leaderboard, timer.

**Layout:**
- **Top bar:** Contest name + countdown timer (monospace, emerald if >1hr, amber if <1hr, red if <10min) + "Leaderboard" toggle button
- **Problem tabs:** Horizontal tab strip with problem labels (A, B, C, D, E or problem names). Active tab has emerald underline.
- **Problem content:** Same as Problem Detail (statement + sample I/O + submission form)
- **Leaderboard panel:** Sidebar or collapsible panel showing live rankings:
  - Rank, Username, Solved count, Penalty
  - Highlight current user's row (emerald bg)
  - AC badges per problem (green checkmarks)
  - Updates in real-time (visual flash on rank change)

**Timer behavior:**
- > 1hr: emerald text, calm
- < 1hr: amber text, subtle pulse
- < 10min: red text, stronger pulse
- 0:00: "Contest ended" badge, submissions disabled

---

## Screen 6: Submission Status

**Purpose:** Live verdict display after submitting code. Appears as an overlay or inline expansion.

**Layout:**
- **Status indicator:** Large, centered
  - "Queued" (zinc, dot icon)
  - "Running" (sky, spinner icon, "Judging your submission...")
  - "Accepted" (emerald, checkmark icon, "All test cases passed")
  - "Wrong Answer" (red, X icon, "Failed on test case 3")
  - "Time Limit Exceeded" (amber, clock icon, "Exceeded time limit on test case 7")
  - "Memory Limit Exceeded" (amber, memory icon)
  - "Runtime Error" (red, alert icon)
  - "Compilation Error" (red, code icon, with error message)
- **Details:** Execution time (ms), memory used (MB), test cases passed / total
- **Action buttons:** "View Code" (ghost), "Submit Again" (ghost), "Back to Problem" (ghost)

**Animation:** Subtle scale-up transition on verdict change. No heavy motion.

---

## Screen 7: Leaderboard

**Purpose:** Live contest rankings. Standalone page or panel within contest view.

**Layout:**
- **Header:** Contest name + "Live" badge (pulsing emerald dot) + last updated timestamp
- **Table:**
  - Columns: Rank, User, Solved, Penalty, Per-problem verdicts (A, B, C, D, E)
  - Rank column: bold, monospace
  - User column: username + avatar (initials-based, emerald bg)
  - Solved: number, bold
  - Penalty: monospace, muted
  - Per-problem: green checkmark (AC) or red X (WA) or dash (not attempted), with attempt count
- **Current user row:** Highlighted with emerald-500/10 bg
- **Sticky header:** Table header sticks on scroll
- **Mobile:** Compact card layout instead of full table. Rank + username + solved/penalty per card.

**Real-time:** Rows animate into new positions on rank change. Subtle slide transition.

---

## Screen 8: Admin Dashboard

**Purpose:** Manage problems, contests, and users. Internal tool feel.

**Layout:**
- **Sidebar navigation:** Problems, Contests, Users, Settings
- **Content area:** Data table or card list depending on context
  - **Problems list:** Table with columns: ID, Title, Difficulty, Status (Draft/Published), Actions (Edit, Delete, Toggle visibility)
  - **Contests list:** Table with columns: Name, Date, Status (Draft/Live/Ended), Problems count, Actions
  - **Users list:** Table with columns: Username, Role (Contestant/Setter/Admin), Joined date, Submissions count
- **Create button:** Prominent emerald-500 button ("New Problem" / "New Contest")
- **Stats at top:** 4 metric cards in a row — Total Problems, Active Contests, Total Users, Submissions Today

**Style:** Functional. No decorative elements. Data density is acceptable here (VISUAL_DENSITY: 7).

---

## Screen 9: Auth (Login / Register)

**Purpose:** User authentication.

**Layout (centered card, max-w-sm):**
- **Logo/brand** at top: "KOJ" in bold
- **Tab switch:** "Sign In" | "Sign Up" (emerald underline on active)
- **Form fields:**
  - Email (or Username)
  - Password
  - Confirm Password (sign up only)
  - Role selector (contestant / problem setter) — sign up only
- **Submit button:** Full width, emerald-500
- **Divider:** "or" with horizontal lines
- **Social login:** "Continue with GitHub" button (if supported)
- **Footer text:** "By signing up, you agree to the contest rules."

**Style:** Clean, minimal. No decorative background. Dark card on dark bg with subtle border.

---

## Screen 10: User Profile / Submissions History

**Purpose:** View a user's submission history and stats.

**Layout:**
- **Profile header:** Username, role badge, join date, total submissions, problems solved
- **Stats cards:** 4 small cards — Total Submissions, Accepted Rate, Contests Participated, Current Rating (stretch)
- **Submissions table:**
  - Columns: Problem, Language, Verdict, Time, Memory, Submitted
  - Verdict column: colored badge (AC=emerald, WA=red, TLE=amber, etc.)
  - Problem column: clickable link to problem detail
  - Sortable by date, verdict
- **Filter:** Dropdown to filter by verdict, language, date range

---

## Notes for Stitch

- All screens should use the dark mode theme described above
- Use placeholder text for data (e.g., "Two Sum", "contest #3", "42 submissions")
- Verdict badges should use the color system: emerald=AC, red=WA/RE/CE, amber=TLE/MLE, sky=Running/Queued
- Code editor should show monospace placeholder code (a simple "Hello World" in C++)
- Leaderboard should show realistic data: 5-10 users with varying solve counts
- Mobile responsive: all screens should work at 375px width
- No images needed — this is a text/code-heavy product UI
