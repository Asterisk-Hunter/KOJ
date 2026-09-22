import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contestRegistrations, contests, problems } from "@/db/schema";
import { settleExpiredContests, deriveContestUiStatus, contestRequiresInvite } from "@/app/api/contests/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function findContest(idRaw: string) {
  const numeric = Number(idRaw);
  const isNumeric = Number.isInteger(numeric) && numeric > 0 && String(numeric) === idRaw;

  if (isNumeric) {
    const rows = await db.select().from(contests).where(eq(contests.id, numeric)).limit(1);
    if (rows.length > 0) return rows[0];
  }
  const slugRows = await db.select().from(contests).where(eq(contests.slug, idRaw)).limit(1);
  if (slugRows.length > 0) return slugRows[0];
  return null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  if (!idRaw || typeof idRaw !== "string") return jsonError("invalid id", 400);

  await settleExpiredContests();
  const contest = await findContest(idRaw);
  if (!contest) return jsonError("contest not found", 404);

  const { userId } = await auth();

  const now = new Date();
  const status = deriveContestUiStatus(contest.status, contest.startsAt, contest.endsAt, now);

  // participants count
  const partRows = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(contestRegistrations)
    .where(eq(contestRegistrations.contestId, contest.id));
  const participants = partRows[0]?.count ?? 0;

  // registered check
  let registered = false;
  if (userId) {
    const reg = await db
      .select()
      .from(contestRegistrations)
      .where(
        and(
          eq(contestRegistrations.contestId, contest.id),
          eq(contestRegistrations.userId, userId),
        ),
      )
      .limit(1);
    registered = reg.length > 0;
  }

  // ordered contest problems
  const cpRows = await db
    .select()
    .from(contestProblems)
    .where(eq(contestProblems.contestId, contest.id))
    .orderBy(asc(contestProblems.position));

  const isPublic = (contest.status === "live" && now >= contest.startsAt) || contest.status === "ended" || contest.status === "archived";

  type ProblemOut = {
    id: number;
    title: string;
    difficulty: string;
    tags: string[];
    position: number;
    statement?: string;
    inputFormat?: string;
    outputFormat?: string;
    constraints?: string;
    explanation?: string | null;
    timeLimitMs?: number;
    memoryLimitMb?: number;
    status?: string;
  };

  const problemList: ProblemOut[] = [];

  for (const cp of cpRows) {
    const pRows = await db.select().from(problems).where(eq(problems.id, cp.problemId)).limit(1);
    if (pRows.length === 0) continue;
    const p = pRows[0];
    if (isPublic) {
      problemList.push({
        id: p.id,
        title: p.title,
        difficulty: p.difficulty,
        tags: p.tags,
        position: cp.position,
        statement: p.statement,
        inputFormat: p.inputFormat,
        outputFormat: p.outputFormat,
        constraints: p.constraints,
        explanation: p.explanation,
        timeLimitMs: p.timeLimitMs,
        memoryLimitMb: p.memoryLimitMb,
        status: p.status,
      });
    } else {
      problemList.push({
        id: p.id,
        title: `Problem ${String.fromCharCode(64 + cp.position)}`,
        difficulty: p.difficulty,
        tags: p.tags,
        position: cp.position,
        // statements and titles withheld pre-start
        status: p.status,
      });
    }
  }

  // Ensure sorted by position already
  problemList.sort((a, b) => a.position - b.position);

  return NextResponse.json({
    id: contest.slug,
    numericId: contest.id,
    slug: contest.slug,
    title: contest.title,
    description: contest.description,
    startsAt: contest.startsAt.toISOString(),
    endsAt: contest.endsAt.toISOString(),
    status,
    dbStatus: contest.status,
    problems: problemList,
    problemsCount: problemList.length,
    participants,
    registered,
    inviteRequired: contestRequiresInvite(contest),
    currentUserId: userId ?? null,
  });
}
