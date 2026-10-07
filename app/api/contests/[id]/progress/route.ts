import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { contests, contestRegistrations, contestVirtualRegistrations, submissions } from "@/db/schema";
import { resolveOrganizationContext } from "@/lib/organizations";
import { isOfficialContestActive } from "@/app/api/contests/participation-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Arena progress counts scored attempts only, isolated from runs and other participation modes. */
async function handleGET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return NextResponse.json({ error: "organization not found" }, { status: 404 });
  if (organization.suspended) return NextResponse.json({ error: "account suspended" }, { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "invalid contest id" }, { status: 400 });
  const [contest] = await db.select().from(contests).where(and(
    eq(contests.id, id), eq(contests.organizationId, organization.organizationId),
  )).limit(1);
  if (!contest) return NextResponse.json({ error: "contest not found" }, { status: 404 });
  let participant = eq(submissions.userId, userId);
  let participation: "official" | "virtual";
  let startsAt: Date;
  let endsAt: Date;
  const now = new Date();
  if (isOfficialContestActive(contest, now)) {
    const [registration] = await db.select({ teamId: contestRegistrations.teamId }).from(contestRegistrations)
      .where(and(eq(contestRegistrations.contestId, id), eq(contestRegistrations.userId, userId))).limit(1);
    if (!registration) return NextResponse.json({ error: "contest registration required" }, { status: 403 });
    if (registration.teamId !== null) participant = eq(submissions.teamId, registration.teamId);
    participation = "official";
    startsAt = contest.startsAt;
    endsAt = contest.endsAt;
  } else if (contest.status === "ended" || contest.status === "archived") {
    const [attempt] = await db.select().from(contestVirtualRegistrations)
      .where(and(eq(contestVirtualRegistrations.contestId, id), eq(contestVirtualRegistrations.userId, userId))).limit(1);
    if (!attempt || now < attempt.startedAt || now >= attempt.endsAt) {
      return NextResponse.json({ error: "active virtual participation required" }, { status: 403 });
    }
    participation = "virtual";
    startsAt = attempt.startedAt;
    endsAt = attempt.endsAt;
  } else {
    return NextResponse.json({ error: "contest is not active" }, { status: 403 });
  }
  const progress = await db.select({
    problemId: submissions.problemId,
    attempts: sql<number>`count(*)`.mapWith(Number),
    isSolved: sql<boolean>`bool_or(${submissions.status} = 'accepted')`,
  }).from(submissions).where(and(
    eq(submissions.organizationId, organization.organizationId), eq(submissions.contestId, id),
    participant, eq(submissions.mode, "submit"), eq(submissions.participation, participation),
    gte(submissions.submittedAt, startsAt), lt(submissions.submittedAt, endsAt),
  )).groupBy(submissions.problemId);
  return NextResponse.json(progress);
}

export const GET = withApiGuard(handleGET);
