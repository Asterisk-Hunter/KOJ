import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, problemTestCases, problems } from "@/db/schema";
import { jsonError, requireSetter } from "@/app/api/admin/authz";
import { readBoundedJsonObject, MAX_TEST_CASE_BODY_BYTES } from "@/app/api/body-guard";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import {
  MAX_TEST_CASE_FILE_BYTES,
  testCaseLimitMessage,
  testCaseLimitViolation,
} from "@/app/api/admin/problems/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findProblem(idRaw: string, organizationId: number) {
  const numeric = Number(idRaw);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const rows = await db.select().from(problems).where(and(
    eq(problems.id, numeric),
    eq(problems.organizationId, organizationId),
  )).limit(1);
  return rows.length > 0 ? rows[0] : null;
}

async function isLockedByLiveContest(problemId: number, organizationId: number): Promise<boolean> {
  const links = await db
    .select({ status: contests.status })
    .from(contestProblems)
    .innerJoin(contests, eq(contestProblems.contestId, contests.id))
    .where(and(
      eq(contestProblems.problemId, problemId),
      eq(contestProblems.organizationId, organizationId),
    ));
  return links.some((l) => l.status === "live");
}

function checkFileSize(v: unknown, field: string): string | NextResponse {
  if (typeof v !== "string" || v.length === 0) return jsonError(`${field} must be non-empty`, 400);
  if (Buffer.byteLength(v, "utf8") > MAX_TEST_CASE_FILE_BYTES) {
    return jsonError(`${field} exceeds 10MB (REQ-PROB-03)`, 400);
  }
  return v;
}

/** Setter+: list test cases for a problem (ownership-checked). */
async function handleGET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireSetter();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const problem = await findProblem(idRaw, grant.context.organizationId);
  if (!problem) return jsonError("problem not found", 404);
  if (grant.dbRole !== "admin" && problem.authorId !== grant.userId) {
    return jsonError("forbidden", 403);
  }

  const cases = await db
    .select()
    .from(problemTestCases)
    .where(eq(problemTestCases.problemId, problem.id))
    .orderBy(asc(problemTestCases.position));

  return NextResponse.json({
    testCases: cases.map((c) => ({
      id: c.id,
      input: c.input,
      expectedOutput: c.expectedOutput,
      isSample: c.isSample,
      position: c.position,
    })),
  });
}

/** Setter+: add a test case (blocked while a linked contest is live). */
async function handlePOST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireSetter();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const problem = await findProblem(idRaw, grant.context.organizationId);
  if (!problem) return jsonError("problem not found", 404);
  if (grant.dbRole !== "admin" && problem.authorId !== grant.userId) {
    return jsonError("forbidden", 403);
  }
  if (await isLockedByLiveContest(problem.id, grant.context.organizationId)) {
    return jsonError("test cases are locked while the contest is live", 403);
  }

  // Bounded body: 413 before parsing (fields cap at 10MB each; the cap
  // leaves room for JSON overhead). Field validation below is unchanged.
  const parsed = await readBoundedJsonObject(req, MAX_TEST_CASE_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const b = parsed.value;

  const input = checkFileSize(b.input, "input");
  if (input instanceof NextResponse) return input;
  const expectedOutput = checkFileSize(b.expectedOutput, "expectedOutput");
  if (expectedOutput instanceof NextResponse) return expectedOutput;

  const isSample = b.isSample ?? false;
  if (typeof isSample !== "boolean") return jsonError("isSample must be a boolean", 400);

  const requestedPosition = b.position;
  if (requestedPosition !== undefined && (typeof requestedPosition !== "number" || !Number.isInteger(requestedPosition) || requestedPosition < 0)) {
    return jsonError("position must be a non-negative integer", 400);
  }

  const result = await db.transaction(async (tx) => {
    const [lockedProblem] = await tx
      .select({ id: problems.id })
      .from(problems)
      .where(and(eq(problems.id, problem.id), eq(problems.organizationId, grant.context.organizationId)))
      .for("update");
    if (!lockedProblem) return { ok: false as const, error: "problem not found", status: 404 as const };
    const [usage] = await tx
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        bytes: sql<number>`COALESCE(sum(octet_length(${problemTestCases.input}) + octet_length(${problemTestCases.expectedOutput})), 0)`.mapWith(Number),
        maxPosition: sql<number | null>`max(${problemTestCases.position})`.mapWith(Number),
      })
      .from(problemTestCases)
      .where(eq(problemTestCases.problemId, problem.id));
    const violation = testCaseLimitViolation(usage?.count ?? 0, usage?.bytes ?? 0, [{ input, expectedOutput }]);
    if (violation) return { ok: false as const, error: testCaseLimitMessage(violation), status: 400 as const };
    const position = typeof requestedPosition === "number" ? requestedPosition : (usage?.maxPosition ?? -1) + 1;
    const rows = await tx
      .insert(problemTestCases)
      .values({ problemId: problem.id, input, expectedOutput, isSample, position })
      .returning({ id: problemTestCases.id });
    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId,
      actorId: grant.userId,
      action: "problem.test_case_added",
      entityType: "problem",
      entityId: problem.id,
      metadata: { isSample },
    });
    return { ok: true as const, id: rows[0].id };
  });

  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json(result, { status: 201 });
}

export const GET = withApiGuard(handleGET);
export const POST = withApiGuard(handlePOST);
