import { withApiGuard } from "@/app/api/guard";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestVirtualRegistrations, contests } from "@/db/schema";
import { ensureUserRow, jsonError } from "@/app/api/admin/authz";
import { canStartVirtualAttempt, virtualAttemptEndsAt } from "@/app/api/contests/participation-policy";
import { resolveOrganizationContext } from "@/lib/organizations";
import { settleExpiredContests } from "@/app/api/contests/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return jsonError("unauthorized", 401);
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);
  const { id } = await ctx.params;
  if (!id) return jsonError("invalid contest id", 400);
  await settleExpiredContests(organization.organizationId);
  if (!await ensureUserRow(userId)) return jsonError("failed to resolve user", 500);
  return db.transaction(async (tx) => {
    const numericId = Number(id);
    const isNumericId = Number.isSafeInteger(numericId) && numericId > 0 && String(numericId) === id;
    let contest = isNumericId ? (await tx.select().from(contests).where(and(
      eq(contests.id, numericId), eq(contests.organizationId, organization.organizationId),
    )).limit(1).for("update"))[0] : undefined;
    if (!contest) contest = (await tx.select().from(contests).where(and(
      eq(contests.slug, id), eq(contests.organizationId, organization.organizationId),
    )).limit(1).for("update"))[0];
    if (!contest) return jsonError("contest not found", 404);
    const startedAt = new Date();
    if (!canStartVirtualAttempt(contest, startedAt)) return jsonError("virtual participation requires an ended contest with a positive duration", 409);
    const endsAt = virtualAttemptEndsAt(startedAt, contest.endsAt.getTime() - contest.startsAt.getTime());
    const [created] = await tx.insert(contestVirtualRegistrations).values({ contestId: contest.id, userId, startedAt, endsAt })
      .onConflictDoNothing()
      .returning({ startedAt: contestVirtualRegistrations.startedAt, endsAt: contestVirtualRegistrations.endsAt });
    if (!created) return jsonError("virtual attempt already started", 409);
    return Response.json({ startedAt: created.startedAt.toISOString(), endsAt: created.endsAt.toISOString() }, { status: 201 });
  });
}

export const POST = withApiGuard(handlePOST);
