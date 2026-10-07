import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const contestStatus = pgEnum("contest_status", [
  "draft",
  "live",
  "ended",
  "archived",
]);

export const scoreboardFreezeMode = pgEnum("scoreboard_freeze_mode", [
  "automatic",
  "frozen",
  "unfrozen",
]);

export const clarificationVisibility = pgEnum("clarification_visibility", [
  "private",
  "public",
]);

export const submissionParticipation = pgEnum("submission_participation", ["official", "virtual"]);

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

export const submissionMode = pgEnum("submission_mode", ["run", "submit"]);

export const judgeJobStatus = pgEnum("judge_job_status", [
  "queued",
  "leased",
  "completed",
  "dead",
]);

export const userRole = pgEnum("user_role", [
  "contestant",
  "setter",
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

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.clerkId, { onDelete: "cascade" }),
    role: userRole("role").notNull().default("contestant"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("organization_memberships_user_idx").on(table.userId),
  ],
);

export const problems = pgTable("problems", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
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
  outputComparator: text("output_comparator").notNull().default("exact"),
  absoluteTolerance: doublePrecision("absolute_tolerance").notNull().default(0.000001),
  relativeTolerance: doublePrecision("relative_tolerance").notNull().default(0.000001),
  checkerCode: text("checker_code"),
  status: problemStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("problems_id_organization_id_unique").on(table.id, table.organizationId),
  check("problems_output_comparator_check", sql`${table.outputComparator} IN ('exact', 'float')`),
  check("problems_absolute_tolerance_check", sql`${table.absoluteTolerance} BETWEEN 0 AND 1`),
  check("problems_relative_tolerance_check", sql`${table.relativeTolerance} BETWEEN 0 AND 1`),
  check("problems_checker_code_size_check", sql`${table.checkerCode} IS NULL OR octet_length(${table.checkerCode}) <= 65536`),
]);

export const contests = pgTable("contests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(1)
    .references(() => organizations.id),
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
  // Hashed invite code (scrypt, `scrypt$salt$key`). `invite_code`
  // is legacy plaintext kept read-only until migrated; never write to it.
  inviteCodeHash: text("invite_code_hash"),
    scoreboardFreezeMode: scoreboardFreezeMode("scoreboard_freeze_mode").notNull().default("automatic"),
    scoreboardFrozenAt: timestamp("scoreboard_frozen_at", { withTimezone: true }),
    scoreboardRevealCount: integer("scoreboard_reveal_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("contests_id_organization_id_unique").on(table.id, table.organizationId),
  check("contests_scoreboard_reveal_count_check", sql`${table.scoreboardRevealCount} >= 0`),
  check("contests_scoreboard_freeze_state_check", sql`(${table.scoreboardFreezeMode} = 'frozen' AND ${table.scoreboardFrozenAt} IS NOT NULL) OR (${table.scoreboardFreezeMode} <> 'frozen' AND ${table.scoreboardFrozenAt} IS NULL)`),
]);

export const contestAnnouncements = pgTable("contest_announcements", {
  id: serial("id").primaryKey(),
  contestId: integer("contest_id").notNull().references(() => contests.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => users.clerkId),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("contest_announcements_order_idx").on(table.contestId, table.createdAt)]);

export const contestClarifications = pgTable("contest_clarifications", {
  id: serial("id").primaryKey(),
  contestId: integer("contest_id").notNull().references(() => contests.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => users.clerkId),
  question: text("question").notNull(),
  answer: text("answer"),
  visibility: clarificationVisibility("visibility").notNull().default("private"),
  answeredBy: text("answered_by").references(() => users.clerkId),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
}, (table) => [
  index("contest_clarifications_order_idx").on(table.contestId, table.createdAt),
  check("contest_clarifications_public_answer_check", sql`${table.visibility} = 'private' OR ${table.answer} IS NOT NULL`),
]);

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
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
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
    foreignKey({
      columns: [table.contestId, table.organizationId],
      foreignColumns: [contests.id, contests.organizationId],
      name: "contest_problems_contest_organization_fk",
    }),
    foreignKey({
      columns: [table.problemId, table.organizationId],
      foreignColumns: [problems.id, problems.organizationId],
      name: "contest_problems_problem_organization_fk",
    }),
    index("contest_problems_contest_position_idx").on(
      table.contestId,
      table.position,
    ),
  ],
);

export const contestTeams = pgTable("contest_teams", {
  id: serial("id").primaryKey(),
  contestId: integer("contest_id").notNull().references(() => contests.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  joinCodeHash: text("join_code_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("contest_teams_contest_idx").on(table.contestId)]);

export const contestRegistrations = pgTable(
  "contest_registrations",
  {
    contestId: integer("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.clerkId, { onDelete: "cascade" }),
    teamId: integer("team_id").references(() => contestTeams.id, { onDelete: "set null" }),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.contestId, table.userId] }),
  ],
);

export const contestVirtualRegistrations = pgTable("contest_virtual_registrations", {
  contestId: integer("contest_id").notNull().references(() => contests.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.clerkId, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.contestId, table.userId] })]);

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .default(1)
    .references(() => organizations.id),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("admin_audit_logs_created_at_idx").on(table.createdAt),
  index("admin_audit_logs_organization_created_at_idx").on(table.organizationId, table.createdAt),
]);

export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(1)
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.clerkId),
    problemId: integer("problem_id")
      .notNull()
      .references(() => problems.id),
    contestId: integer("contest_id").references(() => contests.id),
    teamId: integer("team_id").references(() => contestTeams.id, { onDelete: "set null" }),
    participation: submissionParticipation("participation").notNull().default("official"),
    language: text("language").notNull(),
    code: text("code").notNull(),
    mode: submissionMode("mode").notNull().default("submit"),
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
    caseResults: jsonb("case_results"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.problemId, table.organizationId],
      foreignColumns: [problems.id, problems.organizationId],
      name: "submissions_problem_organization_fk",
    }),
    foreignKey({
      columns: [table.contestId, table.organizationId],
      foreignColumns: [contests.id, contests.organizationId],
      name: "submissions_contest_organization_fk",
    }),
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

export const judgeJobs = pgTable(
  "judge_jobs",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id")
      .notNull()
      .unique()
      .references(() => submissions.id, { onDelete: "cascade" }),
    status: judgeJobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leasedBy: text("leased_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("judge_jobs_claim_idx")
      .on(table.availableAt, table.createdAt)
      .where(sql`status = 'queued'`),
    index("judge_jobs_expired_lease_idx")
      .on(table.leaseExpiresAt)
      .where(sql`status = 'leased'`),
  ],
);

export const judgeWorkers = pgTable("judge_workers", {
  id: text("id").primaryKey(),
  hostname: text("hostname").notNull(),
  status: text("status").notNull().default("idle"),
  activeJobId: integer("active_job_id").references(() => judgeJobs.id, {
    onDelete: "set null",
  }),
  lastJobId: integer("last_job_id"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
});

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiRateLimits = pgTable(
  "api_rate_limits",
  {
    key: text("key").primaryKey(),
    hits: integer("hits").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("api_rate_limits_hits_check", sql`${table.hits} >= 1`),
    index("api_rate_limits_expires_at_idx").on(table.expiresAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMembership = typeof organizationMemberships.$inferSelect;
export type NewOrganizationMembership = typeof organizationMemberships.$inferInsert;

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

export type ContestTeam = typeof contestTeams.$inferSelect;
export type NewContestTeam = typeof contestTeams.$inferInsert;

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
