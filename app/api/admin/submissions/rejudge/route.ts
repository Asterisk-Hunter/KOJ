import { and, asc, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { judgeJobs, submissions } from "@/db/schema";
import { requireAdmin } from "@/app/api/admin/authz";
import { MAX_RECOVER_BODY_BYTES, readBoundedJson } from "@/app/api/body-guard";
import { parseRejudgeScope } from "@/app/api/admin/submissions/rejudge-scope";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REJUDGE_BATCH = 500;

export async function POST(req: NextRequest) {
  const grant = await requireAdmin();
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

  const submissionIds = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .leftJoin(judgeJobs, eq(judgeJobs.submissionId, submissions.id))
      .where(
        and(
          scopeCondition,
          notInArray(submissions.status, ["pending", "running"]),
          or(isNull(judgeJobs.id), inArray(judgeJobs.status, ["completed", "dead"])),
        ),
      )
      .orderBy(asc(submissions.submittedAt))
      .limit(MAX_REJUDGE_BATCH + 1);
    if (rows.length > MAX_REJUDGE_BATCH) return null;
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return ids;

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
      actorId: grant.userId,
      action: "submission.rejudge_requested",
      entityType: scope.kind,
      entityId: scope.id,
      metadata: { count: ids.length },
    });
    return ids;
  });

  if (submissionIds === null) {
    return NextResponse.json(
      { error: `rejudge batches are limited to ${MAX_REJUDGE_BATCH} submissions` },
      { status: 400 },
    );
  }
  if (scope.kind === "submission" && submissionIds.length === 0) {
    const existing = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.id, scope.id))
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
