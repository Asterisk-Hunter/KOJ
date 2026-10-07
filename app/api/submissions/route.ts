import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contestProblems,
  contestRegistrations,
  contestVirtualRegistrations,
  contests,
  judgeJobs,
  problemTestCases,
  problems,
  submissions,
  users,
} from "@/db/schema";
import { settleExpiredContests } from "@/app/api/contests/lifecycle";
import { isVirtualAttemptActive } from "@/app/api/contests/participation-policy";
import { readBoundedJsonObject, MAX_SUBMISSION_BODY_BYTES } from "@/app/api/body-guard";
import { resolveOrganizationContext } from "@/lib/organizations";
import { getQueueAdmissionDenial } from "@/app/api/submissions/queue-admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubmitMode = "run" | "submit";

interface PostBody {
  problemId: number;
  contestId?: number | null;
  language: string;
  code: string;
  mode: SubmitMode;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Thrown inside the submit transaction when the 30s cooldown is still active. */
class RateLimited {
  readonly retryAfter: number;
  constructor(retryAfter: number) { this.retryAfter = retryAfter; }
}

class VirtualParticipationExpired {}
class SubmissionAccessExpired {}

class QueueAdmissionLimited {
  readonly scope: "global" | "organization" | "user";
  readonly status: 429 | 503;
  readonly retryAfter: number;
  constructor(scope: "global" | "organization" | "user", status: 429 | 503, retryAfter: number) {
    this.scope = scope;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function handlePOST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);

