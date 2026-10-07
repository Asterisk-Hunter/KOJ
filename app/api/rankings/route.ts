import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contestRegistrations, contestTeams, contestVirtualRegistrations, contests, problems, submissions, users } from "@/db/schema";
import { getRedis } from "@/lib/redis";
import { countWrongBefore, penaltyMinutesForSolve } from "@/lib/scoring";
import { getScoreboardFreezeAt, selectRevealedSubmissionIds } from "@/app/api/contests/scoreboard-policy";
import { auth } from "@clerk/nextjs/server";
import { resolveOrganizationContext } from "@/lib/organizations";
import { readStandingsCache, standingsCacheEntry, standingsVersion, type StandingsPayload } from "./cache";
import { MAX_STANDINGS_CELLS, MAX_STANDINGS_PROBLEMS, MAX_STANDINGS_ROWS } from "./limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

const STANDINGS_CACHE_TTL = 8; // seconds — short enough for live contests


// Standard ICPC / DOMjudge balloon color palette
export const BALLOON_PALETTE = [
  { name: "Red", hex: "#ef4444", bg: "bg-red-500", text: "text-red-400", border: "border-red-500/30" },
  { name: "Green", hex: "#22c55e", bg: "bg-green-500", text: "text-green-400", border: "border-green-500/30" },
  { name: "Blue", hex: "#3b82f6", bg: "bg-blue-500", text: "text-blue-400", border: "border-blue-500/30" },
  { name: "Yellow", hex: "#eab308", bg: "bg-yellow-500", text: "text-yellow-400", border: "border-yellow-500/30" },
  { name: "Purple", hex: "#a855f7", bg: "bg-purple-500", text: "text-purple-400", border: "border-purple-500/30" },
  { name: "Orange", hex: "#f97316", bg: "bg-orange-500", text: "text-orange-400", border: "border-orange-500/30" },
  { name: "Cyan", hex: "#06b6d4", bg: "bg-cyan-500", text: "text-cyan-400", border: "border-cyan-500/30" },
  { name: "Pink", hex: "#ec4899", bg: "bg-pink-500", text: "text-pink-400", border: "border-pink-500/30" },
  { name: "Emerald", hex: "#10b981", bg: "bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/30" },
  { name: "Indigo", hex: "#6366f1", bg: "bg-indigo-500", text: "text-indigo-400", border: "border-indigo-500/30" },
  { name: "Amber", hex: "#f59e0b", bg: "bg-amber-500", text: "text-amber-400", border: "border-amber-500/30" },
  { name: "Rose", hex: "#f43f5e", bg: "bg-rose-500", text: "text-rose-400", border: "border-rose-500/30" },
];

export type PerProblemStanding = {
  problemId: number;
  status: "AC" | "WA" | "PENDING" | "--";
  attempts: number;
  penaltyMinutes: number | null;
  isFirstToSolve: boolean;
  timeMinutes: number | null;
  pendingAttempts?: number;
};

type StandingRow = {
  rank: number;
  userId: string;
  username: string;
  solvedCount: number;
  penalty: number;
  perProblem: PerProblemStanding[];
};

async function contestVisibilityDenial(
  contest: Pick<typeof contests.$inferSelect, "id" | "status" | "startsAt" | "endsAt">,
  userId: string | null,
): Promise<NextResponse | null> {
  if (contest.status !== "live" && contest.status !== "ended" && contest.status !== "archived") {
    return jsonError("contest not found or not visible", 404);
  }
  const now = Date.now();
  if (now < contest.startsAt.getTime()) return jsonError("contest has not started", 403);
  // Match contest detail's problem visibility. Expired live rows are safe to
  // expose after the end boundary while lifecycle settlement catches up.
  if (contest.status === "live" && now < contest.endsAt.getTime()) {
    if (!userId) return jsonError("not registered for contest", 403);
    const [registration] = await db.select({ userId: contestRegistrations.userId }).from(contestRegistrations)
      .where(and(eq(contestRegistrations.contestId, contest.id), eq(contestRegistrations.userId, userId))).limit(1);
    if (!registration) return jsonError("not registered for contest", 403);
  }
  return null;
}

