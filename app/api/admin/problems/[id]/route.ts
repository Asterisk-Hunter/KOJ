import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contestProblems,
  contests,
  problemTestCases,
  problems,
  submissions,
} from "@/db/schema";
import { jsonError, requireOrganizationAdmin, requireSetter } from "@/app/api/admin/authz";
import { parseOutputComparator, parseOutputTolerance } from "@/app/api/admin/problems/comparator";
import { parseCheckerCode } from "@/app/api/admin/problems/checker-code";
import { MAX_PROBLEM_MEMORY_MB } from "@/app/api/admin/problems/limits";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { MAX_PROBLEM_AUTHORING_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";

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

/** True when the problem is locked: `contest_active` with a `live` contest running. */
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

async function linkedContestCount(problemId: number, organizationId: number): Promise<number> {
  const links = await db
    .select({ contestId: contestProblems.contestId })
    .from(contestProblems)
    .where(and(
      eq(contestProblems.problemId, problemId),
      eq(contestProblems.organizationId, organizationId),
    ));
  return links.length;
}

/** Setter+: full problem with ordered test cases (for edit UIs). */
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
    outputComparator: problem.outputComparator,
    absoluteTolerance: problem.absoluteTolerance,
    relativeTolerance: problem.relativeTolerance,
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
async function handlePATCH(
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

  if (problem.status === "contest_active" && (await isLockedByLiveContest(problem.id, grant.context.organizationId))) {
    return jsonError("problem is locked while its contest is live (BR-08)", 403);
  }

  const parsed = await readBoundedJsonObject(req, MAX_PROBLEM_AUTHORING_BODY_BYTES, "invalid json");
  if (!parsed.ok) return parsed.response;
  const b = parsed.value;
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
    const n = parseBoundedInt(b.memoryLimitMb, 16, MAX_PROBLEM_MEMORY_MB);
    if (n === null) return jsonError(`memoryLimitMb must be an integer 16..${MAX_PROBLEM_MEMORY_MB}`, 400);
    patch.memoryLimitMb = n;
  }

  if (b.outputComparator !== undefined) {
    const comparator = parseOutputComparator(b.outputComparator);
    if (!comparator) return jsonError("outputComparator must be exact or float", 400);
    patch.outputComparator = comparator;
  }
  if (b.absoluteTolerance !== undefined) {
    const tolerance = parseOutputTolerance(b.absoluteTolerance);
    if (tolerance === null) return jsonError("absoluteTolerance must be between 0 and 1", 400);
    patch.absoluteTolerance = tolerance;
  }
  if (b.relativeTolerance !== undefined) {
    const tolerance = parseOutputTolerance(b.relativeTolerance);
    if (tolerance === null) return jsonError("relativeTolerance must be between 0 and 1", 400);
    patch.relativeTolerance = tolerance;
  }
  if (b.checkerCode !== undefined) {
    const checkerCode = parseCheckerCode(b.checkerCode);
    if (!checkerCode.valid) {
      return jsonError("checkerCode must be Python source no larger than 64 KiB", 400);
    }
    patch.checkerCode = checkerCode.checkerCode;
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
    if (to === "published") {
      // Same rule as POST: no test cases means every submission would be
      // unjudgeable, which the judge reports as infrastructure failure.
      const cases = await db
        .select({ id: problemTestCases.id })
        .from(problemTestCases)
        .where(eq(problemTestCases.problemId, problem.id));
      if (cases.length === 0) {
        return jsonError("publish requires at least one test case", 400);
      }
    }
    patch.status = to as "draft" | "published";
  }

  await db.transaction(async (tx) => {
    await tx.update(problems).set(patch).where(and(
      eq(problems.id, problem.id),
      eq(problems.organizationId, grant.context.organizationId),
    ));
    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId,
      actorId: grant.userId,
      action: "problem.updated",
      entityType: "problem",
      entityId: problem.id,
      metadata: { fields: Object.keys(patch).filter((field) => field !== "updatedAt").join(",") },
    });
  });
  return NextResponse.json({ id: problem.id, updated: true });
}

/**
 * Admin: delete a problem. Refused when the problem is linked to any
 * contest or has any submissions (preserves standings/history).
 */
async function handleDELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireOrganizationAdmin();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const problem = await findProblem(idRaw, grant.context.organizationId);
  if (!problem) return jsonError("problem not found", 404);

  if ((await linkedContestCount(problem.id, grant.context.organizationId)) > 0) {
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

  await db.transaction(async (tx) => {
    await tx.delete(problemTestCases).where(eq(problemTestCases.problemId, problem.id));
    await tx.delete(problems).where(and(
      eq(problems.id, problem.id),
      eq(problems.organizationId, grant.context.organizationId),
    ));
    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId,
      actorId: grant.userId,
      action: "problem.deleted",
      entityType: "problem",
      entityId: problem.id,
    });
  });
  return NextResponse.json({ deleted: true });
}

export const GET = withApiGuard(handleGET);
export const PATCH = withApiGuard(handlePATCH);
export const DELETE = withApiGuard(handleDELETE);
