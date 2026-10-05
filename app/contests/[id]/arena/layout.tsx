import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { contestRegistrations, contests } from "@/db/schema";
import { resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ArenaLayout({
  children,
  params,
}: LayoutProps<"/contests/[id]/arena">) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/contests/${id}/arena`)}`);
  }
  const organization = await resolveOrganizationContext(userId);
  if (!organization || organization.suspended) notFound();

  const numericId = Number(id);
  const isNumericId = Number.isInteger(numericId) && numericId > 0 && String(numericId) === id;
  let contest = isNumericId
    ? (
        await db
          .select({ id: contests.id, status: contests.status, startsAt: contests.startsAt, endsAt: contests.endsAt })
          .from(contests)
          .where(and(eq(contests.id, numericId), eq(contests.organizationId, organization.organizationId)))
          .limit(1)
      )[0]
    : undefined;

  if (!contest) {
    contest = (
      await db
        .select({ id: contests.id, status: contests.status, startsAt: contests.startsAt, endsAt: contests.endsAt })
        .from(contests)
        .where(and(eq(contests.slug, id), eq(contests.organizationId, organization.organizationId)))
        .limit(1)
    )[0];
  }

  if (!contest) notFound();

  const now = Date.now();
  const isLive = contest.status === "live" &&
    now >= contest.startsAt.getTime() &&
    now < contest.endsAt.getTime();
  if (!isLive) redirect(`/contests/${encodeURIComponent(id)}`);

  const registrations = await db
    .select({ contestId: contestRegistrations.contestId })
    .from(contestRegistrations)
    .where(
      and(
        eq(contestRegistrations.contestId, contest.id),
        eq(contestRegistrations.userId, userId),
      ),
    )
    .limit(1);

  if (registrations.length === 0) {
    redirect(`/contests/${encodeURIComponent(id)}`);
  }

  return children;
}
