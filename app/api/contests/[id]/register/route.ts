import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestRegistrations, contests, users } from "@/db/schema";
import { settleExpiredContests } from "@/app/api/contests/lifecycle";

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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return jsonError("unauthorized", 401);

  const { id: idRaw } = await ctx.params;
  if (!idRaw || typeof idRaw !== "string") return jsonError("invalid id", 400);

  await settleExpiredContests();
  const contest = await findContest(idRaw);
  if (!contest) return jsonError("contest not found", 404);

  // Invite-based registration (REQ-CONT-02/06): contests with an invite
  // code require the matching code; others are open enrollment.
  if (contest.inviteCode !== null) {
    let inviteCode: unknown = null;
    try {
      const body = (await req.json()) as Record<string, unknown>;
      inviteCode = body.inviteCode ?? body.invite_code ?? null;
    } catch {
      inviteCode = null;
    }
    if (typeof inviteCode !== "string" || inviteCode !== contest.inviteCode) {
      return jsonError("invalid invite code", 403);
    }
  }

  const now = new Date();

  // BR-06: A user can only register for a contest before it starts.
  if (now >= contest.startsAt) {
    return jsonError("registration closed: contest has already started", 403);
  }
  if (contest.status === "ended" || contest.status === "archived") {
    return jsonError("registration closed", 403);
  }

  // Ensure users row exists via clerkClient exactly as submission route
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (existingUser.length === 0) {
    try {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const primaryEmail =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ??
        clerkUser.emailAddresses[0]?.emailAddress ??
        "";
      const username =
        clerkUser.username ??
        clerkUser.firstName ??
        (primaryEmail ? primaryEmail.split("@")[0] : userId);
      const email = primaryEmail || `${userId}@placeholder.local`;
      if (!username || !email) return jsonError("failed to resolve user", 500);
      await db.insert(users).values({
        clerkId: userId,
        username,
        email,
      });
    } catch {
      return jsonError("failed to resolve user", 500);
    }
  }

  // Check already registered
  const existingReg = await db
    .select()
    .from(contestRegistrations)
    .where(
      and(
        eq(contestRegistrations.contestId, contest.id),
        eq(contestRegistrations.userId, userId),
      ),
    )
    .limit(1);
  if (existingReg.length > 0) {
    return NextResponse.json({ registered: true, already: true });
  }

  // Insert registration idempotently
  try {
    await db
      .insert(contestRegistrations)
      .values({
        contestId: contest.id,
        userId,
      })
      .onConflictDoNothing();
  } catch {
    return jsonError("failed to register", 500);
  }

  return NextResponse.json({ registered: true });
}
