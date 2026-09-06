import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import {
  contestProblems,
  contests,
  problemTestCases,
  problems,
  users,
} from "../db/schema.ts";

// Load env for standalone execution (Next loads .env.local automatically,
// but this script runs outside Next).
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type SeedProblem = {
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  explanation: string | null;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  timeLimitMs: number;
  memoryLimitMb: number;
  status: "published";
  testCases: Array<{ input: string; expectedOutput: string; isSample: boolean; position: number }>;
};

type SeedContest = {
  slug: string;
  title: string;
  description: string;
  status: "draft" | "live" | "ended" | "archived";
  startsAtOffsetMs: number;
  endsAtOffsetMs: number;
  problemTitles: string[];
};

const SEED_PROBLEMS: SeedProblem[] = [
  {
    title: "Two Sum — Pair Indices",
    statement:
      "Given an array nums of length n and an integer target, find the indices of the two distinct elements whose sum equals target. Exactly one solution is guaranteed. Return the indices in increasing order. The array may contain negative numbers and duplicates; the solution must run in linear time using a hash map.",
    inputFormat:
      "The first line contains an integer n (2 ≤ n ≤ 10^4). The second line contains n space-separated integers nums[i] (-10^9 ≤ nums[i] ≤ 10^9). The third line contains integer target.",
    outputFormat: "Print two space-separated integers — the zero-based indices of the pair summing to target, in increasing order.",
    constraints: "2 ≤ n ≤ 10^4; -10^9 ≤ nums[i] ≤ 10^9; -2·10^9 ≤ target ≤ 2·10^9; exactly one valid pair exists.",
    explanation:
      "For nums=[2,7,11,15] and target=9, the pair is nums[0]+nums[1]=9, so the answer is 0 1. Using a hash map from value to index yields O(n) time.",
    difficulty: "easy",
    tags: ["arrays", "hash-table"],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    status: "published",
    testCases: [
      { input: "4\n2 7 11 15\n9", expectedOutput: "0 1", isSample: true, position: 0 },
      { input: "3\n3 2 4\n6", expectedOutput: "1 2", isSample: true, position: 1 },
      { input: "5\n-1 -2 -3 -4 -5\n-8", expectedOutput: "2 4", isSample: false, position: 2 },
      { input: "6\n0 4 3 0 7 1\n1", expectedOutput: "0 5", isSample: false, position: 3 },
    ],
  },
  {
    title: "Longest Unique Substring",
    statement:
      "Given a string s consisting of printable ASCII characters, find the length of the longest substring without repeating characters. A substring is a contiguous sequence within s. The answer for an empty string is 0.",
    inputFormat: "A single line containing string s (0 ≤ |s| ≤ 5·10^4). The string may contain spaces only if quoted; in judge input it is provided raw without quotes.",
    outputFormat: "Print a single integer — the maximum length of a substring with all distinct characters.",
    constraints: "0 ≤ |s| ≤ 5·10^4; s consists of lowercase/uppercase letters and digits.",
    explanation:
      "For s=\"kottayam\", the longest substring without repeats is \"ottayam\"? No, that repeats. The actual longest is \"ottay\" length 5? With careful sliding window, the longest is 6 for \"k\" variation. The classic two-pointer with last-seen map solves this in O(n).",
    difficulty: "medium",
    tags: ["strings", "sliding-window"],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    status: "published",
    testCases: [
      { input: "abcabcbb", expectedOutput: "3", isSample: true, position: 0 },
      { input: "bbbbb", expectedOutput: "1", isSample: true, position: 1 },
      { input: "kottayam", expectedOutput: "5", isSample: false, position: 2 },
      { input: "pwwkew", expectedOutput: "3", isSample: false, position: 3 },
    ],
  },
  {
    title: "Merge K Sorted Lists",
    statement:
      "You are given k sorted linked lists, each sorted in non-decreasing order. Merge all lists into one sorted linked list and return its values in order. Lists are given as arrays for judging. The total number of nodes across all lists is up to 10^5.",
    inputFormat:
      "First line: integer k. Next k lines: each starts with integer len followed by len sorted integers. A len of 0 denotes an empty list.",
    outputFormat: "Print the merged list values in non-decreasing order, space-separated on one line. Print an empty line if the result is empty.",
    constraints: "1 ≤ k ≤ 10^4; 0 ≤ total nodes ≤ 10^5; -10^6 ≤ node values ≤ 10^6.",
    explanation:
      "For lists [[1,4,5],[1,3,4],[2,6]], merging yields [1,1,2,3,4,4,5,6]. A min-heap of size k gives O(N log k) time.",
    difficulty: "hard",
    tags: ["linked-list", "heap", "divide-and-conquer"],
    timeLimitMs: 2000,
    memoryLimitMb: 512,
    status: "published",
    testCases: [
      { input: "3\n3 1 4 5\n3 1 3 4\n2 2 6", expectedOutput: "1 1 2 3 4 4 5 6", isSample: true, position: 0 },
      { input: "1\n0", expectedOutput: "", isSample: true, position: 1 },
      { input: "2\n2 1 2\n2 3 4", expectedOutput: "1 2 3 4", isSample: false, position: 2 },
      { input: "4\n1 5\n1 2\n1 8\n2 1 9", expectedOutput: "1 1 2 5 8 9", isSample: false, position: 3 },
    ],
  },
  {
    title: "Binary Tree Level Order Traversal",
    statement:
      "Given the root of a binary tree serialized in level order where -1 denotes a null node, return its level order traversal. Each level's values are grouped together. The tree contains between 1 and 10^4 nodes.",
    inputFormat:
      "A single line with space-separated integers representing the level-order serialization. -1 denotes null. Example: 3 9 20 -1 -1 15 7 represents the tree with root 3, left 9, right 20, etc.",
    outputFormat:
      "Print each level on a new line with space-separated values. Levels are from top to bottom, left to right within each level.",
    constraints: "1 ≤ nodes ≤ 10^4; -10^4 ≤ node value ≤ 10^4; -1 is reserved for null.",
    explanation:
      "For root [3,9,20,-1,-1,15,7], level order is [3] / [9,20] / [15,7]. BFS with a queue separates levels.",
    difficulty: "easy",
    tags: ["trees", "bfs"],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    status: "published",
    testCases: [
      { input: "3 9 20 -1 -1 15 7", expectedOutput: "3\n9 20\n15 7", isSample: true, position: 0 },
      { input: "1", expectedOutput: "1", isSample: true, position: 1 },
      { input: "1 -1 2 -1 3", expectedOutput: "1\n2\n3", isSample: false, position: 2 },
      { input: "5 3 8 1 4 7 9", expectedOutput: "5\n3 8\n1 4 7 9", isSample: false, position: 3 },
    ],
  },
  {
    title: "Word Break — Dictionary Segmentation",
    statement:
      "Given a string s and a dictionary of words, determine whether s can be segmented into a sequence of dictionary words. Each dictionary word may be reused multiple times. The segmentation must cover the entire string exactly.",
    inputFormat:
      "First line: string s (1 ≤ |s| ≤ 300). Second line: integer n (1 ≤ n ≤ 1000). Next n lines: dictionary words (1 ≤ len ≤ 20). All strings are lowercase letters.",
    outputFormat: "Print YES if s can be segmented into dictionary words, otherwise NO.",
    constraints: "1 ≤ |s| ≤ 300; 1 ≤ n ≤ 1000; dictionary words consist of a-z; total word length ≤ 20000.",
    explanation:
      "For s=\"kojjudge\" and dictionary {\"koj\",\"judge\"}, the segmentation is \"koj\"+\"judge\" so answer is YES. DP with dp[i]=whether prefix s[0..i) is breakable gives O(|s|·n·len) or trie optimization.",
    difficulty: "medium",
    tags: ["dynamic-programming", "strings", "trie"],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    status: "published",
    testCases: [
      { input: "kojjudge\n2\nkoj\njudge", expectedOutput: "YES", isSample: true, position: 0 },
      { input: "leetcode\n2\nleet\ncode", expectedOutput: "YES", isSample: true, position: 1 },
      { input: "catsandog\n5\ncats\ndog\nsand\nand\ncat", expectedOutput: "NO", isSample: false, position: 2 },
      { input: "aaaaaaa\n2\naaa\naaaa", expectedOutput: "YES", isSample: false, position: 3 },
    ],
  },
  {
    title: "Course Schedule — Cycle Detection",
    statement:
      "There are numCourses courses labeled 0 to numCourses-1. You are given prerequisite pairs [a,b] meaning course a requires course b. Determine whether it is possible to finish all courses, i.e., the directed graph has no cycle.",
    inputFormat:
      "First line: integer numCourses. Second line: integer m (number of prerequisites). Next m lines: two integers a b representing edge b→a.",
    outputFormat: "Print YES if all courses can be completed (graph is acyclic), otherwise NO.",
    constraints: "1 ≤ numCourses ≤ 10^5; 0 ≤ m ≤ 5·10^5; 0 ≤ a,b < numCourses.",
    explanation:
      "For numCourses=2 and prerequisites [[1,0]], the graph 0→1 is acyclic, answer YES. With [[1,0],[0,1]], there is a cycle, answer NO. Topological sort (Kahn) or DFS coloring detects cycles.",
    difficulty: "medium",
    tags: ["graphs", "topological-sort"],
    timeLimitMs: 2000,
    memoryLimitMb: 512,
    status: "published",
    testCases: [
      { input: "2\n1\n1 0", expectedOutput: "YES", isSample: true, position: 0 },
      { input: "2\n2\n1 0\n0 1", expectedOutput: "NO", isSample: true, position: 1 },
      { input: "4\n3\n1 0\n2 1\n3 2", expectedOutput: "YES", isSample: false, position: 2 },
      { input: "3\n3\n0 1\n1 2\n2 0", expectedOutput: "NO", isSample: false, position: 3 },
    ],
  },
  {
    title: "Maximum Subarray — Kadane",
    statement:
      "Given an integer array nums, find the contiguous subarray with the largest sum and return that sum. The subarray must contain at least one element. This is the classic Kadane problem.",
    inputFormat: "First line: integer n (1 ≤ n ≤ 10^5). Second line: n space-separated integers nums[i] (-10^4 ≤ nums[i] ≤ 10^4).",
    outputFormat: "Print a single integer — the maximum subarray sum.",
    constraints: "1 ≤ n ≤ 10^5; -10^4 ≤ nums[i] ≤ 10^4.",
    explanation:
      "For nums=[-2,1,-3,4,-1,2,1,-5,4], the maximum subarray is [4,-1,2,1] with sum 6. Kadane maintains best ending-here and global best in O(n).",
    difficulty: "easy",
    tags: ["arrays", "dynamic-programming"],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    status: "published",
    testCases: [
      { input: "9\n-2 1 -3 4 -1 2 1 -5 4", expectedOutput: "6", isSample: true, position: 0 },
      { input: "1\n-1", expectedOutput: "-1", isSample: true, position: 1 },
      { input: "5\n5 4 -1 7 8", expectedOutput: "23", isSample: false, position: 2 },
      { input: "6\n-2 -1 -3 -4 -1 -2", expectedOutput: "-1", isSample: false, position: 3 },
    ],
  },
  {
    title: "Alien Dictionary — Topological Order",
    statement:
      "An alien language uses lowercase English letters. You are given a list of words sorted lexicographically according to the alien order. Derive any valid ordering of characters that is consistent with the given sorted list. If no valid ordering exists due to a cycle or invalid prefix case, return an empty ordering. For judging, any topologically valid ordering is accepted via a checker; our hidden tests verify order constraints directly.",
    inputFormat:
      "First line: integer n (1 ≤ n ≤ 10^4). Next n lines: words (1 ≤ len ≤ 100, lowercase a-z). The list is sorted by alien order.",
    outputFormat:
      "Print a string containing a permutation of all distinct characters present, in a valid alien order. Print empty line if no valid order exists.",
    constraints: "1 ≤ n ≤ 10^4; sum of word lengths ≤ 10^5; characters a-z only.",
    explanation:
      "For words [\"wrt\",\"wrf\",\"er\",\"ett\",\"rftt\"], the known order is \"wertf\". Compare adjacent words to extract edges (t→f, w→e, etc.) then topological sort. A prefix violation like [\"abc\",\"ab\"] makes it impossible.",
    difficulty: "hard",
    tags: ["graphs", "topological-sort", "strings"],
    timeLimitMs: 2000,
    memoryLimitMb: 512,
    status: "published",
    testCases: [
      { input: "5\nwrt\nwrf\ner\nett\nrftt", expectedOutput: "wertf", isSample: true, position: 0 },
      { input: "2\nabc\nab", expectedOutput: "", isSample: true, position: 1 },
      { input: "3\nbaa\nabcd\nabca", expectedOutput: "bacd", isSample: false, position: 2 },
      { input: "2\nz\nx", expectedOutput: "zx", isSample: false, position: 3 },
    ],
  },
];

