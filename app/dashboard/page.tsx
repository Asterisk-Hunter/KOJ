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
  const { userId } = await auth();
  if (!userId) {
    // proxy.ts already gates /dashboard; this is defense-in-depth for
    // resource-based auth (see AGENTS.md — createRouteMatcher is deprecated).
    return <Navigation />;
  }

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

  // Personal contestant statistics
  const [userSubmissions, userAcceptedRows] = await Promise.all([
    db
      .select({
        id: submissions.id,
        problemId: submissions.problemId,
        problemTitle: problems.title,
        status: submissions.status,
        executionTimeMs: submissions.executionTimeMs,
        submittedAt: submissions.submittedAt,
      })
      .from(submissions)
      .leftJoin(problems, eq(submissions.problemId, problems.id))
      .where(eq(submissions.userId, userId))
      .orderBy(sql`${submissions.submittedAt} DESC`)
      .limit(6),
    db
      .select({
        problemId: submissions.problemId,
        difficulty: problems.difficulty,
      })
      .from(submissions)
      .leftJoin(problems, eq(submissions.problemId, problems.id))
      .where(sql`${submissions.userId} = ${userId} AND ${submissions.status} = 'accepted'`),
  ]);

  const solvedProblemMap = new Map<number, string>();
  for (const row of userAcceptedRows) {
    if (row.problemId && !solvedProblemMap.has(row.problemId)) {
      solvedProblemMap.set(row.problemId, row.difficulty ?? "easy");
    }
  }

  const userSolvedTotal = solvedProblemMap.size;
  let userEasy = 0;
  let userMedium = 0;
  let userHard = 0;
  for (const diff of solvedProblemMap.values()) {
    if (diff === "easy") userEasy++;
    else if (diff === "medium") userMedium++;
    else if (diff === "hard") userHard++;
  }

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

        {/* Personal Progress Section (LeetCode/CF style) */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h2 className="uppercase font-mono tracking-widest text-sm text-kjprimary">
                My Progress
              </h2>
              <div className="h-px w-24 bg-kjprimary/30" />
            </div>
            <Link
              href="/submissions"
              className="text-xs font-mono text-kjtext-muted hover:text-kjprimary transition-colors"
            >
              All submissions →
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
              <p className="text-xs font-mono text-kjtext-muted">SOLVED</p>
              <p className="text-3xl font-mono font-bold text-kjprimary mt-2">
                {userSolvedTotal}
                <span className="text-xs text-kjtext-muted font-normal ml-2">/ {publishedProblemsCount}</span>
              </p>
            </div>
            <div className="bg-kjsurface border border-green-500/20 rounded-lg p-5">
              <p className="text-xs font-mono text-green-400">EASY</p>
              <p className="text-3xl font-mono font-bold text-green-400 mt-2">{userEasy}</p>
            </div>
            <div className="bg-kjsurface border border-yellow-500/20 rounded-lg p-5">
              <p className="text-xs font-mono text-yellow-400">MEDIUM</p>
              <p className="text-3xl font-mono font-bold text-yellow-400 mt-2">{userMedium}</p>
            </div>
            <div className="bg-kjsurface border border-red-500/20 rounded-lg p-5">
              <p className="text-xs font-mono text-red-400">HARD</p>
              <p className="text-3xl font-mono font-bold text-red-400 mt-2">{userHard}</p>
            </div>
          </div>

          {/* Recent Activity */}
          {userSubmissions.length > 0 && (
            <div className="bg-kjsurface border border-kjborder rounded-lg p-5">
              <div className="flex justify-between items-center mb-4">
                <p className="text-xs uppercase font-mono text-kjtext-muted tracking-wider">Recent Submissions</p>
                <Link href="/submissions" className="text-xs font-mono text-kjprimary hover:underline">
                  View full history →
                </Link>
              </div>
              <div className="divide-y divide-kjborder/60 text-xs font-mono">
                {userSubmissions.map((s) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`border rounded-full px-2 py-0.5 text-[10px] uppercase ${
                          s.status === "accepted"
                            ? "text-green-400 border-green-400/20 bg-green-400/10"
                            : "text-red-400 border-red-400/20 bg-red-400/10"
                        }`}
                      >
                        {s.status.replaceAll("_", " ")}
                      </span>
                      <Link
                        href={`/problems/${s.problemId}`}
                        className="text-kjtext hover:text-kjprimary truncate font-sans font-medium"
                      >
                        {s.problemTitle ?? `Problem #${s.problemId}`}
                      </Link>
                    </div>
                    <div className="flex items-center gap-4 text-kjtext-muted shrink-0">
                      {s.executionTimeMs !== null && <span>{s.executionTimeMs} ms</span>}
                      <Link
                        href={`/submissions/${s.id}`}
                        className="text-kjprimary hover:underline text-[11px]"
                      >
                        #{s.id}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
