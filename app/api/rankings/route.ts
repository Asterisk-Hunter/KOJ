import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, problems, submissions, users } from "@/db/schema";
import { getRedis } from "@/lib/redis";

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

export async function GET(req: NextRequest) {
  const contestIdRaw = req.nextUrl.searchParams.get("contestId");
  if (!contestIdRaw) {
    return jsonError("contestId is required", 400);
  }
  const contestId = Number(contestIdRaw);
  if (!Number.isInteger(contestId) || contestId <= 0) {
    return jsonError("contestId must be a positive integer", 400);
  }

  // Redis cache check (short TTL for live contests)
  const redis = getRedis();
  const cacheKey = `standings:${contestId}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json(cached);
    } catch {
      // Redis unavailable — fall through to DB path
    }
  }

  const contestRows = await db
    .select()
    .from(contests)
    .where(eq(contests.id, contestId))
    .limit(1);
  if (contestRows.length === 0) {
    return jsonError("contest not found", 404);
  }
  const contest = contestRows[0];

  if (contest.status !== "live" && contest.status !== "ended" && contest.status !== "archived") {
    return jsonError("contest not found or not visible", 404);
  }

  const cpRows = await db
    .select({
      contestId: contestProblems.contestId,
      problemId: contestProblems.problemId,
      position: contestProblems.position,
      problemTitle: problems.title,
    })
    .from(contestProblems)
    .innerJoin(problems, eq(contestProblems.problemId, problems.id))
    .where(eq(contestProblems.contestId, contestId))
    .orderBy(asc(contestProblems.position));

  if (cpRows.length === 0) {
    return NextResponse.json({
      contest: {
        id: contest.id,
        title: contest.title,
        status: contest.status,
        startsAt: contest.startsAt.toISOString(),
        endsAt: contest.endsAt.toISOString(),
        isFrozen: false,
      },
      problems: [],
      rows: [],
      summary: [],
    });
  }

  const problemIds = cpRows.map((r) => r.problemId);

  const submissionRows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.contestId, contestId));

  const submittedUserIds = [...new Set(submissionRows.map((s) => s.userId))];
  const userMap = new Map<string, string>();
  if (submittedUserIds.length > 0) {
    const userRows = await db
      .select()
      .from(users)
      .where(inArray(users.clerkId, submittedUserIds));
    for (const u of userRows) {
      userMap.set(u.clerkId, u.username);
    }
  }

  const contestStartMs = contest.startsAt.getTime();
  const contestEndMs = contest.endsAt.getTime();
  const nowMs = Date.now();

  // Scoreboard freeze: in ICPC/DOMjudge, scoreboard freezes in the last 60 minutes of live contest
  const FREEZE_WINDOW_MS = 60 * 60 * 1000;
  const freezeAtMs = Math.max(contestStartMs, contestEndMs - FREEZE_WINDOW_MS);
  const isFrozen = contest.status === "live" && nowMs >= freezeAtMs && nowMs < contestEndMs;

  // Group submissions by userId -> problemId -> sorted list
  const byUserProblem = new Map<string, Map<number, typeof submissionRows>>();
  for (const s of submissionRows) {
    if (!problemIds.includes(s.problemId)) continue;
    let m = byUserProblem.get(s.userId);
    if (!m) {
      m = new Map<number, typeof submissionRows>();
      byUserProblem.set(s.userId, m);
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

  // Detect First-to-Solve (First AC) per problem across entire contest
  // If scoreboard is currently frozen, post-freeze solves are masked until contest ends
  const firstSolverByProblem = new Map<number, { userId: string; submittedAtMs: number }>();
  for (const [userId, m] of byUserProblem) {
    for (const [pid, list] of m) {
      for (const s of list) {
        if (s.status === "accepted") {
          const subMs = s.submittedAt ? s.submittedAt.getTime() : contestStartMs;
          if (isFrozen && subMs >= freezeAtMs) {
            continue; // Mask post-freeze solve during active freeze window
          }
          const currentFirst = firstSolverByProblem.get(pid);
          if (!currentFirst || subMs < currentFirst.submittedAtMs) {
            firstSolverByProblem.set(pid, { userId, submittedAtMs: subMs });
          }
          break; // First AC for this user on this problem
        }
      }
    }
  }

  const standings: StandingRow[] = [];
  // Under official ICPC and DOMjudge rules, compilation errors do NOT incur a 20-minute penalty
  const WRONG_VERDICTS = new Set([
    "wrong_answer",
    "time_limit_exceeded",
    "memory_limit_exceeded",
    "runtime_error",
    "presentation_error",
  ]);

  for (const [userId, probMap] of byUserProblem) {
    const username = userMap.get(userId) ?? userId;
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
      const isFirst = firstSolver?.userId === userId;

      if (firstAcIndex === -1) {
        // No AC
        // Check if any attempts happened after freeze
        const postFreezeAttempts = isFrozen
          ? list.filter((s) => s.submittedAt && s.submittedAt.getTime() >= freezeAtMs).length
          : 0;

        if (isFrozen && postFreezeAttempts > 0) {
          perProblem.push({
            problemId: pid,
            status: "PENDING",
            attempts: list.length,
            penaltyMinutes: null,
            isFirstToSolve: false,
            timeMinutes: null,
            pendingAttempts: postFreezeAttempts,
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

        // If solved AFTER freeze in a live frozen contest, hide AC from public standings
        if (isFrozen && submittedAtMs >= freezeAtMs) {
          const preFreezeList = list.filter((s) => !s.submittedAt || s.submittedAt.getTime() < freezeAtMs);
          const hadPreFreezeAc = preFreezeList.some((s) => s.status === "accepted");
          if (!hadPreFreezeAc) {
            perProblem.push({
              problemId: pid,
              status: "PENDING",
              attempts: list.length,
              penaltyMinutes: null,
              isFirstToSolve: false,
              timeMinutes: null,
              pendingAttempts: list.length - preFreezeList.length,
            });
            continue;
          }
        }

        const wrongBefore = list
          .slice(0, firstAcIndex)
          .filter((s) => WRONG_VERDICTS.has(s.status)).length;
        const minutes = Math.max(0, Math.floor((submittedAtMs - contestStartMs) / 60000));
        const penaltyMinutes = minutes + 20 * wrongBefore;
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

    standings.push({ rank: 0, userId, username, solvedCount, penalty, perProblem });
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
    const firstSolveMinutes = firstSolver
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

  const responsePayload = {
    contest: {
      id: contest.id,
      title: contest.title,
      status: contest.status,
      startsAt: contest.startsAt.toISOString(),
      endsAt: contest.endsAt.toISOString(),
      isFrozen,
      freezeMinutesRemaining: isFrozen ? Math.max(0, Math.ceil((contestEndMs - nowMs) / 60000)) : 0,
    },
    problems: problemsMeta,
    summary: problemSummary,
    rows: standings.map((r) => ({
      rank: r.rank,
      userId: r.userId,
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

  // Cache standings for short TTL
  if (redis) {
    try {
      await redis.set(cacheKey, responsePayload, { ex: STANDINGS_CACHE_TTL });
    } catch {
      // Best-effort cache write
    }
  }

  return NextResponse.json(responsePayload);
}
