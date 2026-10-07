import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestRegistrations, contestTeams, contests, users } from "@/db/schema";
import { settleExpiredContests, contestRequiresInvite } from "@/app/api/contests/lifecycle";
import { hashInviteCode, verifyInviteCode } from "@/app/api/contests/invite-code";
import { canRegisterForContest, teamHasCapacity } from "@/app/api/contests/participation-policy";
import { MAX_CONTEST_REGISTRATION_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class RegistrationClosed extends Error {}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function findContest(idRaw: string, organizationId: number) {
  const numeric = Number(idRaw);
  const isNumeric = Number.isInteger(numeric) && numeric > 0 && String(numeric) === idRaw;
  if (isNumeric) {
    const rows = await db.select().from(contests).where(and(
      eq(contests.id, numeric),
      eq(contests.organizationId, organizationId),
    )).limit(1);
    if (rows.length > 0) return rows[0];
  }
  const slugRows = await db.select().from(contests).where(and(
    eq(contests.slug, idRaw),
    eq(contests.organizationId, organizationId),
  )).limit(1);
  if (slugRows.length > 0) return slugRows[0];
  return null;
}

async function handlePOST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return jsonError("unauthorized", 401);
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);

  const { id: idRaw } = await ctx.params;
  if (!idRaw || typeof idRaw !== "string") return jsonError("invalid id", 400);

  await settleExpiredContests(organization.organizationId);
  const contest = await findContest(idRaw, organization.organizationId);
  if (!contest) return jsonError("contest not found", 404);
  const parsed = await readBoundedJsonObject(req, MAX_CONTEST_REGISTRATION_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  // Invite-based registration (REQ-CONT-02/06): contests with an invite
  // code require the matching code; others are open enrollment.
  // Hashed codes are verified via scrypt; legacy plaintext rows verify by
  // exact match (read-only migration path — never written as plaintext).
  if (contestRequiresInvite(contest)) {
    const inviteCode = body.inviteCode ?? body.invite_code ?? null;
    if (
      !verifyInviteCode(inviteCode, {
        hash: contest.inviteCodeHash ?? null,
        legacy: contest.inviteCode,
      })
    ) {
      return jsonError("invalid invite code", 403);
    }
  }

  const teamName = body.teamName;
  const teamCode = body.teamCode;
  if (teamName !== undefined && teamCode !== undefined) return jsonError("choose teamName or teamCode", 400);
  if (teamName !== undefined && (typeof teamName !== "string" || !teamName.trim() || teamName.trim().length > 80)) {
    return jsonError("teamName must be 1..80 characters", 400);
  }
  if (teamCode !== undefined && (typeof teamCode !== "string" || teamCode.trim().length < 8 || teamCode.trim().length > 64)) {
    return jsonError("teamCode must be 8..64 characters", 400);
  }

  if (!canRegisterForContest(contest, new Date())) return jsonError("registration closed", 403);

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
      }).onConflictDoNothing({ target: users.clerkId });
    } catch {
      return jsonError("failed to resolve user", 500);
    }
  }

  // The contest row serializes roster changes and lifecycle edits. Recheck time
  // and invites after waiting for the lock, not against the earlier snapshot.
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(contests).where(and(
        eq(contests.id, contest.id), eq(contests.organizationId, organization.organizationId),
      )).limit(1).for("update");
      if (!current) return jsonError("contest not found", 404);
      if (!canRegisterForContest(current, new Date())) return jsonError("registration closed", 403);
      if (contestRequiresInvite(current) && !verifyInviteCode(body.inviteCode ?? body.invite_code, {
        hash: current.inviteCodeHash, legacy: current.inviteCode,
      })) return jsonError("invalid invite code", 403);

      const [existing] = await tx.select({ teamId: contestRegistrations.teamId }).from(contestRegistrations)
        .where(and(eq(contestRegistrations.contestId, current.id), eq(contestRegistrations.userId, userId))).limit(1);
      if (existing) return NextResponse.json({ registered: true, already: true, teamId: existing.teamId });

      if (typeof teamName === "string") {
        const secret = randomBytes(18).toString("base64url");
        const joinCodeHash = hashInviteCode(secret);
        if (!canRegisterForContest(current, new Date())) throw new RegistrationClosed();
        const [team] = await tx.insert(contestTeams).values({ contestId: current.id, name: teamName.trim(), joinCodeHash }).returning({ id: contestTeams.id });
        const registeredAt = new Date();
        if (!canRegisterForContest(current, registeredAt)) throw new RegistrationClosed();
        await tx.insert(contestRegistrations).values({ contestId: current.id, userId, teamId: team.id, registeredAt });
        return NextResponse.json({ registered: true, teamName: teamName.trim(), teamJoinCode: `${team.id}.${secret}`, teamId: team.id }, { status: 201 });
      }

      let teamId: number | null = null;
      if (typeof teamCode === "string") {
        const parts = teamCode.trim().split(".");
        const parsedTeamId = Number(parts[0]);
        if (parts.length !== 2 || !Number.isSafeInteger(parsedTeamId) || parsedTeamId <= 0 || !parts[1]) return jsonError("invalid team join code", 403);
        const [team] = await tx.select().from(contestTeams).where(and(eq(contestTeams.contestId, current.id), eq(contestTeams.id, parsedTeamId))).limit(1);
        if (!team || !verifyInviteCode(parts[1], { hash: team.joinCodeHash, legacy: null })) return jsonError("invalid team join code", 403);
        teamId = team.id;
        const [{ count }] = await tx.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(contestRegistrations)
          .where(and(eq(contestRegistrations.contestId, current.id), eq(contestRegistrations.teamId, teamId)));
        if (!teamHasCapacity(count)) return jsonError("team is full (3 members maximum)", 409);
      }
      const registeredAt = new Date();
      if (!canRegisterForContest(current, registeredAt)) throw new RegistrationClosed();
      await tx.insert(contestRegistrations).values({ contestId: current.id, userId, teamId, registeredAt });
      return NextResponse.json({ registered: true, teamId }, { status: 201 });
      });
    } catch (error) {
      if (error instanceof RegistrationClosed) return jsonError("registration closed", 403);
      throw error;
    }
  }

  export const POST = withApiGuard(handlePOST);
