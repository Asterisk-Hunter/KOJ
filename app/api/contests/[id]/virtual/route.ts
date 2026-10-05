import { withApiGuard } from "@/app/api/guard";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestVirtualRegistrations, contests } from "@/db/schema";
import { ensureUserRow, jsonError } from "@/app/api/admin/authz";
import { virtualAttemptEndsAt } from "@/app/api/contests/participation-policy";
import { resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return jsonError("unauthorized", 401);
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);
  const numericId = Number((await ctx.params).id);
  if (!Number.isInteger(numericId) || numericId <= 0) return jsonError("invalid contest id", 400);
  const [contest] = await db.select().from(contests).where(and(
    eq(contests.id, numericId),
    eq(contests.organizationId, organization.organizationId),
  )).limit(1);
  if (!contest) return jsonError("contest not found", 404);
  if (contest.status !== "ended" && contest.status !== "archived") return jsonError("virtual participation starts after the contest ends", 409);
  if (!await ensureUserRow(userId)) return jsonError("failed to resolve user", 500);
  const startedAt = new Date();
  const durationMs = contest.endsAt.getTime() - contest.startsAt.getTime();
  const endsAt = virtualAttemptEndsAt(startedAt, durationMs);
  const [created] = await db.insert(contestVirtualRegistrations).values({ contestId: contest.id, userId, startedAt, endsAt })
    .onConflictDoNothing()
    .returning({ startedAt: contestVirtualRegistrations.startedAt, endsAt: contestVirtualRegistrations.endsAt });
  if (!created) return jsonError("virtual attempt already started", 409);
  return Response.json({ startedAt: created.startedAt.toISOString(), endsAt: created.endsAt.toISOString() }, { status: 201 });
}

export const POST = withApiGuard(handlePOST);