async function handleGET(req: NextRequest) {
  const { userId } = await auth();
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);
  const contestIdRaw = req.nextUrl.searchParams.get("contestId");
  if (!contestIdRaw) {
    return jsonError("contestId is required", 400);
  }
  const contestId = Number(contestIdRaw);
  if (!Number.isSafeInteger(contestId) || contestId <= 0) {
    return jsonError("contestId must be a positive integer", 400);
  }
  const virtualRaw = req.nextUrl.searchParams.get("virtual");
  if (virtualRaw !== null && virtualRaw !== "0" && virtualRaw !== "1") return jsonError("virtual must be 0 or 1", 400);
  const virtual = virtualRaw === "1";

  const contestRows = await db
    .select()
    .from(contests)
    .where(and(eq(contests.id, contestId), eq(contests.organizationId, organization.organizationId)))
    .limit(1);
  if (contestRows.length === 0) {
    return jsonError("contest not found", 404);
  }
  let contest = contestRows[0];

  const initialDenial = await contestVisibilityDenial(contest, userId);
  if (initialDenial) return initialDenial;
  if (virtual && contest.status !== "ended" && contest.status !== "archived") {
    return jsonError("virtual standings are available after the contest ends", 409);
  }

  const redis = getRedis();
  const cacheKey = `standings:${organization.organizationId}:${contestId}:${virtual ? "virtual" : "official"}`;

  const cpRows = await db
    .select({
      contestId: contestProblems.contestId,
      problemId: contestProblems.problemId,
      position: contestProblems.position,
      problemTitle: problems.title,
    })
    .from(contestProblems)
    .innerJoin(problems, eq(contestProblems.problemId, problems.id))
    .where(and(eq(contestProblems.contestId, contestId), eq(contestProblems.organizationId, organization.organizationId)))
    .orderBy(asc(contestProblems.position))
    .limit(MAX_STANDINGS_PROBLEMS + 1);
  if (cpRows.length > MAX_STANDINGS_PROBLEMS) {
    return jsonError(`standings exceed the ${MAX_STANDINGS_PROBLEMS}-problem limit`, 503);
  }

  if (cpRows.length === 0) {
    return NextResponse.json({
      contest: {
        id: contest.id,
        title: contest.title,
        status: contest.status,
        startsAt: contest.startsAt.toISOString(),
        endsAt: contest.endsAt.toISOString(),
        isFrozen: false,
        freezeMode: contest.scoreboardFreezeMode,
        participation: virtual ? "virtual" : "official",
        freezeMinutesRemaining: 0,
        revealedAfterFreeze: contest.scoreboardRevealCount,
      },
      problems: [],
      rows: [],
      summary: [],
    });
  }

  const problemIds = cpRows.map((r) => r.problemId);

  const virtualRegistrations = virtual
    ? await db.select({ userId: contestVirtualRegistrations.userId, startedAt: contestVirtualRegistrations.startedAt, endsAt: contestVirtualRegistrations.endsAt })
      .from(contestVirtualRegistrations).where(eq(contestVirtualRegistrations.contestId, contestId)).limit(MAX_STANDINGS_ROWS + 1)
    : [];
  if (virtualRegistrations.length > MAX_STANDINGS_ROWS) {
    return NextResponse.json({ error: "standings exceed the supported contest size" }, { status: 503 });
  }
  const virtualStartByUser = new Map(virtualRegistrations.map((registration) => [registration.userId, registration.startedAt.getTime()]));
  const boundedSubmissionRows = await db
    .select({
      id: submissions.id,
      userId: submissions.userId,
      problemId: submissions.problemId,
      teamId: submissions.teamId,
      status: submissions.status,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .where(and(
      eq(submissions.organizationId, organization.organizationId),
      eq(submissions.contestId, contestId),
      eq(submissions.mode, "submit"),
      eq(submissions.participation, virtual ? "virtual" : "official"),
    ))
    .limit(MAX_STANDINGS_ROWS + 1);
  if (boundedSubmissionRows.length > MAX_STANDINGS_ROWS) {
    return NextResponse.json({ error: "standings exceed the supported contest size" }, { status: 503 });
  }
  // Refresh visibility metadata after reading verdicts: a freeze/reveal edit
  // during those reads must not be combined with the old visibility policy.
  const [currentContest] = await db.select().from(contests).where(and(
    eq(contests.id, contestId), eq(contests.organizationId, organization.organizationId),
  )).limit(1);
  if (!currentContest) return jsonError("contest not found or not visible", 404);
  const currentDenial = await contestVisibilityDenial(currentContest, userId);
  if (currentDenial) return currentDenial;
  if (virtual && currentContest.status !== "ended" && currentContest.status !== "archived") {
    return jsonError("virtual standings are available after the contest ends", 409);
  }
  contest = currentContest;
  const virtualWindowByUser = new Map(virtualRegistrations.map((registration) => [registration.userId, registration]));
  const allSubmissionRows = boundedSubmissionRows.filter((submission) => {
    const window = virtual ? virtualWindowByUser.get(submission.userId) : { startedAt: contest.startsAt, endsAt: contest.endsAt };
    return window !== undefined && submission.submittedAt >= window.startedAt && submission.submittedAt < window.endsAt;
  });
  const standingIdFor = (submission: typeof allSubmissionRows[number]) =>
    virtual || submission.teamId === null ? submission.userId : `team:${submission.teamId}`;
  const problemIdSet = new Set(problemIds);
  const standingIds = new Set(allSubmissionRows.filter((submission) => problemIdSet.has(submission.problemId)).map(standingIdFor));
  if (virtual) {
    for (const registration of virtualRegistrations) standingIds.add(registration.userId);
  }
  // Preflight before scoring, display-name reads, cache fingerprinting, or any
  // dense per-problem allocation. Count the exact rows the grouping below emits.
  if (standingIds.size * problemIds.length > MAX_STANDINGS_CELLS) {
    return jsonError(`standings exceed the ${MAX_STANDINGS_CELLS}-cell limit (${standingIds.size} standing rows × ${problemIds.length} problems)`, 503);
  }
  const nowMs = Date.now();

  const freezeAt = getScoreboardFreezeAt(
    contest.scoreboardFreezeMode,
    contest.scoreboardFrozenAt,
    contest.startsAt,
    contest.endsAt,
  );
  const effectiveFreezeAt = virtual ? null : freezeAt;
  const revealedSubmissionIds = selectRevealedSubmissionIds(
    allSubmissionRows.map((submission) => ({ id: submission.id, submittedAt: submission.submittedAt })),
    effectiveFreezeAt,
    contest.scoreboardRevealCount,
  );
  const automaticFreezeActive = !virtual && contest.scoreboardFreezeMode === "automatic" && contest.status === "live" &&
    freezeAt !== null && nowMs >= freezeAt.getTime() && nowMs < contest.endsAt.getTime();
  const stagedFreezeActive = !virtual && contest.scoreboardFreezeMode === "frozen" &&
    (contest.status === "live" || allSubmissionRows.some((submission) => freezeAt !== null && submission.submittedAt >= freezeAt && !revealedSubmissionIds.has(submission.id)));
  const isFrozen = automaticFreezeActive || stagedFreezeActive;
  const hiddenSubmissionIds = new Set(allSubmissionRows.filter((submission) =>
    isFrozen && effectiveFreezeAt !== null && submission.submittedAt >= effectiveFreezeAt && !revealedSubmissionIds.has(submission.id),
  ).map((submission) => submission.id));
  const submissionRows = allSubmissionRows.map((submission) =>
    hiddenSubmissionIds.has(submission.id) ? { ...submission, status: "running" as const } : submission,
  );

  const submittedUserIds = [...new Set([...submissionRows.map((s) => s.userId), ...virtualRegistrations.map((registration) => registration.userId)])];
  const userMap = new Map<string, string>();
  if (submittedUserIds.length > 0) {
    const userRows = await db
      .select({ clerkId: users.clerkId, username: users.username })
      .from(users)
      .where(inArray(users.clerkId, submittedUserIds));
    for (const u of userRows) {
      userMap.set(u.clerkId, u.username);
    }
  }

  const teamIds = [...new Set(submissionRows.flatMap((submission) => submission.teamId === null ? [] : [submission.teamId]))];
  const standingNameMap = new Map(userMap);
  if (teamIds.length > 0) {
    const teamRows = await db.select({ id: contestTeams.id, name: contestTeams.name }).from(contestTeams).where(inArray(contestTeams.id, teamIds));
    for (const team of teamRows) standingNameMap.set(`team:${team.id}`, team.name);
  }

  const contestStartMs = contest.startsAt.getTime();
  const contestEndMs = contest.endsAt.getTime();
  const responseContest: StandingsPayload["contest"] = {
    id: contest.id, title: contest.title, status: contest.status,
    startsAt: contest.startsAt.toISOString(), endsAt: contest.endsAt.toISOString(),
    isFrozen, freezeMode: contest.scoreboardFreezeMode,
    participation: virtual ? "virtual" : "official",
    freezeMinutesRemaining: isFrozen ? Math.max(0, Math.ceil((contestEndMs - nowMs) / 60000)) : 0,
    revealedAfterFreeze: contest.scoreboardRevealCount,
  };
  // Fingerprint the bounded authoritative inputs, including verdicts (not just
  // submission/completion counts). This also detects rejudge and team edits.
  const cacheVersion = redis && !isFrozen ? standingsVersion({
    organizationId: organization.organizationId,
    contest: responseContest,
    updatedAt: contest.updatedAt,
    frozenAt: contest.scoreboardFrozenAt,
    problems: cpRows,
    submissions: [...allSubmissionRows].sort((a, b) => a.id - b.id),
    virtualRegistrations: [...virtualRegistrations].sort((a, b) => a.userId.localeCompare(b.userId)),
    names: [...standingNameMap].sort(([a], [b]) => a.localeCompare(b)),
  }) : "";
  // Never rely on cached visibility during an official freeze/reveal. Cache
  // keys remain compatible with the contest agent's invalidation paths.
  if (redis && !isFrozen) {
    try {
      const cached = readStandingsCache(await redis.get(cacheKey), cacheVersion, responseContest, Date.now());
      if (cached) return NextResponse.json(cached);
    } catch { /* Optional cache failure falls back to authoritative standings. */ }
  }

  // Group submissions by userId -> problemId -> sorted list
  const byUserProblem = new Map<string, Map<number, typeof submissionRows>>();
  for (const s of submissionRows) {
    if (!problemIdSet.has(s.problemId)) continue;
    const standingId = standingIdFor(s);
    let m = byUserProblem.get(standingId);
    if (!m) {
      m = new Map<number, typeof submissionRows>();
      byUserProblem.set(standingId, m);
    }
    let list = m.get(s.problemId);
    if (!list) {
      list = [];
      m.set(s.problemId, list);
    }
    list.push(s);
  }

  // Sort each list by submittedAt asc
  for (const [, m] of byUserProblem) {
    for (const [, list] of m) {
      list.sort((a, b) => {
        const ta = a.submittedAt ? a.submittedAt.getTime() : 0;
        const tb = b.submittedAt ? b.submittedAt.getTime() : 0;
        if (ta !== tb) return ta - tb;
        return a.id - b.id;
      });
    }
  }

  if (virtual) {
    for (const registration of virtualRegistrations) {
      if (!byUserProblem.has(registration.userId)) byUserProblem.set(registration.userId, new Map<number, typeof submissionRows>());
    }
  }

  // Detect First-to-Solve (First AC) per problem across entire contest
  // If scoreboard is currently frozen, post-freeze solves are masked until contest ends
  const firstSolverByProblem = new Map<number, { userId: string; submittedAtMs: number }>();
  for (const [standingId, m] of byUserProblem) {
    for (const [pid, list] of m) {
      for (const s of list) {
        if (s.status === "accepted") {
          const subMs = s.submittedAt ? s.submittedAt.getTime() : contestStartMs;

          const currentFirst = firstSolverByProblem.get(pid);
          if (!currentFirst || subMs < currentFirst.submittedAtMs) {
            firstSolverByProblem.set(pid, { userId: standingId, submittedAtMs: subMs });
          }
          break; // First AC for this user on this problem
        }
      }
    }
  }

  const standings: StandingRow[] = [];
  for (const [userId, probMap] of byUserProblem) {
    const username = userId.startsWith("team:") ? standingNameMap.get(userId) ?? userId : userMap.get(userId) ?? userId;
    let solvedCount = 0;
    let penalty = 0;
    const perProblem: PerProblemStanding[] = [];

    for (const pid of problemIds) {
      const list = probMap.get(pid) ?? [];
      if (list.length === 0) {
        perProblem.push({
          problemId: pid,
          status: "--",
          attempts: 0,
          penaltyMinutes: null,
          isFirstToSolve: false,
          timeMinutes: null,
        });
        continue;
      }

      // Check if problem was already accepted
      let firstAcIndex = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].status === "accepted") {
          firstAcIndex = i;
          break;
        }
      }

      const firstSolver = firstSolverByProblem.get(pid);
      const isFirst = !virtual && (firstSolver?.userId === userId || firstSolver?.userId === `user:${userId}`);

      if (firstAcIndex === -1) {
        // Hidden rows have already been masked once; explicitly revealed
        // post-freeze verdicts must stay visible to scoring and first-to-solve.
        const pendingAttempts = list.filter((s) => s.status === "pending" || s.status === "running").length;

        if (pendingAttempts > 0) {
          perProblem.push({
            problemId: pid,
            status: "PENDING",
            attempts: list.length,
            penaltyMinutes: null,
            isFirstToSolve: false,
            timeMinutes: null,
            pendingAttempts,
          });
        } else {
          perProblem.push({
            problemId: pid,
            status: "WA",
            attempts: list.length,
            penaltyMinutes: null,
            isFirstToSolve: false,
            timeMinutes: null,
          });
        }
      } else {
        const firstAc = list[firstAcIndex];
        const submittedAtMs = firstAc.submittedAt ? firstAc.submittedAt.getTime() : contestStartMs;


        const statusesBefore = list
          .slice(0, firstAcIndex)
          .map((s) => s.status);
        const wrongBefore = countWrongBefore(statusesBefore);
        const participantStartMs = virtualStartByUser.get(userId) ?? contestStartMs;
        const minutes = Math.max(0, Math.floor((submittedAtMs - participantStartMs) / 60000));
        const penaltyMinutes = penaltyMinutesForSolve(minutes, wrongBefore);
        solvedCount += 1;
        penalty += penaltyMinutes;

        perProblem.push({
          problemId: pid,
          status: "AC",
          attempts: firstAcIndex + 1,
          penaltyMinutes,
          isFirstToSolve: isFirst,
          timeMinutes: minutes,
        });
      }
    }

    standings.push({ rank: 0, userId: userId.startsWith("team:") ? userId : `user:${userId}`, username, solvedCount, penalty, perProblem });
  }

  standings.sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
    return a.penalty - b.penalty;
  });

  for (let i = 0; i < standings.length; i++) {
    standings[i].rank = i + 1;
  }

  // Metadata for problem headers and summary bar
  const problemsMeta = cpRows.map((cp, idx) => {
    const balloon = BALLOON_PALETTE[idx % BALLOON_PALETTE.length];
    return {
      problemId: cp.problemId,
      title: cp.problemTitle,
      position: cp.position,
      label: String.fromCharCode(65 + idx),
      balloonColor: balloon.hex,
      balloonName: balloon.name,
      balloonClass: balloon.bg,
    };
  });

  // Calculate per-problem summary statistics (DOMjudge style bottom row)
  const problemSummary = problemsMeta.map((p) => {
    let totalSolved = 0;
    let totalAttempts = 0;
    for (const s of standings) {
      const prob = s.perProblem.find((item) => item.problemId === p.problemId);
      if (prob) {
        if (prob.status === "AC") totalSolved += 1;
        totalAttempts += prob.attempts;
      }
    }
    const firstSolver = firstSolverByProblem.get(p.problemId);
    const firstSolveMinutes = !virtual && firstSolver
      ? Math.max(0, Math.floor((firstSolver.submittedAtMs - contestStartMs) / 60000))
      : null;
    return {
      problemId: p.problemId,
      label: p.label,
      totalSolved,
      totalAttempts,
      firstSolveMinutes,
      acceptanceRate: totalAttempts > 0 ? Math.round((totalSolved / totalAttempts) * 100) : 0,
    };
  });

  const responsePayload: StandingsPayload = {
    contest: responseContest,
    problems: problemsMeta,
    summary: problemSummary,
    rows: standings.map((r) => ({
      rank: r.rank,
      username: r.username,
      solvedCount: r.solvedCount,
      penalty: r.penalty,
      perProblem: r.perProblem.map((p) => ({
        problemId: p.problemId,
        status: p.status,
        attempts: p.attempts,
        penaltyMinutes: p.penaltyMinutes,
        isFirstToSolve: p.isFirstToSolve,
        timeMinutes: p.timeMinutes,
        pendingAttempts: p.pendingAttempts ?? 0,
      })),
      solved: r.perProblem.map((p) => p.status),
    })),
  };

  // An explicit deadline prevents a cache hit from crossing an automatic
  // freeze or contest end, even if Redis TTLs or cached data are stale.
  const cacheNow = Date.now();
  const boundary = !virtual && contest.status === "live"
    ? Math.min(contestEndMs, freezeAt && freezeAt.getTime() > nowMs ? freezeAt.getTime() : Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(cacheNow + STANDINGS_CACHE_TTL * 1000, boundary);
  if (redis && !isFrozen && expiresAt > cacheNow) {
    try {
      await redis.set(cacheKey, standingsCacheEntry(responsePayload, cacheVersion, expiresAt),
        { ex: Math.max(1, Math.ceil((expiresAt - cacheNow) / 1000)) });
    } catch {
      // Best-effort cache write
    }
  }

  return NextResponse.json(responsePayload);
}

export const GET = withApiGuard(handleGET);
