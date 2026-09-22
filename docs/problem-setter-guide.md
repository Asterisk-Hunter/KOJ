# Problem Setter Guide

This guide covers how to create, test, and manage competitive programming problems on KOJ (Kottayam Online Judge).

---

## 1. Accessing the Admin Panel

Problem management is handled through the KOJ management portal at `/admin`.

### Permissions and Roles
To access the management portal, your account must have one of the following roles:
- **`problem_setter`**: Can create new problems, edit and manage authored problems, and configure test cases.
- **`admin`**: Full administrative access across problems, contests, user roles, and all submissions.

Role assignment is managed either via Clerk organization roles (`org:admin`) or in the Neon database (`users.role = 'problem_setter'` or `'admin'`). If you do not have permission, navigating to `/admin` will display a `403 · not authorized` notice.

When logged in as a `problem_setter`, the header displays **Problem Setter Dashboard** and shows the problem creation and management workspace.

---

## 2. Problem Creation Workflow

Problems are created via the **Create Problem** form in `/admin` (or via `POST /api/admin/problems`).

### Problem Fields

| Field | Required | Limits / Format | Description |
|---|---|---|---|
| **Title** | Yes | Max 500 chars | Clean, descriptive name of the problem (e.g., *Inversion Counter*). |
| **Statement** | Yes | Markdown text | Full problem narrative, background, and requirements. Markdown formatting is supported (code blocks, equations, lists). |
| **Input Format** | Yes | Plain text | Precise specification of standard input (`stdin`), including lines, types, and sequence. |
| **Output Format** | Yes | Plain text | Exact specification of standard output (`stdout`), including line breaks and precision. |
| **Constraints** | Yes | Plain text | Bounds for all input variables (e.g., $1 \le N \le 10^5$, $0 \le A_i \le 10^9$). |
| **Explanation** | Optional | Markdown text | Step-by-step walkthrough of sample test cases or editorial notes. |
| **Difficulty** | Yes | `easy`, `medium`, or `hard` | Categorization used for archive filters and tags. |
| **Tags** | Optional | Comma-separated | Topic categories (e.g., `arrays, dp, two-pointers, math`). |
| **Time Limit** | Yes | Integer: 100 to 10,000 ms | Maximum CPU execution time per test case (default: `2000` ms / 2s per SRS). |
| **Memory Limit** | Yes | Integer: 16 to 2,048 MB | Maximum RAM allocation per test case (default: `256` MB). |

Newly created problems default to the `draft` state and are assigned an incremental problem ID (e.g., `#009`).

---

## 3. Uploading and Managing Test Cases

Test cases define the ground truth for judging. They are managed in `/admin` under each problem's **TESTS** or **EDIT** drawer.

### Test Case Specifications
- **Input (`stdin`)**: The exact input stream supplied to the candidate solution.
- **Expected Output (`stdout`)**: The exact output the solution must produce.
- **File Size Limit**: Up to **10 MB** per test case input or expected output (`REQ-PROB-03`).
- **Capacity**: Maximum **100 test cases** per problem.

### Sample vs. Hidden Test Cases

| Type | `isSample` Flag | Visibility | Usage |
|---|---|---|---|
| **Sample Test Case** | `true` | Public on problem page | Visible to contestants; executed when contestant clicks **RUN SAMPLE**. |
| **Hidden Test Case** | `false` | Private to setters / admins | Evaluated only when contestant clicks **SUBMIT**. |

### Ordering and Positions
Each testcase has an integer `position` (0-indexed or 1-indexed sequence). Test cases execute sequentially in ascending order of position during judging.

### Operations Available
- **Add Test Case**: Specify input, expected output, toggle `sample`, and set position.
- **Toggle Sample**: Switch a case between `sample` and `hidden` with a single click.
- **Edit Test Case**: Modify input, output, or position.
- **Delete Test Case**: Remove unwanted or invalid cases.

---

## 4. Problem Lifecycle & States

Problems progress through three discrete states in the database:

```
┌─────────┐      Publish       ┌───────────┐
│  draft  │ ─────────────────> │ published │
│         │ <───────────────── │ (Archive) │
└─────────┘     Unpublish      └───────────┘
     │                               ▲
     │ Add to Contest                │ Contest Ends
     ▼                               │
┌────────────────┐                   │
│ contest_active │ ──────────────────┘
│ (Contest-Only) │
└────────────────┘
```

### State Definitions

1. **`draft`**:
   - Initial status upon creation.
   - Invisible to contestants.
   - Authoring setters and admins can freely modify details, limits, and test cases.
   - Can be published directly to the public archive or added to a **draft** contest.

2. **`contest_active`**:
   - The problem is attached to a contest.
   - Visible to registered participants only when the contest is active in the arena.
   - **Locking rule (`BR-08`)**: When the linked contest is in `live` status, the problem and its test cases are strictly **locked**. Any attempt to edit or delete the problem or its test cases returns `403 Forbidden`.
   - Transitions into and out of `contest_active` are owned by the contest lifecycle — setters cannot set this status directly.

3. **`published`**:
   - The problem is listed in the public Problem Archive (`/problems`).
   - Any authenticated user can practice and submit solutions.
   - Can be toggled back to `draft` (Unpublish) if revisions are required.

### Adding Problems to Contests (BR-04)

Only **draft** problems can be added to a contest. The contest itself must also be in `draft` status. This is enforced by `POST /api/admin/contests/[id]/problems`.

When a contest is **published** (status set to `live`):
- All linked draft problems transition to `contest_active` (handled automatically by the contest lifecycle in `app/api/contests/lifecycle.ts`).

When a contest **ends**:
- All linked `contest_active` problems transition to `published` and appear in the public archive.

When a contest is **unpublished** (reverted from `live` back to `draft` before it starts):
- Linked `contest_active` problems return to `draft`.

You cannot add a problem to a contest that is already `live` or `ended`.

### Deletion Rules
Only admins can delete problems (`DELETE /api/admin/problems/[id]`). Problems linked to any contest or containing submitted code cannot be deleted to protect contest standings and audit history.

---

## 5. Best Practices for Problem Setters

### Statement Clarity
- **Specify types and formats clearly**: Explicitly state whether graphs are 0-indexed or 1-indexed, whether strings contain uppercase/lowercase characters, and whether arrays may contain duplicates.
- **Provide clear examples**: Include at least two sample test cases — one simple base case and one non-trivial case. Explain the logic in the **Explanation** section.
- **Avoid ambiguous output requirements**: Specify rounding rules (e.g., *"print to 6 decimal places"*), case sensitivity (e.g., *"YES or NO"*), and newline expectations.

### Comprehensive Test Suite
- **Boundary Cases**: Test smallest allowed input ($N = 0$ or $1$) and largest allowed input ($N = 10^5$).
- **Special Values**: Test zeros, negative numbers, large numbers that may cause 32-bit integer overflow (test 64-bit `long long` / `int64`), and duplicate inputs.
- **Algorithmic Stress**:
  - Include tests that enforce the intended time complexity (e.g., ensure $O(N^2)$ solutions get `time_limit_exceeded` while $O(N \log N)$ passes).
  - Include worst-case topologies for graph/tree algorithms (e.g., star graphs, deep linear chains).

### Setting Limits
- **Time Limits**: Standard is **2,000 ms** (2.0 seconds, per SRS REQ-JUDGE-16). Ensure compiled languages (C, C++) have enough headroom, while interpreted languages (Python) have a viable, optimized path to pass.
- **Memory Limits**: Standard is **256 MB**. Accommodates standard library allocations, Java Virtual Machine overhead, and Python runtime structures.