  // Bounded body: 413 before parsing when the payload exceeds the cap
  // (code limit is 100KB; the cap leaves room for JSON overhead).
  const parsed = await readBoundedJsonObject(req, MAX_SUBMISSION_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const b = parsed.value as Partial<PostBody>;

  const problemId = b.problemId;
  const contestId = b.contestId ?? null;
  const language = b.language;
  const code = b.code;
  const mode = b.mode;

  // Validate problemId
  if (typeof problemId !== "number" || !Number.isInteger(problemId) || problemId <= 0) {
    return jsonError("problemId must be a positive integer", 400);
  }
  // Validate contestId
  if (contestId !== null && contestId !== undefined) {
    if (typeof contestId !== "number" || !Number.isInteger(contestId) || contestId <= 0) {
      return jsonError("contestId must be a positive integer or null", 400);
    }
  }
  // Validate language (SRS REQ-JUDGE-02 v1 set + TBD-03 additions)
  const SUPPORTED_LANGUAGES = [
    "python",
    "c",
    "c++",
    "java",
    "go",
    "rust",
    "javascript",
  ] as const;
  if (
    typeof language !== "string" ||
    !(SUPPORTED_LANGUAGES as readonly string[]).includes(language)
  ) {
    return jsonError(
      `supported languages: ${SUPPORTED_LANGUAGES.join(", ")}`,
      400,
    );
  }
  // Validate code
  if (typeof code !== "string" || code.trim().length === 0) {
    return jsonError("code must be non-empty", 400);
  }
  // 100KB limit — use byte length
  const codeBytes = Buffer.byteLength(code, "utf8");
  if (codeBytes > 100 * 1024) {
    return jsonError("code exceeds 100KB limit", 400);
  }
  // Validate mode
  if (mode !== "run" && mode !== "submit") {
    return jsonError("mode must be 'run' or 'submit'", 400);
  }

  const effectiveContestId: number | null = contestId ?? null;
  let participation: "official" | "virtual" = "official";
  let teamId: number | null = null;
  let virtualEndsAt: Date | null = null;

  // Settle past-due live contests before enforcing contest windows.
  await settleExpiredContests(organization.organizationId);

  // Load problem
  const problemRows = await db
    .select()
    .from(problems)
    .where(and(eq(problems.id, problemId), eq(problems.organizationId, organization.organizationId)))
    .limit(1);
  if (problemRows.length === 0) {
    return jsonError("problem not found", 404);
  }
  const problem = problemRows[0];
  if (problem.status === "draft") return jsonError("problem not found", 404);

  // Contest vs practice validation
  if (effectiveContestId !== null) {
    const contestRows = await db
      .select()
      .from(contests)
      .where(and(eq(contests.id, effectiveContestId), eq(contests.organizationId, organization.organizationId)))
      .limit(1);
    if (contestRows.length === 0) {
      return jsonError("contest not found", 403);
    }
    const contest = contestRows[0];
    if (contest.status === "live" && Date.now() >= contest.startsAt.getTime() && Date.now() < contest.endsAt.getTime()) {
      const regRows = await db.select({ teamId: contestRegistrations.teamId }).from(contestRegistrations)
        .where(and(eq(contestRegistrations.contestId, effectiveContestId), eq(contestRegistrations.userId, userId))).limit(1);
      if (regRows.length === 0) return jsonError("not registered for contest", 403);
      teamId = regRows[0].teamId;
    } else if (contest.status === "ended" || contest.status === "archived") {
      const virtualRows = await db.select({ endsAt: contestVirtualRegistrations.endsAt }).from(contestVirtualRegistrations)
        .where(and(eq(contestVirtualRegistrations.contestId, effectiveContestId), eq(contestVirtualRegistrations.userId, userId))).limit(1);
      if (virtualRows.length === 0 || !isVirtualAttemptActive(new Date(), virtualRows[0].endsAt)) return jsonError("active virtual participation required", 403);
      virtualEndsAt = virtualRows[0].endsAt;
      participation = "virtual";
    } else {
      return jsonError("contest is not accepting submissions", 403);
    }
    const cpRows = await db
      .select()
      .from(contestProblems)
      .where(
        and(
          eq(contestProblems.contestId, effectiveContestId),
          eq(contestProblems.problemId, problemId),
        ),
      )
      .limit(1);
    if (cpRows.length === 0) {
      return jsonError("problem not in contest", 400);
    }
  } else {
    if (problem.status !== "published") {
      return jsonError("problem not available for practice", 403);
    }
  }

  // Ensure users row
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (existingUser.length === 0) {
    try {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const primaryEmail =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ??
        clerkUser.emailAddresses[0]?.emailAddress ??
        "";
      const username =
        clerkUser.username ??
        clerkUser.firstName ??
        (primaryEmail ? primaryEmail.split("@")[0] : userId);
      const email = primaryEmail || `${userId}@placeholder.local`;
      if (!username || !email) {
        return jsonError("failed to resolve user", 500);
      }
      await db.insert(users).values({
        clerkId: userId,
        username,
        email,
      }).onConflictDoNothing({ target: users.clerkId });
    } catch {
      return jsonError("failed to resolve user", 500);
    }
  }

  // Suspended users cannot submit (run or submit mode).
  const suspensionRows = await db
    .select({ suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (suspensionRows.length > 0 && suspensionRows[0].suspended) {
    return jsonError("account suspended", 403);
  }

  // The worker loads test data; admission only needs to know cases exist.
  const caseRows = await db.select({ id: problemTestCases.id }).from(problemTestCases)
    .where(mode === "run"
      ? and(eq(problemTestCases.problemId, problemId), eq(problemTestCases.isSample, true))
      : eq(problemTestCases.problemId, problemId))
    .limit(1);
  if (caseRows.length === 0) {
    return jsonError(mode === "run" ? "no sample cases" : "no test cases", 400);
  }

  // Rate limit (REQ-RATE-01/02) + pending insert, atomically: the cooldown
  // check and the insert run in one transaction serialized by an advisory
  // lock, so concurrent double-submits cannot both pass the check. This is
  // the single insert path for this route. Applies to run and submit modes.
  let submissionId: number;
  if (virtualEndsAt !== null && !isVirtualAttemptActive(new Date(), virtualEndsAt)) {
    return jsonError("virtual participation time expired", 403);
  }
  try {
    submissionId = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('koj:queue-admission'), 0)`);
      const [activeCounts] = await tx
        .select({
          globalActive: sql<number>`count(*)`.mapWith(Number),
          organizationActive: sql<number>`count(*) FILTER (WHERE ${eq(submissions.organizationId, organization.organizationId)})`.mapWith(Number),
          userActive: sql<number>`count(*) FILTER (WHERE ${eq(submissions.userId, userId)})`.mapWith(Number),
        })
        .from(judgeJobs)
        .innerJoin(submissions, eq(judgeJobs.submissionId, submissions.id))
        .where(inArray(judgeJobs.status, ["queued", "leased"]));
      const denial = getQueueAdmissionDenial(activeCounts, 1);
      if (denial) throw new QueueAdmissionLimited(denial.scope, denial.status, denial.retryAfter);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}), ${problemId})`);
      const recentRows = await tx
        .select({ submittedAt: submissions.submittedAt })
        .from(submissions)
        .where(and(eq(submissions.userId, userId), eq(submissions.problemId, problemId)))
        .orderBy(desc(submissions.submittedAt))
        .limit(1);
      if (recentRows.length > 0 && recentRows[0].submittedAt) {
        const elapsedSec = (Date.now() - recentRows[0].submittedAt.getTime()) / 1000;
        if (elapsedSec < 30) {
          throw new RateLimited(Math.max(1, Math.ceil(30 - elapsedSec)));
        }
      }
      // Re-read access after waiting for admission/cooldown locks. Hold a share
      // lock so lifecycle/authoring changes cannot race the pending insert.
      let officialWindow: { startsAt: Date; endsAt: Date } | null = null;
      // Match lifecycle lock ordering: contest before linked problem.
      if (effectiveContestId !== null) {
        const [currentContest] = await tx.select({ status: contests.status, startsAt: contests.startsAt, endsAt: contests.endsAt })
          .from(contests).where(and(eq(contests.id, effectiveContestId), eq(contests.organizationId, organization.organizationId)))
          .limit(1).for("share");
        const now = Date.now();
        if (!currentContest || (participation === "official"
          ? currentContest.status !== "live" || now < currentContest.startsAt.getTime() || now >= currentContest.endsAt.getTime()
          : currentContest.status !== "ended" && currentContest.status !== "archived")) {
          throw new SubmissionAccessExpired();
        }
        if (participation === "official") {
          officialWindow = currentContest;
          const [registration] = await tx.select({ teamId: contestRegistrations.teamId }).from(contestRegistrations)
            .where(and(eq(contestRegistrations.contestId, effectiveContestId), eq(contestRegistrations.userId, userId))).limit(1);
          if (!registration) throw new SubmissionAccessExpired();
          teamId = registration.teamId;
        } else {
          const [registration] = await tx.select({ endsAt: contestVirtualRegistrations.endsAt }).from(contestVirtualRegistrations)
            .where(and(eq(contestVirtualRegistrations.contestId, effectiveContestId), eq(contestVirtualRegistrations.userId, userId))).limit(1);
          if (!registration) throw new SubmissionAccessExpired();
          virtualEndsAt = registration.endsAt;
        }
        const [link] = await tx.select({ problemId: contestProblems.problemId }).from(contestProblems)
          .where(and(eq(contestProblems.contestId, effectiveContestId), eq(contestProblems.problemId, problemId),
            eq(contestProblems.organizationId, organization.organizationId))).limit(1);
        if (!link) throw new SubmissionAccessExpired();
      }
      const [currentProblem] = await tx.select({ status: problems.status }).from(problems)
        .where(and(eq(problems.id, problemId), eq(problems.organizationId, organization.organizationId)))
        .limit(1).for("share");
      if (!currentProblem || currentProblem.status === "draft" ||
          (effectiveContestId === null && currentProblem.status !== "published")) {
        throw new SubmissionAccessExpired();
      }
      const submittedAt = new Date();
      if (officialWindow && (submittedAt < officialWindow.startsAt || submittedAt >= officialWindow.endsAt)) {
        throw new SubmissionAccessExpired();
      }
      if (virtualEndsAt !== null && !isVirtualAttemptActive(submittedAt, virtualEndsAt)) {
        throw new VirtualParticipationExpired();
      }
      const inserted = await tx
        .insert(submissions)
        .values({
          organizationId: organization.organizationId,
          userId,
          problemId,
          contestId: effectiveContestId,
          teamId,
          participation,
          language,
          code,
          mode,
          status: "pending",
          // NOW() is the transaction start, not admission after a lock wait.
          submittedAt,
        })
        .returning({ id: submissions.id });
      const sid = inserted[0].id;
      await tx.insert(judgeJobs).values({ submissionId: sid });
      return sid;
    });
  } catch (e) {
    if (e instanceof RateLimited) {
      return NextResponse.json(
        { error: "rate limited: 1 submission per 30 seconds per problem" },
        { status: 429, headers: { "Retry-After": String(e.retryAfter) } },
      );
    }
    if (e instanceof QueueAdmissionLimited) {
      const message = e.scope === "global"
        ? "judge queue is at capacity; try again shortly"
        : e.scope === "organization"
          ? "organization judge queue is at capacity; try again shortly"
          : "you already have the maximum number of active submissions";
      return NextResponse.json(
        { error: message },
        { status: e.status, headers: { "Retry-After": String(e.retryAfter) } },
      );
    }
    if (e instanceof SubmissionAccessExpired) {
      return jsonError("problem or contest is no longer accepting submissions", 403);
    }
    if (e instanceof VirtualParticipationExpired) {
      return jsonError("virtual participation time expired", 403);
    }
    throw e;
  }

