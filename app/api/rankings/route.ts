import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, submissions, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type StandingRow = {
  rank: number;
  userId: string;
  username: string;
  solvedCount: number;
  penalty: number;
  perProblem: Array<{
    problemId: number;
    status: "AC" | "WA" | "--";
    attempts: number;
    penaltyMinutes: number | null;
  }>;
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
    .select()
    .from(contestProblems)
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
      },
      problems: [],
      rows: [],
    });
  }

  const problemIds = cpRows.map((r) => r.problemId);

  const submissionRows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.contestId, contestId));

  const userRows = await db.select().from(users);
  const userMap = new Map<string, string>();
  for (const u of userRows) {
    userMap.set(u.clerkId, u.username);
  }

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

  // Sort each list by submittedAt asc (fallback to id)
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

  const contestStartMs = contest.startsAt.getTime();

  const standings: StandingRow[] = [];

  for (const [userId, probMap] of byUserProblem) {
    const username = userMap.get(userId) ?? userId;
    let solvedCount = 0;
    let penalty = 0;
    const perProblem: StandingRow["perProblem"] = [];

    for (const pid of problemIds) {
      const list = probMap.get(pid) ?? [];
      if (list.length === 0) {
        perProblem.push({ problemId: pid, status: "--", attempts: 0, penaltyMinutes: null });
        continue;
      }
      let firstAcIndex = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].status === "accepted") {
          firstAcIndex = i;
          break;
        }
      }
      if (firstAcIndex === -1) {
        // no AC -> WA if any attempts
        perProblem.push({ problemId: pid, status: "WA", attempts: list.length, penaltyMinutes: null });
      } else {
        const firstAc = list[firstAcIndex];
        const wrongBefore = firstAcIndex; // each prior submission counts as 20 min penalty regardless of verdict? Spec says wrong attempt before first AC.
        // We count all non-accepted before first AC
        // Alternative count could filter pending/running but those shouldn't be before AC in finished contest
        const submittedAtMs = firstAc.submittedAt ? firstAc.submittedAt.getTime() : contestStartMs;
        const minutes = Math.max(0, Math.floor((submittedAtMs - contestStartMs) / 60000));
        const penaltyMinutes = minutes + 20 * wrongBefore;
        solvedCount += 1;
        penalty += penaltyMinutes;
        perProblem.push({ problemId: pid, status: "AC", attempts: list.length, penaltyMinutes });
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

  const problemsMeta = cpRows.map((cp, idx) => ({
    problemId: cp.problemId,
    position: cp.position,
    label: String.fromCharCode(65 + idx),
  }));

  return NextResponse.json({
    contest: {
      id: contest.id,
      title: contest.title,
      status: contest.status,
      startsAt: contest.startsAt.toISOString(),
      endsAt: contest.endsAt.toISOString(),
    },
    problems: problemsMeta,
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
      })),
      // legacy compatibility for previous mock: solved array of status strings
      solved: r.perProblem.map((p) => p.status),
    })),
  });
}
