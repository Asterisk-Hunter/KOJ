import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contestProblems,
  contestRegistrations,
  contests,
  problems,
} from "@/db/schema";
import { jsonError, requireContestManager } from "@/app/api/admin/authz";
import {
  lockLinkedProblems,
  nextStatuses,
  releaseLinkedProblems,
  revertLinkedProblems,
  type ContestStatus,
} from "@/app/api/contests/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findContest(idRaw: string) {
  const numeric = Number(idRaw);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const rows = await db.select().from(contests).where(eq(contests.id, numeric)).limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/** Admin: contest detail with ordered problems + registration count. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const contest = await findContest(idRaw);
  if (!contest) return jsonError("contest not found", 404);

  const links = await db
    .select({
      problemId: contestProblems.problemId,
      position: contestProblems.position,
      title: problems.title,
      difficulty: problems.difficulty,
      status: problems.status,
    })
    .from(contestProblems)
    .innerJoin(problems, eq(contestProblems.problemId, problems.id))
    .where(eq(contestProblems.contestId, contest.id))
    .orderBy(asc(contestProblems.position));

  const regs = await db
    .select({ userId: contestRegistrations.userId })
    .from(contestRegistrations)
    .where(eq(contestRegistrations.contestId, contest.id));

  return NextResponse.json({
    id: contest.id,
    slug: contest.slug,
    title: contest.title,
    description: contest.description,
    startsAt: contest.startsAt.toISOString(),
    endsAt: contest.endsAt.toISOString(),
    status: contest.status,
    problems: links,
    registrations: regs.length,
  });
}

type PatchBody = {
  title?: unknown;
  description?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  status?: unknown;
};

/**
 * Admin: edit metadata (draft only) and drive lifecycle transitions:
 * draft->live (publish), live->draft (unpublish before start),
 * live->ended (end now), ended->archived, archived->ended.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const contest = await findContest(idRaw);
  if (!contest) return jsonError("contest not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }
  const b = body as PatchBody;
  const now = new Date();
  const current = contest.status as ContestStatus;

  // --- status transition ---
  if (b.status !== undefined) {
    if (typeof b.status !== "string") return jsonError("status must be a string", 400);
    const target = b.status as ContestStatus;
    if (!nextStatuses(current).includes(target)) {
      return jsonError(`cannot transition ${current} -> ${b.status}`, 400);
    }

    if (current === "draft" && target === "live") {
      const links = await db
        .select({ problemId: contestProblems.problemId })
        .from(contestProblems)
        .where(eq(contestProblems.contestId, contest.id));
      if (links.length === 0) return jsonError("cannot publish a contest with no problems", 400);
      await db
        .update(contests)
        .set({ status: "live", updatedAt: now })
        .where(eq(contests.id, contest.id));
      await lockLinkedProblems(contest.id, now);
      return NextResponse.json({ id: contest.id, status: "live" });
    }

    if (current === "live" && target === "draft") {
      if (now >= contest.startsAt) {
        return jsonError("cannot unpublish after the contest has started", 400);
      }
      await db
        .update(contests)
        .set({ status: "draft", updatedAt: now })
        .where(eq(contests.id, contest.id));
      await revertLinkedProblems(contest.id, now);
      return NextResponse.json({ id: contest.id, status: "draft" });
    }

    if (current === "live" && target === "ended") {
      const endsAt = contest.endsAt.getTime() > now.getTime() ? now : contest.endsAt;
      await db
        .update(contests)
        .set({ status: "ended", endsAt, updatedAt: now })
        .where(eq(contests.id, contest.id));
      await releaseLinkedProblems([contest.id], now);
      return NextResponse.json({ id: contest.id, status: "ended" });
    }

    await db
      .update(contests)
      .set({ status: target, updatedAt: now })
      .where(eq(contests.id, contest.id));
    return NextResponse.json({ id: contest.id, status: target });
  }

  // --- metadata edits: draft only (preserves live/history integrity) ---
  if (current !== "draft") {
    return jsonError("only draft contests can be edited", 400);
  }

  const patch: Partial<typeof contests.$inferInsert> = { updatedAt: now };

  if (b.title !== undefined) {
    if (typeof b.title !== "string" || b.title.trim().length === 0) {
      return jsonError("title must be non-empty", 400);
    }
    if (b.title.trim().length > 200) return jsonError("title too long", 400);
    patch.title = b.title.trim();
  }
  if (b.description !== undefined) {
    if (typeof b.description !== "string") return jsonError("description must be a string", 400);
    if (b.description.length > 5000) return jsonError("description too long", 400);
    patch.description = b.description;
  }

  let startsAt = contest.startsAt;
  let endsAt = contest.endsAt;
  if (b.startsAt !== undefined) {
    if (typeof b.startsAt !== "string") return jsonError("startsAt must be an ISO string", 400);
    startsAt = new Date(b.startsAt);
    if (Number.isNaN(startsAt.getTime())) return jsonError("startsAt must be a valid date", 400);
    patch.startsAt = startsAt;
  }
  if (b.endsAt !== undefined) {
    if (typeof b.endsAt !== "string") return jsonError("endsAt must be an ISO string", 400);
    endsAt = new Date(b.endsAt);
    if (Number.isNaN(endsAt.getTime())) return jsonError("endsAt must be a valid date", 400);
    patch.endsAt = endsAt;
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return jsonError("endsAt must be after startsAt", 400);
  }

  await db.update(contests).set(patch).where(eq(contests.id, contest.id));
  return NextResponse.json({ id: contest.id, status: current });
}

/** Admin: delete a draft contest (links + registrations cascade). */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;

  const { id: idRaw } = await ctx.params;
  const contest = await findContest(idRaw);
  if (!contest) return jsonError("contest not found", 404);
  if (contest.status !== "draft") {
    return jsonError("only draft contests can be deleted", 400);
  }

  await db.delete(contests).where(eq(contests.id, contest.id));
  return NextResponse.json({ deleted: true });
}
