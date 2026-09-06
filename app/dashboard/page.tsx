import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contestProblems,
  contestRegistrations,
  contests,
  problems,
  submissions,
  users,
} from "@/db/schema";
import Navigation from "@/app/components/Navigation";
import StatCard from "@/app/components/StatCard";

export const dynamic = "force-dynamic";

function formatRemaining(endsAt: Date): string {
  const diffMs = endsAt.getTime() - Date.now();
  if (diffMs <= 0) return "Ended";
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default async function DashboardPage() {
  // @ts-expect-error Clerk auth().protect() is valid at runtime; types lag behind Next 16 proxy renaming
  await auth().protect();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [publishedProblemsRows, liveContestsCountRows, usersCountRows, submissionsTodayRows] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(problems)
        .where(eq(problems.status, "published")),
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(contests)
        .where(eq(contests.status, "live")),
      db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(users),
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(submissions)
        .where(gte(submissions.submittedAt, startOfToday)),
    ]);

  const publishedProblemsCount = publishedProblemsRows[0]?.count ?? 0;
  const liveContestsCount = liveContestsCountRows[0]?.count ?? 0;
  const usersCount = usersCountRows[0]?.count ?? 0;
  const submissionsTodayCount = submissionsTodayRows[0]?.count ?? 0;

  const liveContests = await db
    .select()
    .from(contests)
    .where(eq(contests.status, "live"))
    .orderBy(asc(contests.endsAt))
    .limit(3);

  const contestIds = liveContests.map((c) => c.id);

  const problemCounts =
    contestIds.length > 0
      ? await db
          .select({
            contestId: contestProblems.contestId,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(contestProblems)
          .where(inArray(contestProblems.contestId, contestIds))
          .groupBy(contestProblems.contestId)
      : [];

  const registrationCounts =
    contestIds.length > 0
      ? await db
          .select({
            contestId: contestRegistrations.contestId,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(contestRegistrations)
          .where(inArray(contestRegistrations.contestId, contestIds))
          .groupBy(contestRegistrations.contestId)
      : [];

  const problemCountMap = new Map<number, number>();
  for (const row of problemCounts) {
    problemCountMap.set(row.contestId, row.count);
  }

  const registrationCountMap = new Map<number, number>();
  for (const row of registrationCounts) {
    registrationCountMap.set(row.contestId, row.count);
  }

  const enrichedContests = liveContests.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    endsAt: c.endsAt,
    problemsCount: problemCountMap.get(c.id) ?? 0,
    participantsCount: registrationCountMap.get(c.id) ?? 0,
  }));

  const primaryContestHref =
    enrichedContests.length > 0 ? `/contests/${enrichedContests[0].slug}` : "/contests";

  return (
    <>
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16">
        {/* Hero Section */}
        <section className="flex flex-col items-center text-center py-20 max-w-2xl mx-auto">
          <h1 className="text-5xl font-mono font-bold text-kjprimary text-glow mb-4">KOJ</h1>
          <p className="uppercase font-mono tracking-[0.3em] text-kjtext-muted text-sm mb-4">
            Kottayam Online Judge
          </p>
          <p className="text-kjtext-muted text-base">
            Self-hosted contest hosting platform for IIIT Kottayam
          </p>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
          <StatCard label="TOTAL PROBLEMS" value={publishedProblemsCount} icon="{" accent />
          <StatCard label="ACTIVE CONTESTS" value={liveContestsCount} icon="★" accent />
          <StatCard label="REGISTERED USERS" value={usersCount} icon="@" accent />
          <StatCard label="SUBMISSIONS TODAY" value={submissionsTodayCount} icon="→" />
        </section>

        {/* Active Contests */}
        <section className="mb-20">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="uppercase font-mono tracking-widest text-sm text-kjtext-muted">
              Active Contests
            </h2>
            <div className="h-px flex-1 bg-kjprimary/30" />
          </div>

          {enrichedContests.length === 0 ? (
            <div className="bg-kjsurface border border-kjborder rounded-lg p-8 text-center">
              <p className="text-sm font-mono text-kjtext-muted mb-4">
                No live contests right now. Check back soon or explore the problem archive.
              </p>
              <Link
                href="/problems"
                className="inline-block border border-kjborder text-kjtext font-mono text-xs px-4 py-2 rounded hover:border-kjprimary hover:text-kjprimary transition-colors"
              >
                View All Problems
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {enrichedContests.map((contest) => (
                <Link
                  key={contest.id}
                  href={`/contests/${contest.slug}`}
                  className="bg-kjsurface border border-kjborder rounded-lg p-5 hover:border-kjborder-bright transition-all duration-300"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono font-semibold text-kjtext">{contest.title}</span>
                    <span className="bg-kjprimary/10 text-kjprimary border border-kjprimary/20 rounded-full px-2.5 py-0.5 text-xs font-mono">
                      Live
                    </span>
                  </div>
                  <p className="text-sm text-kjtext-muted mb-4 line-clamp-3">
                    {contest.description || "No description"}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-kjtext-muted">
                    <span>Problems: {contest.problemsCount}</span>
                    <span>Participants: {contest.participantsCount}</span>
                    <span>Time: {formatRemaining(contest.endsAt)} remaining</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* CTA Section */}
        <section className="flex flex-col items-center pb-20">
          <p className="text-lg text-kjtext mb-6">Ready to compete?</p>
          <div className="flex items-center gap-4">
            <Link
              href={primaryContestHref}
              className="bg-kjprimary text-kjbg font-mono font-semibold px-6 py-3 rounded hover:glow-sm transition-all"
            >
              ENTER THE ARENA
            </Link>
            <Link
              href="/problems"
              className="border border-kjborder text-kjtext font-mono px-6 py-3 rounded hover:border-kjprimary hover:text-kjprimary transition-all"
            >
              VIEW ALL PROBLEMS
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
