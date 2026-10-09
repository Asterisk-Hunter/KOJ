import { withApiGuard } from "@/app/api/guard";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { judgeJobs, submissions } from "@/db/schema";
import { requireOrganizationAdmin } from "@/app/api/admin/authz";
import { MAX_RECOVER_BODY_BYTES, readBoundedJson } from "@/app/api/body-guard";
import { parseRejudgeScope } from "@/app/api/admin/submissions/rejudge-scope";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { getQueueAdmissionDenial } from "@/app/api/submissions/queue-admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REJUDGE_BATCH = 500;

async function handlePOST(req: NextRequest) {
  const grant = await requireOrganizationAdmin();
  if (!grant.ok) return grant.response;

  const parsed = await readBoundedJson(req, MAX_RECOVER_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const parsedScope = parseRejudgeScope(parsed.value);
  if (!parsedScope.ok) {
    return NextResponse.json({ error: parsedScope.error }, { status: 400 });
  }

  const { scope } = parsedScope;
  const scopeCondition =
    scope.kind === "submission"
      ? eq(submissions.id, scope.id)
      : scope.kind === "problem"
        ? eq(submissions.problemId, scope.id)
        : eq(submissions.contestId, scope.id);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('koj:queue-admission'), 0)`);
    const rows = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .leftJoin(judgeJobs, eq(judgeJobs.submissionId, submissions.id))
      .where(
        and(
          eq(submissions.organizationId, grant.context.organizationId),
          scopeCondition,
          notInArray(submissions.status, ["pending", "running"]),
          or(isNull(judgeJobs.id), inArray(judgeJobs.status, ["completed", "dead"])),
        ),
      )
      .orderBy(asc(submissions.submittedAt))
      .limit(MAX_REJUDGE_BATCH + 1);
    if (rows.length > MAX_REJUDGE_BATCH) return null;
    const candidateIds = rows.map((row) => row.id);
    if (candidateIds.length === 0) return { kind: "completed" as const, submissionIds: candidateIds };

    await tx
      .select({ id: judgeJobs.id })
      .from(judgeJobs)
      .where(inArray(judgeJobs.submissionId, candidateIds))
      .orderBy(asc(judgeJobs.id))
      .for("update");
    await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(
        eq(submissions.organizationId, grant.context.organizationId),
        inArray(submissions.id, candidateIds),
      ))
      .orderBy(asc(submissions.id))
      .for("update");

    const eligibleRows = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .leftJoin(judgeJobs, eq(judgeJobs.submissionId, submissions.id))
      .where(and(
        eq(submissions.organizationId, grant.context.organizationId),
        inArray(submissions.id, candidateIds),
        notInArray(submissions.status, ["pending", "running"]),
        or(isNull(judgeJobs.id), inArray(judgeJobs.status, ["completed", "dead"])),
      ))
      .orderBy(asc(submissions.submittedAt));
    const ids = eligibleRows.map((row) => row.id);
    if (ids.length === 0) return { kind: "completed" as const, submissionIds: ids };

    const [activeCounts] = await tx
      .select({
        globalActive: sql<number>`count(*) FILTER (WHERE ${inArray(judgeJobs.status, ["queued", "leased"])})`.mapWith(Number),
        organizationActive: sql<number>`count(*) FILTER (WHERE ${inArray(judgeJobs.status, ["queued", "leased"])} AND ${eq(submissions.organizationId, grant.context.organizationId)})`.mapWith(Number),
        userActive: sql<number>`0`.mapWith(Number),
      })
      .from(judgeJobs)
      .innerJoin(submissions, eq(judgeJobs.submissionId, submissions.id));
    const denial = getQueueAdmissionDenial(activeCounts, ids.length, false);
    if (denial) return { kind: "denied" as const, denial };

    await tx
      .update(submissions)
      .set({
        status: "pending",
        startedAt: null,
        completedAt: null,
        executionTimeMs: null,
        memoryUsedMb: null,
        passedTests: null,
        totalTests: null,
        errorMessage: null,
        caseResults: null,
        judgeInfraError: false,
      })
      .where(inArray(submissions.id, ids));

    await tx
      .insert(judgeJobs)
      .values(ids.map((submissionId) => ({ submissionId })))
      .onConflictDoUpdate({
        target: judgeJobs.submissionId,
        set: {
          status: "queued",
          attempts: 0,
          maxAttempts: 3,
          availableAt: new Date(),
          leasedBy: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          lastError: null,
          updatedAt: new Date(),
          completedAt: null,
        },
        setWhere: inArray(judgeJobs.status, ["completed", "dead"]),
      });
    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId,
      actorId: grant.userId,
      action: "submission.rejudge_requested",
      entityType: scope.kind,
      entityId: scope.id,
      metadata: { count: ids.length },
    });
    return { kind: "completed" as const, submissionIds: ids };
  });

  if (result === null) {
    return NextResponse.json(
      { error: `rejudge batches are limited to ${MAX_REJUDGE_BATCH} submissions` },
      { status: 400 },
    );
  }
  if (result.kind === "denied") {
    const message = result.denial.scope === "global"
      ? "judge queue is at capacity; try again shortly"
      : "organization judge queue is at capacity; try again shortly";
    return NextResponse.json(
      { error: message },
      { status: result.denial.status, headers: { "Retry-After": String(result.denial.retryAfter) } },
    );
  }
  const submissionIds = result.submissionIds;
  if (scope.kind === "submission" && submissionIds.length === 0) {
    const existing = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(
        eq(submissions.id, scope.id),
        eq(submissions.organizationId, grant.context.organizationId),
      ))
      .limit(1);
    if (existing.length === 0) {
      return NextResponse.json({ error: "submission not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "submission is already pending, running, or leased" },
      { status: 409 },
    );
  }

  return NextResponse.json({ rejudged: submissionIds.length, submissionIds });
}

export const POST = withApiGuard(handlePOST);
