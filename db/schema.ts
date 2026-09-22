import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const contestStatus = pgEnum("contest_status", [
  "draft",
  "live",
  "ended",
  "archived",
]);

export const problemDifficulty = pgEnum("problem_difficulty", [
  "easy",
  "medium",
  "hard",
]);

export const problemStatus = pgEnum("problem_status", [
  "draft",
  "contest_active",
  "published",
]);

export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "running",
  "accepted",
  "wrong_answer",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "runtime_error",
  "compilation_error",
  "presentation_error",
]);

export const userRole = pgEnum("user_role", [
  "contestant",
  "problem_setter",
  "contest_setter",
  "admin",
]);

export const users = pgTable(
  "users",
  {
    clerkId: text("clerk_id").primaryKey(),
    username: text("username").notNull().unique(),
    email: text("email").notNull(),
    role: userRole("role").notNull().default("contestant"),
    suspended: boolean("suspended").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("users_role_idx").on(table.role)],
);

export const problems = pgTable("problems", {
  id: serial("id").primaryKey(),
  authorId: text("author_id")
    .notNull()
    .references(() => users.clerkId),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  inputFormat: text("input_format").notNull(),
  outputFormat: text("output_format").notNull(),
  constraints: text("constraints").notNull(),
  explanation: text("explanation"),
  difficulty: problemDifficulty("difficulty").notNull().default("easy"),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  timeLimitMs: integer("time_limit_ms").notNull().default(1000),
  memoryLimitMb: integer("memory_limit_mb").notNull().default(256),
  status: problemStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contests = pgTable("contests", {
  id: serial("id").primaryKey(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.clerkId),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: contestStatus("status").notNull().default("draft"),
  inviteCode: text("invite_code"),
  // Hashed invite code (scrypt, versioned `v1$salt$hash`). `invite_code`
  // is legacy plaintext kept read-only until migrated; never write to it.
  inviteCodeHash: text("invite_code_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const problemTestCases = pgTable(
  "problem_test_cases",
  {
    id: serial("id").primaryKey(),
    problemId: integer("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    input: text("input").notNull(),
    expectedOutput: text("expected_output").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    index("problem_test_cases_problem_position_idx").on(
      table.problemId,
      table.position,
    ),
  ],
);

export const contestProblems = pgTable(
  "contest_problems",
  {
    contestId: integer("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    problemId: integer("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.contestId, table.problemId] }),
    index("contest_problems_contest_position_idx").on(
      table.contestId,
      table.position,
    ),
  ],
);

export const contestRegistrations = pgTable(
  "contest_registrations",
  {
    contestId: integer("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.clerkId, { onDelete: "cascade" }),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.contestId, table.userId] }),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.clerkId),
    problemId: integer("problem_id")
      .notNull()
      .references(() => problems.id),
    contestId: integer("contest_id").references(() => contests.id),
    language: text("language").notNull(),
    code: text("code").notNull(),
    status: submissionStatus("status").notNull().default("pending"),
    // Internal infra flag: true means the row reflects judge
    // infrastructure failure (retryable), NOT contestant code.
    // Never a new contestant-facing enum value.
    judgeInfraError: boolean("judge_infra_error").notNull().default(false),
    executionTimeMs: integer("execution_time_ms"),
    memoryUsedMb: integer("memory_used_mb"),
    passedTests: integer("passed_tests"),
    totalTests: integer("total_tests"),
    errorMessage: text("error_message"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
  },
  (table) => [
    index("submissions_user_problem_time_idx").on(
      table.userId,
      table.problemId,
      table.submittedAt,
    ),
    index("submissions_contest_user_time_idx")
      .on(table.contestId, table.userId, table.submittedAt)
      .where(sql`contest_id IS NOT NULL`),
    index("submissions_status_pending_running_idx")
      .on(table.submittedAt)
      .where(sql`status IN ('pending', 'running')`),
    index("submissions_infra_error_idx")
      .on(table.submittedAt)
      .where(sql`judge_infra_error = true`),
  ],
);

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Problem = typeof problems.$inferSelect;
export type NewProblem = typeof problems.$inferInsert;

export type Contest = typeof contests.$inferSelect;
export type NewContest = typeof contests.$inferInsert;

export type ProblemTestCase = typeof problemTestCases.$inferSelect;
export type NewProblemTestCase = typeof problemTestCases.$inferInsert;

export type ContestProblem = typeof contestProblems.$inferSelect;
export type NewContestProblem = typeof contestProblems.$inferInsert;

export type ContestRegistration = typeof contestRegistrations.$inferSelect;
export type NewContestRegistration = typeof contestRegistrations.$inferInsert;

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
