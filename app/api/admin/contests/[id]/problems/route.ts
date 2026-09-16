import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, problems } from "@/db/schema";
import { jsonError, requireAdmin } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findContest(idRaw: string) {
  const numeric = Number(idRaw);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const rows = await db.select().from(contests).where(eq(contests.id, numeric)).limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/** Admin: add an existing draft problem to a draft contest (BR-04). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const contest = await findContest(idRaw);
  if (!contest) return jsonError("contest not found", 404);
  if (contest.status !== "draft") {
    return jsonError("problems can only be added to draft contests", 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }
  const b = body as Record<string, unknown>;
  const problemId = b.problemId;
  if (typeof problemId !== "number" || !Number.isInteger(problemId) || problemId <= 0) {
    return jsonError("problemId must be a positive integer", 400);
  }

  const problemRows = await db
    .select({ id: problems.id, status: problems.status })
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);
  if (problemRows.length === 0) return jsonError("problem not found", 404);
  if (problemRows[0].status !== "draft") {
    return jsonError("only draft problems can be added to a contest (BR-04)", 400);
  }

  const existing = await db
    .select({ problemId: contestProblems.problemId })
    .from(contestProblems)
    .where(
      and(
        eq(contestProblems.contestId, contest.id),
        eq(contestProblems.problemId, problemId),
      ),
    )
    .limit(1);
  if (existing.length > 0) return jsonError("problem already in contest", 409);

  let position = b.position;
  if (position === undefined) {
    const [row] = await db
      .select({ max: sql<number | null>`max(${contestProblems.position})`.mapWith(Number) })
      .from(contestProblems)
      .where(eq(contestProblems.contestId, contest.id));
    position = (row?.max ?? -1) + 1;
  }
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
    return jsonError("position must be a non-negative integer", 400);
  }

  await db.insert(contestProblems).values({ contestId: contest.id, problemId, position });
  return NextResponse.json({ contestId: contest.id, problemId, position }, { status: 201 });
}

/** Admin: remove a problem from a draft contest. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const contest = await findContest(idRaw);
  if (!contest) return jsonError("contest not found", 404);
  if (contest.status !== "draft") {
    return jsonError("problems can only be removed from draft contests", 400);
  }

  const problemIdRaw = req.nextUrl.searchParams.get("problemId");
  const problemId = Number(problemIdRaw);
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return jsonError("problemId query param must be a positive integer", 400);
  }

  const deleted = await db
    .delete(contestProblems)
    .where(
      and(
        eq(contestProblems.contestId, contest.id),
        eq(contestProblems.problemId, problemId),
      ),
    )
    .returning({ problemId: contestProblems.problemId });
  if (deleted.length === 0) return jsonError("problem not in contest", 404);

  // Compact positions so arena labels stay contiguous.
  const remaining = await db
    .select({ problemId: contestProblems.problemId })
    .from(contestProblems)
    .where(eq(contestProblems.contestId, contest.id))
    .orderBy(asc(contestProblems.position));
  for (let i = 0; i < remaining.length; i++) {
    await db
      .update(contestProblems)
      .set({ position: i })
      .where(
        and(
          eq(contestProblems.contestId, contest.id),
          eq(contestProblems.problemId, remaining[i].problemId),
        ),
      );
  }

  return NextResponse.json({ removed: true });
}
