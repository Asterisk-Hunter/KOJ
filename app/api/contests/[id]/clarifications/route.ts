import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { contestClarifications, contestAnnouncements, contestRegistrations, contests } from "@/db/schema";
import { MAX_CONTEST_REGISTRATION_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { canManageContestCommunication, canReadClarification } from "@/app/api/contests/clarification-policy";
import { resolveOrganizationContext } from "@/lib/organizations";
import { isOfficialContestActive } from "@/app/api/contests/participation-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findContest(idRaw: string, organizationId: number) {
  const numeric = Number(idRaw);
  const byId = Number.isInteger(numeric) && numeric > 0 && String(numeric) === idRaw
    ? await db.select().from(contests).where(and(
        eq(contests.id, numeric),
        eq(contests.organizationId, organizationId),
      )).limit(1)
    : [];
  if (byId[0]) return byId[0];
  const bySlug = await db.select().from(contests).where(and(
    eq(contests.slug, idRaw),
    eq(contests.organizationId, organizationId),
  )).limit(1);
  return bySlug[0] ?? null;
}

async function handleGET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return NextResponse.json({ error: "organization not found" }, { status: 404 });
  const contest = await findContest((await ctx.params).id, organization.organizationId);
  if (!contest) return NextResponse.json({ error: "contest not found" }, { status: 404 });
  if (contest.status === "draft") return NextResponse.json({ error: "contest not found" }, { status: 404 });
  const viewer = { userId, role: organization.role, suspended: organization.suspended };
  const canManage = canManageContestCommunication(viewer);
  const publicQuestions = and(
    eq(contestClarifications.contestId, contest.id),
    eq(contestClarifications.visibility, "public"),
  );
  const conditions = canManage
    ? eq(contestClarifications.contestId, contest.id)
    : userId
    ? or(publicQuestions, and(eq(contestClarifications.contestId, contest.id), eq(contestClarifications.authorId, userId)))
    : publicQuestions;
  const [announcements, clarifications] = await Promise.all([
    db.select({ id: contestAnnouncements.id, body: contestAnnouncements.body, createdAt: contestAnnouncements.createdAt })
      .from(contestAnnouncements).where(eq(contestAnnouncements.contestId, contest.id)).orderBy(desc(contestAnnouncements.createdAt)).limit(50),
    db.select({ id: contestClarifications.id, question: contestClarifications.question, answer: contestClarifications.answer,
      authorId: contestClarifications.authorId, visibility: contestClarifications.visibility, createdAt: contestClarifications.createdAt, answeredAt: contestClarifications.answeredAt })
      .from(contestClarifications).where(conditions).orderBy(desc(contestClarifications.createdAt)).limit(100),
  ]);
  const visibleClarifications = clarifications
    .filter((item) => canReadClarification(viewer, item))
    .map((item) => ({ id: item.id, question: item.question, answer: item.answer, visibility: item.visibility, createdAt: item.createdAt, answeredAt: item.answeredAt }));
  return NextResponse.json({ announcements, clarifications: visibleClarifications, canManage });
}

async function handlePOST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return NextResponse.json({ error: "organization not found" }, { status: 404 });
  if (organization.suspended) return NextResponse.json({ error: "account suspended" }, { status: 403 });
  const contest = await findContest((await ctx.params).id, organization.organizationId);
  if (!contest) return NextResponse.json({ error: "contest not found" }, { status: 404 });
  if (contest.status !== "live" || Date.now() < contest.startsAt.getTime() || Date.now() >= contest.endsAt.getTime()) {
    return NextResponse.json({ error: "questions are accepted only during a live contest" }, { status: 403 });
  }
  const registration = await db.select({ userId: contestRegistrations.userId }).from(contestRegistrations)
    .where(and(eq(contestRegistrations.contestId, contest.id), eq(contestRegistrations.userId, userId))).limit(1);
  if (!registration.length) return NextResponse.json({ error: "contest registration required" }, { status: 403 });
  const parsed = await readBoundedJsonObject(req, MAX_CONTEST_REGISTRATION_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const question = parsed.value.question;
  if (typeof question !== "string" || !question.trim() || question.trim().length > 2000) {
    return NextResponse.json({ error: "question must be 1..2000 characters" }, { status: 400 });
  }
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(contests).where(and(
      eq(contests.id, contest.id), eq(contests.organizationId, organization.organizationId),
    )).limit(1).for("update");
    if (!current || !isOfficialContestActive(current, new Date())) {
      return NextResponse.json({ error: "questions are accepted only during a live contest" }, { status: 403 });
    }
    const [created] = await tx.insert(contestClarifications).values({ contestId: current.id, authorId: userId, question: question.trim() })
      .returning({ id: contestClarifications.id });
    return NextResponse.json({ id: created.id }, { status: 201 });
  });
}

export const GET = withApiGuard(handleGET);
export const POST = withApiGuard(handlePOST);
