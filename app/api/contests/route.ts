import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contestRegistrations, contests } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UiStatus = "Active" | "Registration Open" | "Upcoming" | "Finished";

function deriveUiStatus(
  dbStatus: string,
  startsAt: Date,
  endsAt: Date,
  now: Date = new Date(),
): UiStatus {
  if (dbStatus === "archived" || dbStatus === "ended") return "Finished";
  if (dbStatus === "live") {
    if (now >= startsAt && now <= endsAt) return "Active";
    if (now < startsAt) return "Registration Open";
    return "Finished";
  }
  // draft
  if (now < startsAt) {
    const diff = startsAt.getTime() - now.getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (diff <= sevenDays) return "Registration Open";
    return "Upcoming";
  }
  if (now >= startsAt && now <= endsAt) return "Registration Open";
  return "Finished";
}

export async function GET() {
  const { userId } = await auth();

  const contestRows = await db
    .select()
    .from(contests)
    .orderBy(asc(contests.startsAt));

  // Batch counts
  const problemCounts = await db
    .select({
      contestId: contestProblems.contestId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(contestProblems)
    .groupBy(contestProblems.contestId);

  const registrationCounts = await db
    .select({
      contestId: contestRegistrations.contestId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(contestRegistrations)
    .groupBy(contestRegistrations.contestId);

  const problemCountMap = new Map<number, number>();
  for (const r of problemCounts) problemCountMap.set(r.contestId, r.count);
  const registrationCountMap = new Map<number, number>();
  for (const r of registrationCounts) registrationCountMap.set(r.contestId, r.count);

  const registeredSet = new Set<number>();
  if (userId) {
    const regs = await db
      .select({ contestId: contestRegistrations.contestId })
      .from(contestRegistrations)
      .where(eq(contestRegistrations.userId, userId));
    for (const r of regs) registeredSet.add(r.contestId);
  }

  const now = new Date();
  const result = contestRows.map((c) => {
    const status = deriveUiStatus(c.status, c.startsAt, c.endsAt, now);
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
