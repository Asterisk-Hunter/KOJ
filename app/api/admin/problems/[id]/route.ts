import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contestProblems,
  contests,
  problemTestCases,
  problems,
  submissions,
} from "@/db/schema";
import { jsonError, requireAdmin, requireSetter } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findProblem(idRaw: string) {
  const numeric = Number(idRaw);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const rows = await db.select().from(problems).where(eq(problems.id, numeric)).limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/** True when the problem is locked: `contest_active` with a `live` contest running. */
async function isLockedByLiveContest(problemId: number): Promise<boolean> {
  const links = await db
    .select({ status: contests.status })
    .from(contestProblems)
    .innerJoin(contests, eq(contestProblems.contestId, contests.id))
    .where(eq(contestProblems.problemId, problemId));
  return links.some((l) => l.status === "live");
}

async function linkedContestCount(problemId: number): Promise<number> {
  const links = await db
    .select({ contestId: contestProblems.contestId })
    .from(contestProblems)
    .where(eq(contestProblems.problemId, problemId));
  return links.length;
}

/** Setter+: full problem with ordered test cases (for edit UIs). */
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
    id: problem.id,
    title: problem.title,
    statement: problem.statement,
    inputFormat: problem.inputFormat,
    outputFormat: problem.outputFormat,
    constraints: problem.constraints,
    explanation: problem.explanation,
    difficulty: problem.difficulty,
    tags: problem.tags,
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    status: problem.status,
    testCases: cases.map((c) => ({
      id: c.id,
      input: c.input,
      expectedOutput: c.expectedOutput,
      isSample: c.isSample,
      position: c.position,
    })),
  });
}

type Difficulty = "easy" | "medium" | "hard";

function parseDifficulty(v: unknown): Difficulty | null {
  if (typeof v !== "string") return null;
  const lower = v.toLowerCase();
  if (lower === "easy" || lower === "medium" || lower === "hard") return lower;
  return null;
}

function parseBoundedInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/**
 * Setter+: edit a problem. Blocked while a linked contest is live
 * (REQ-PROB-10 / BR-08). Setters may only edit their own problems.
 * Status may move draft<->published directly; `contest_active` is owned
 * by the contest lifecycle.
 */
export async function PATCH(
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

  if (problem.status === "contest_active" && (await isLockedByLiveContest(problem.id))) {
    return jsonError("problem is locked while its contest is live (BR-08)", 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }
  const b = body as Record<string, unknown>;
  const now = new Date();
  const patch: Partial<typeof problems.$inferInsert> = { updatedAt: now };

  const strFields = ["title", "statement", "inputFormat", "outputFormat", "constraints"] as const;
  for (const field of strFields) {
    if (b[field] !== undefined) {
      const v = b[field];
      if (typeof v !== "string" || v.trim().length === 0) {
        return jsonError(`${field} must be non-empty`, 400);
      }
      if (field === "title" && v.trim().length > 500) return jsonError("title too long", 400);
      (patch as Record<string, unknown>)[field] = field === "title" ? v.trim() : v;
    }
  }

  if (b.explanation !== undefined) {
    if (b.explanation !== null && typeof b.explanation !== "string") {
      return jsonError("explanation must be a string or null", 400);
    }
    const v = b.explanation as string | null;
    patch.explanation = v === null || v.trim().length === 0 ? null : v;
  }

  if (b.difficulty !== undefined) {
    const d = parseDifficulty(b.difficulty);
    if (!d) return jsonError("difficulty must be easy, medium, or hard", 400);
    patch.difficulty = d;
  }

  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) return jsonError("tags must be an array", 400);
    for (const t of b.tags) {
      if (typeof t !== "string" || t.trim().length === 0) {
        return jsonError("tags must be non-empty strings", 400);
      }
    }
    patch.tags = (b.tags as string[]).map((s) => s.trim());
  }

  if (b.timeLimitMs !== undefined) {
    const n = parseBoundedInt(b.timeLimitMs, 100, 10000);
    if (n === null) return jsonError("timeLimitMs must be an integer 100..10000", 400);
    patch.timeLimitMs = n;
  }
  if (b.memoryLimitMb !== undefined) {
    const n = parseBoundedInt(b.memoryLimitMb, 16, 2048);
    if (n === null) return jsonError("memoryLimitMb must be an integer 16..2048", 400);
    patch.memoryLimitMb = n;
  }

  if (b.status !== undefined) {
    if (typeof b.status !== "string") return jsonError("status must be a string", 400);
    const from = problem.status;
    const to = b.status;
    const directOk =
      (from === "draft" && to === "published") || (from === "published" && to === "draft");
    if (!directOk) {
      return jsonError(
        `cannot move problem ${from} -> ${to} directly (contest_active is contest-owned)`,
        400,
      );
    }
    patch.status = to as "draft" | "published";
  }

  await db.update(problems).set(patch).where(eq(problems.id, problem.id));
  return NextResponse.json({ id: problem.id, updated: true });
}

/**
 * Admin: delete a problem. Refused when the problem is linked to any
 * contest or has any submissions (preserves standings/history).
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const problem = await findProblem(idRaw);
  if (!problem) return jsonError("problem not found", 404);

  if ((await linkedContestCount(problem.id)) > 0) {
    return jsonError("cannot delete a problem linked to a contest", 409);
  }
  const subRows = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.problemId, problem.id))
    .limit(1);
  if (subRows.length > 0) {
    return jsonError("cannot delete a problem with submissions", 409);
  }

  await db.delete(problemTestCases).where(eq(problemTestCases.problemId, problem.id));
  await db.delete(problems).where(eq(problems.id, problem.id));
  return NextResponse.json({ deleted: true });
}
