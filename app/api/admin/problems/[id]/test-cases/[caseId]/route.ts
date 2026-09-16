import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, problemTestCases, problems } from "@/db/schema";
import { jsonError, requireSetter } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // REQ-PROB-03

async function findCase(problemId: number, caseIdRaw: string) {
  const caseId = Number(caseIdRaw);
  if (!Number.isInteger(caseId) || caseId <= 0) return null;
  const rows = await db
    .select()
    .from(problemTestCases)
    .where(
      and(eq(problemTestCases.id, caseId), eq(problemTestCases.problemId, problemId)),
    )
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

async function guard(
  problemIdRaw: string,
  caseIdRaw: string,
  userId: string,
  dbRole: string | null,
) {
  const problemId = Number(problemIdRaw);
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return { error: jsonError("invalid problem id", 400) as NextResponse | null, problem: null, testCase: null };
  }
  const problemRows = await db
    .select()
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);
  if (problemRows.length === 0) {
    return { error: jsonError("problem not found", 404), problem: null, testCase: null };
  }
  const problem = problemRows[0];
  if (dbRole === "problem_setter" && problem.authorId !== userId) {
    return { error: jsonError("forbidden", 403), problem: null, testCase: null };
  }
  const testCase = await findCase(problem.id, caseIdRaw);
  if (!testCase) {
    return { error: jsonError("test case not found", 404), problem: null, testCase: null };
  }
  const links = await db
    .select({ status: contests.status })
    .from(contestProblems)
    .innerJoin(contests, eq(contestProblems.contestId, contests.id))
    .where(eq(contestProblems.problemId, problem.id));
  if (links.some((l) => l.status === "live")) {
    return {
      error: jsonError("test cases are locked while the contest is live", 403),
      problem: null,
      testCase: null,
    };
  }
  return { error: null, problem, testCase };
}

/** Setter+: edit one test case. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; caseId: string }> },
) {
  const grant = await requireSetter();
  if (!grant.ok) return grant.response;

  const { id: idRaw, caseId: caseIdRaw } = await ctx.params;
  const g = await guard(idRaw, caseIdRaw, grant.userId, grant.dbRole);
  if (g.error || !g.testCase) return g.error ?? jsonError("test case not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }
  const b = body as Record<string, unknown>;
  const patch: Partial<typeof problemTestCases.$inferInsert> = {};

  if (b.input !== undefined) {
    if (typeof b.input !== "string" || b.input.length === 0) {
      return jsonError("input must be non-empty", 400);
    }
    if (Buffer.byteLength(b.input, "utf8") > MAX_FILE_BYTES) {
      return jsonError("input exceeds 10MB (REQ-PROB-03)", 400);
    }
    patch.input = b.input;
  }
  if (b.expectedOutput !== undefined) {
    if (typeof b.expectedOutput !== "string" || b.expectedOutput.length === 0) {
      return jsonError("expectedOutput must be non-empty", 400);
    }
    if (Buffer.byteLength(b.expectedOutput, "utf8") > MAX_FILE_BYTES) {
      return jsonError("expectedOutput exceeds 10MB (REQ-PROB-03)", 400);
    }
    patch.expectedOutput = b.expectedOutput;
  }
  if (b.isSample !== undefined) {
    if (typeof b.isSample !== "boolean") return jsonError("isSample must be a boolean", 400);
    patch.isSample = b.isSample;
  }
  if (b.position !== undefined) {
    if (typeof b.position !== "number" || !Number.isInteger(b.position) || b.position < 0) {
      return jsonError("position must be a non-negative integer", 400);
    }
    patch.position = b.position;
  }

  await db.update(problemTestCases).set(patch).where(eq(problemTestCases.id, g.testCase.id));
  return NextResponse.json({ id: g.testCase.id, updated: true });
}

/** Setter+: delete one test case. */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; caseId: string }> },
) {
  const grant = await requireSetter();
  if (!grant.ok) return grant.response;

  const { id: idRaw, caseId: caseIdRaw } = await ctx.params;
  const g = await guard(idRaw, caseIdRaw, grant.userId, grant.dbRole);
  if (g.error || !g.testCase) return g.error ?? jsonError("test case not found", 404);

  await db.delete(problemTestCases).where(eq(problemTestCases.id, g.testCase.id));
  return NextResponse.json({ deleted: true });
}
