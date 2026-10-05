import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, problemTestCases, problems } from "@/db/schema";
import { jsonError, requireSetter } from "@/app/api/admin/authz";
import { MAX_TEST_CASE_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { parseTestCasesFromText } from "@/app/api/admin/problems/import/parser";
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

  const parsed = await readBoundedJsonObject(req, MAX_TEST_CASE_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const b = parsed.value;

  type InCase = { input: unknown; expectedOutput: unknown; isSample?: unknown; position?: unknown };
  const toInsert: Array<{ input: string; expectedOutput: string; isSample: boolean; position: number | null }> = [];

  // Mode 1: raw CSV or delimited string
  if (typeof b.rawText === "string" && b.rawText.trim()) {
    const parsed = parseTestCasesFromText(b.rawText);
    for (const p of parsed) {
      toInsert.push({
        input: p.input,
        expectedOutput: p.expectedOutput,
        isSample: p.isSample,
        position: null,
      });
    }
  } else if (Array.isArray(b.testCases)) {
    // Mode 2: array of test case objects
    const cases = b.testCases as InCase[];
    for (let i = 0; i < cases.length; i++) {
      const tc = cases[i];
      if (!tc || typeof tc !== "object") continue;
      if (typeof tc.input !== "string" || !tc.input) {
        return jsonError(`test case ${i + 1} input must be non-empty`, 400);
      }
      if (Buffer.byteLength(tc.input, "utf8") > MAX_TEST_CASE_FILE_BYTES) {
        return jsonError(`test case ${i + 1} input exceeds 10MB`, 400);
      }
      if (typeof tc.expectedOutput !== "string" || !tc.expectedOutput) {
        return jsonError(`test case ${i + 1} expectedOutput must be non-empty`, 400);
      }
      if (Buffer.byteLength(tc.expectedOutput, "utf8") > MAX_TEST_CASE_FILE_BYTES) {
        return jsonError(`test case ${i + 1} expectedOutput exceeds 10MB`, 400);
      }
      const isSample = typeof tc.isSample === "boolean" ? tc.isSample : false;
      const pos = typeof tc.position === "number" && Number.isInteger(tc.position) && tc.position >= 0
        ? tc.position
        : null;

      toInsert.push({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isSample,
        position: pos,
      });
    }
  } else {
    return jsonError("Either testCases array or rawText string is required", 400);
  }

  if (toInsert.length === 0) {
    return jsonError("No valid test cases found in request", 400);
  }

  const requestViolation = testCaseLimitViolation(0, 0, toInsert);
  if (requestViolation) return jsonError(testCaseLimitMessage(requestViolation), 400);

  // Insert all test cases
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
    const violation = testCaseLimitViolation(usage?.count ?? 0, usage?.bytes ?? 0, toInsert);
    if (violation) return { ok: false as const, error: testCaseLimitMessage(violation), status: 400 as const };
    let nextPosition = (usage?.maxPosition ?? -1) + 1;
    await tx.insert(problemTestCases).values(
      toInsert.map((c) => ({
        problemId: problem.id,
        input: c.input,
        expectedOutput: c.expectedOutput,
        isSample: c.isSample,
        position: c.position ?? nextPosition++,
      })),
    );
    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId,
      actorId: grant.userId,
      action: "problem.test_cases_imported",
      entityType: "problem",
      entityId: problem.id,
      metadata: { count: toInsert.length },
    });
    return { ok: true as const };
  });
  if (!result.ok) return jsonError(result.error, result.status);

  // Return updated test cases
  const allCases = await db
    .select()
    .from(problemTestCases)
    .where(eq(problemTestCases.problemId, problem.id))
    .orderBy(asc(problemTestCases.position));

  return NextResponse.json({
    message: `Successfully added ${toInsert.length} test cases`,
    addedCount: toInsert.length,
    totalCount: allCases.length,
    testCases: allCases,
  });
}

export const POST = withApiGuard(handlePOST);
