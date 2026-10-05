import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray, not, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contestRegistrations, contests } from "@/db/schema";
import { settleExpiredContests, deriveContestUiStatus } from "@/app/api/contests/lifecycle";
import { resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const MAX_OFFSET = 10_000;

function parsePageValue(raw: string | null, fallback: number, maximum: number): number | null {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximum ? value : null;
}

async function handleGET(request: NextRequest) {
  const { userId } = await auth();
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return NextResponse.json({ error: "organization not found" }, { status: 404 });
  const limit = parsePageValue(request.nextUrl.searchParams.get("limit"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parsePageValue(request.nextUrl.searchParams.get("offset"), 0, MAX_OFFSET);
  if (limit === null || limit < 1) return NextResponse.json({ error: "limit must be between 1 and 200" }, { status: 400 });
  if (offset === null) return NextResponse.json({ error: "offset must be between 0 and 10000" }, { status: 400 });

  await settleExpiredContests(organization.organizationId);

  const contestRows = await db
    .select({
      id: contests.id,
      slug: contests.slug,
      title: contests.title,
      description: contests.description,
      startsAt: contests.startsAt,
      endsAt: contests.endsAt,
      status: contests.status,
    })
    .from(contests)
    .where(and(not(eq(contests.status, "draft")), eq(contests.organizationId, organization.organizationId)))
    .orderBy(asc(contests.startsAt), asc(contests.id))
    .limit(limit)
    .offset(offset);
  const contestIds = contestRows.map((contest) => contest.id);

  // Batch counts
  const problemCounts = contestIds.length === 0 ? [] : await db
    .select({
      contestId: contestProblems.contestId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(contestProblems)
    .where(and(
      eq(contestProblems.organizationId, organization.organizationId),
      inArray(contestProblems.contestId, contestIds),
    ))
    .groupBy(contestProblems.contestId);

  const registrationCounts = contestIds.length === 0 ? [] : await db
    .select({
      contestId: contestRegistrations.contestId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(contestRegistrations)
    .where(inArray(contestRegistrations.contestId, contestIds))
    .groupBy(contestRegistrations.contestId);

  const problemCountMap = new Map<number, number>();
  for (const r of problemCounts) problemCountMap.set(r.contestId, r.count);
  const registrationCountMap = new Map<number, number>();
  for (const r of registrationCounts) registrationCountMap.set(r.contestId, r.count);

  const registeredSet = new Set<number>();
  if (userId && contestIds.length > 0) {
    const regs = await db
      .select({ contestId: contestRegistrations.contestId })
      .from(contestRegistrations)
      .where(and(
        eq(contestRegistrations.userId, userId),
        inArray(contestRegistrations.contestId, contestIds),
      ));
    for (const r of regs) registeredSet.add(r.contestId);
  }

  const now = new Date();
  const result = contestRows.map((c) => {
    const status = deriveContestUiStatus(c.status, c.startsAt, c.endsAt, now);
    return {
      id: c.slug,
      numericId: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      status,
      dbStatus: c.status,
      problems: problemCountMap.get(c.id) ?? 0,
      participants: registrationCountMap.get(c.id) ?? 0,
      registered: registeredSet.has(c.id),
    };
  });

  return NextResponse.json({ contests: result });
}

export const GET = withApiGuard(handleGET);
