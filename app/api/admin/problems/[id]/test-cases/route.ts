import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, problemTestCases, problems } from "@/db/schema";
import { jsonError, requireSetter } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // REQ-PROB-03
const MAX_CASES = 100;

async function findProblem(idRaw: string) {
  const numeric = Number(idRaw);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const rows = await db.select().from(problems).where(eq(problems.id, numeric)).limit(1);
  return rows.length > 0 ? rows[0] : null;
}

async function isLockedByLiveContest(problemId: number): Promise<boolean> {
  const links = await db
    .select({ status: contests.status })
    .from(contestProblems)
    .innerJoin(contests, eq(contestProblems.contestId, contests.id))
    .where(eq(contestProblems.problemId, problemId));
  return links.some((l) => l.status === "live");
}

function checkFileSize(v: unknown, field: string): string | NextResponse {
  if (typeof v !== "string" || v.length === 0) return jsonError(`${field} must be non-empty`, 400);
  if (Buffer.byteLength(v, "utf8") > MAX_FILE_BYTES) {
    return jsonError(`${field} exceeds 10MB (REQ-PROB-03)`, 400);
  }
  return v;
}

/** Setter+: list test cases for a problem (ownership-checked). */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireSetter();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const problem = await findProblem(idRaw);
  if (!problem) return jsonError("problem not found", 404);
  if (grant.dbRole === "problem_setter" && problem.authorId !== grant.userId) {
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
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireSetter();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const problem = await findProblem(idRaw);
  if (!problem) return jsonError("problem not found", 404);
  if (grant.dbRole === "problem_setter" && problem.authorId !== grant.userId) {
    return jsonError("forbidden", 403);
  }
  if (await isLockedByLiveContest(problem.id)) {
    return jsonError("test cases are locked while the contest is live", 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }
  const b = body as Record<string, unknown>;

  const input = checkFileSize(b.input, "input");
  if (input instanceof NextResponse) return input;
  const expectedOutput = checkFileSize(b.expectedOutput, "expectedOutput");
  if (expectedOutput instanceof NextResponse) return expectedOutput;

  const isSample = b.isSample ?? false;
  if (typeof isSample !== "boolean") return jsonError("isSample must be a boolean", 400);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(problemTestCases)
    .where(eq(problemTestCases.problemId, problem.id));
  if ((countRow?.count ?? 0) >= MAX_CASES) {
    return jsonError(`at most ${MAX_CASES} test cases per problem`, 400);
  }

  let position = b.position;
  if (position === undefined) {
    const [row] = await db
      .select({ max: sql<number | null>`max(${problemTestCases.position})`.mapWith(Number) })
      .from(problemTestCases)
      .where(eq(problemTestCases.problemId, problem.id));
    position = (row?.max ?? -1) + 1;
  }
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
    return jsonError("position must be a non-negative integer", 400);
  }

  const inserted = await db
    .insert(problemTestCases)
    .values({ problemId: problem.id, input, expectedOutput, isSample, position })
    .returning({ id: problemTestCases.id });

  return NextResponse.json({ id: inserted[0].id }, { status: 201 });
}