  return NextResponse.json(
    { id: submissionId, status: "pending" },
    { status: 202 },
  );
}

async function handleGET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);

  const url = req.nextUrl;
  const problemIdRaw = url.searchParams.get("problemId");
  const contestIdRaw = url.searchParams.get("contestId");

  let problemId: number | undefined;
  if (problemIdRaw !== null) {
    const pid = Number(problemIdRaw);
    if (!Number.isInteger(pid) || pid <= 0) {
      return jsonError("problemId must be a positive integer", 400);
    }
    problemId = pid;
  }

  let contestId: number | undefined;
  if (contestIdRaw !== null) {
    const cid = Number(contestIdRaw);
    if (!Number.isInteger(cid) || cid <= 0) {
      return jsonError("contestId must be a positive integer", 400);
    }
    contestId = cid;
  }

  const conditions = [
    eq(submissions.organizationId, organization.organizationId),
    eq(submissions.userId, userId),
  ];
  if (problemId !== undefined) {
    conditions.push(eq(submissions.problemId, problemId));
  }
  if (contestId !== undefined) {
    conditions.push(eq(submissions.contestId, contestId));
  }

  const rows = await db
    .select({
      id: submissions.id,
      problemId: submissions.problemId,
      problemTitle: problems.title,
      language: submissions.language,
      status: submissions.status,
      passedTests: submissions.passedTests,
      totalTests: submissions.totalTests,
      executionTimeMs: submissions.executionTimeMs,
      memoryUsedMb: submissions.memoryUsedMb,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .leftJoin(problems, eq(submissions.problemId, problems.id))
    .where(and(...conditions))
    .orderBy(desc(submissions.submittedAt))
    .limit(100);

  const result = rows.map((r) => ({
    id: r.id,
    problemId: r.problemId,
    problemTitle: r.problemTitle ?? `Problem #${r.problemId}`,
    language: r.language,
    status: r.status,
    passedTests: r.passedTests,
    totalTests: r.totalTests,
    executionTimeMs: r.executionTimeMs,
    memoryUsedMb: r.memoryUsedMb,
    submittedAt: r.submittedAt?.toISOString() ?? null,
  }));

  return NextResponse.json(result);
}

export const POST = withApiGuard(handlePOST);
export const GET = withApiGuard(handleGET);