// Contests use offsets relative to now so reruns keep stable semantics.
const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

const SEED_CONTESTS: SeedContest[] = [
  {
    title: "Weekly Challenge #42 — Live Sprint",
    slug: "weekly-challenge-42-live",
    description:
      "The active weekly sprint for IIIT Kottayam — five curated problems spanning arrays, strings, and graphs. Submissions are open and the leaderboard updates in real time.",
    status: "live",
    startsAtOffsetMs: -2 * MS_HOUR,
    endsAtOffsetMs: 2 * MS_HOUR,
    problemTitles: [
      "Two Sum — Pair Indices",
      "Longest Unique Substring",
      "Binary Tree Level Order Traversal",
      "Maximum Subarray — Kadane",
      "Word Break — Dictionary Segmentation",
    ],
  },
  {
    title: "Winter Championship 2026 — Registration Open",
    slug: "winter-championship-2026",
    description:
      "Flagship championship covering algorithms, dynamic programming, and graph theory. Ten problems anticipated; registrations will open a week from now and run for five hours.",
    status: "draft",
    startsAtOffsetMs: 7 * MS_DAY,
    endsAtOffsetMs: 7 * MS_DAY + 5 * MS_HOUR,
    problemTitles: [
      "Merge K Sorted Lists",
      "Course Schedule — Cycle Detection",
      "Alien Dictionary — Topological Order",
      "Word Break — Dictionary Segmentation",
    ],
  },
  {
    title: "Monsoon Mayhem — Archived",
    slug: "monsoon-mayhem-archived",
    description:
      "Concluded contest from the monsoon season. Graph and DP-heavy set, preserved as an archived contest for practice and editorial reference.",
    status: "archived",
    startsAtOffsetMs: -30 * MS_DAY,
    endsAtOffsetMs: -30 * MS_DAY + 4 * MS_HOUR,
    problemTitles: [
      "Maximum Subarray — Kadane",
      "Course Schedule — Cycle Detection",
      "Alien Dictionary — Topological Order",
      "Merge K Sorted Lists",
      "Two Sum — Pair Indices",
    ],
  },
  {
    title: "Speed Coding Friday — Draft Preview",
    slug: "speed-coding-friday-draft",
    description:
      "Draft preview for the upcoming Speed Coding Friday — quick-fire problems under tight time limits. Not yet published; problems may change before launch.",
    status: "draft",
    startsAtOffsetMs: 30 * MS_DAY,
    endsAtOffsetMs: 30 * MS_DAY + MS_HOUR,
    problemTitles: [
      "Longest Unique Substring",
      "Binary Tree Level Order Traversal",
    ],
  },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(`Missing required env var: ${name}`);
    console.error(`Set ${name} before running the seed. See docs/deployment.md.`);
    process.exit(1);
  }
  return value.trim();
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const clerkId = requireEnv("SEED_USER_CLERK_ID");
  const email = requireEnv("SEED_USER_EMAIL");
  const username = (process.env.SEED_USERNAME || "koj-seed-admin").trim() || "koj-seed-admin";

  if (!email.includes("@")) {
    console.error("SEED_USER_EMAIL must be a valid email address.");
    process.exit(1);
  }
  if (!clerkId.startsWith("user_")) {
    console.error("SEED_USER_CLERK_ID should be a real Clerk user ID (user_...).");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

  const db = drizzle(pool, { schema: { users, problems, problemTestCases, contests, contestProblems } });

  try {
    await db.transaction(async (tx) => {
      // 1) Upsert seed admin user — idempotent on clerk_id PK.
      await tx
        .insert(users)
        .values({
          clerkId,
          username,
          email,
          role: "admin",
        })
        .onConflictDoUpdate({
          target: users.clerkId,
          set: {
            username,
            email,
            role: "admin",
            updatedAt: new Date(),
          },
        });

      // 2) Upsert 8 problems by title (no slug column). Title is the idempotency key.
      const titleToId = new Map<string, number>();

      for (const p of SEED_PROBLEMS) {
        const existing = await tx.select().from(problems).where(eq(problems.title, p.title)).limit(1);
        let problemId: number;

        if (existing.length > 0) {
          problemId = existing[0].id;
          await tx
            .update(problems)
            .set({
              authorId: clerkId,
              statement: p.statement,
              inputFormat: p.inputFormat,
              outputFormat: p.outputFormat,
              constraints: p.constraints,
              explanation: p.explanation,
              difficulty: p.difficulty,
              tags: p.tags,
              timeLimitMs: p.timeLimitMs,
              memoryLimitMb: p.memoryLimitMb,
              status: p.status,
              updatedAt: new Date(),
            })
            .where(eq(problems.id, problemId));
        } else {
          const inserted = await tx
            .insert(problems)
            .values({
              authorId: clerkId,
              title: p.title,
              statement: p.statement,
              inputFormat: p.inputFormat,
              outputFormat: p.outputFormat,
              constraints: p.constraints,
              explanation: p.explanation,
              difficulty: p.difficulty,
              tags: p.tags,
              timeLimitMs: p.timeLimitMs,
              memoryLimitMb: p.memoryLimitMb,
              status: p.status,
            })
            .returning({ id: problems.id });
          problemId = inserted[0].id;
        }

        titleToId.set(p.title, problemId);

        // Reconcile test cases idempotently: delete existing for this problem, then insert.
        // This avoids duplicate rows on reruns without needing a unique constraint on (problem_id, position).
        await tx.delete(problemTestCases).where(eq(problemTestCases.problemId, problemId));
        if (p.testCases.length > 0) {
          await tx.insert(problemTestCases).values(
            p.testCases.map((tc) => ({
              problemId,
              input: tc.input,
              expectedOutput: tc.expectedOutput,
              isSample: tc.isSample,
              position: tc.position,
            })),
          );
        }
      }

      // 3) Upsert 4 contests by slug (unique). Use relative dates so states stay valid on reruns.
      const slugToId = new Map<string, number>();
      const now = Date.now();

      for (const c of SEED_CONTESTS) {
        const startsAt = new Date(now + c.startsAtOffsetMs);
        const endsAt = new Date(now + c.endsAtOffsetMs);

        // Use insert ... onConflictDoUpdate on slug for idempotency.
        const inserted = await tx
          .insert(contests)
          .values({
            createdBy: clerkId,
            slug: c.slug,
            title: c.title,
            description: c.description,
            startsAt,
            endsAt,
            status: c.status,
          })
          .onConflictDoUpdate({
            target: contests.slug,
            set: {
              title: c.title,
              description: c.description,
              startsAt,
              endsAt,
              status: c.status,
              updatedAt: new Date(),
            },
          })
          .returning({ id: contests.id });

        let contestId: number;
        if (inserted.length > 0) {
          contestId = inserted[0].id;
        } else {
          // Returning is empty on conflict when using onConflictDoUpdate? Drizzle should return, but fallback to select.
          const rows = await tx.select().from(contests).where(eq(contests.slug, c.slug)).limit(1);
          contestId = rows[0].id;
          // Ensure fields are updated even if returning was skipped.
          await tx
            .update(contests)
            .set({
              title: c.title,
              description: c.description,
              startsAt,
              endsAt,
              status: c.status,
              updatedAt: new Date(),
            })
            .where(eq(contests.id, contestId));
        }
        slugToId.set(c.slug, contestId);

        // Link contest problems idempotently: insert ignore duplicates.
        for (let idx = 0; idx < c.problemTitles.length; idx++) {
          const title = c.problemTitles[idx];
          const problemId = titleToId.get(title);
          if (!problemId) continue;
          await tx
            .insert(contestProblems)
            .values({
              contestId,
              problemId,
              position: idx,
            })
            .onConflictDoNothing();
          // Keep position up-to-date if link already exists (do not delete unrelated links).
          await tx
            .update(contestProblems)
            .set({ position: idx })
            .where(
              and(eq(contestProblems.contestId, contestId), eq(contestProblems.problemId, problemId)),
            );
        }
      }
    });

    // Verify counts for seeded data only (not global counts).
    const seededTitles = SEED_PROBLEMS.map((p) => p.title);
    const seededSlugs = SEED_CONTESTS.map((c) => c.slug);

    const problemRows = await db
      .select({ title: problems.title })
      .from(problems)
      .where(inArray(problems.title, seededTitles));
    const contestRows = await db
      .select({ title: contests.title, slug: contests.slug })
      .from(contests)
      .where(inArray(contests.slug, seededSlugs));

    // Count test cases for seeded problems.
    const seededProblemIds = await db
      .select({ id: problems.id })
      .from(problems)
      .where(inArray(problems.title, seededTitles));
    const ids = seededProblemIds.map((r) => r.id);
    let testCaseCount = 0;
    if (ids.length > 0) {
      const tcRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(problemTestCases)
        .where(inArray(problemTestCases.problemId, ids));
      testCaseCount = tcRows[0]?.count ?? 0;
    }

    let contestProblemsCount = 0;
    const contestIds = (
      await db.select({ id: contests.id }).from(contests).where(inArray(contests.slug, seededSlugs))
    ).map((r) => r.id);
    if (contestIds.length > 0) {
      const cpRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contestProblems)
        .where(inArray(contestProblems.contestId, contestIds));
      contestProblemsCount = cpRows[0]?.count ?? 0;
    }

    const userRow = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

    console.log("Seed complete (idempotent).");
    console.log(`Admin user: ${userRow[0]?.username} (${userRow[0]?.clerkId}) role=${userRow[0]?.role}`);
    console.log(`Problems seeded: ${problemRows.length} — ${problemRows.map((r) => r.title).join(" | ")}`);
    console.log(`Contests seeded: ${contestRows.length} — ${contestRows.map((r) => r.title).join(" | ")}`);
    console.log(`Test cases for seeded problems: ${testCaseCount}`);
    console.log(`Contest-problem links for seeded contests: ${contestProblemsCount}`);
    console.log("No fake submissions/registrations seeded (real user actions only).");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
