import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { problems, submissions } from "@/db/schema";
import { resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const MAX_OFFSET = 10_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parsePageValue(raw: string | null, fallback: number, maximum: number): number | null {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximum ? value : null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function isDifficulty(value: string): value is "easy" | "medium" | "hard" {
  return value === "easy" || value === "medium" || value === "hard";
}

async function handleGET(req: NextRequest) {
  const { userId } = await auth();
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  const url = req.nextUrl;

  const qRaw = url.searchParams.get("q");
  const difficultyRaw = url.searchParams.get("difficulty");
  const categoryRaw = url.searchParams.get("category");
  const limit = parsePageValue(url.searchParams.get("limit"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = parsePageValue(url.searchParams.get("offset"), 0, MAX_OFFSET);
  if (limit === null || limit < 1) return jsonError("limit must be between 1 and 200", 400);
  if (offset === null) return jsonError("offset must be between 0 and 10000", 400);

  let q: string | null = null;
  if (qRaw !== null) {
    if (typeof qRaw !== "string") return jsonError("invalid q", 400);
    const trimmed = qRaw.trim().slice(0, 100);
    if (trimmed.length > 0) q = trimmed;
  }

  let difficulty: "easy" | "medium" | "hard" | null = null;
  if (difficultyRaw !== null) {
    const trimmed = difficultyRaw.trim().toLowerCase().slice(0, 20);
    if (trimmed.length > 0) {
      if (isDifficulty(trimmed)) {
        difficulty = trimmed;
      } else {
        return NextResponse.json([]);
      }
    }
  }

  let category: string | null = null;
  if (categoryRaw !== null) {
    const trimmed = categoryRaw.trim().slice(0, 100);
    if (trimmed.length > 0) category = trimmed;
  }

  const filters = [
    eq(problems.status, "published"),
    eq(problems.organizationId, organization.organizationId),
  ];
  if (q !== null) {
    const pattern = `%${escapeLikePattern(q)}%`;
    const searchFilter = or(
      ilike(problems.title, pattern),
      sql`${problems.tags}::text ILIKE ${pattern}`,
    );
    if (searchFilter) filters.push(searchFilter);
  }
  if (difficulty !== null) {
    filters.push(eq(problems.difficulty, difficulty));
  }
  if (category !== null) {
    filters.push(sql`lower(coalesce(${problems.tags}[1], 'general')) = lower(${category})`);
  }

  const filtered = await db
    .select({ id: problems.id, title: problems.title, difficulty: problems.difficulty, tags: problems.tags })
    .from(problems)
    .where(and(...filters))
    .orderBy(desc(problems.id))
    .limit(limit)
    .offset(offset);
  if (filtered.length === 0) {
    return NextResponse.json([]);
  }

  const ids = filtered.map((p) => p.id);

  const statistics = await db
    .select({
      problemId: submissions.problemId,
      total: sql<number>`count(*) FILTER (WHERE ${submissions.mode} = 'submit' AND ${submissions.status} NOT IN ('pending', 'running'))`.mapWith(Number),
      accepted: sql<number>`count(*) FILTER (WHERE ${submissions.mode} = 'submit' AND ${submissions.status} = 'accepted')`.mapWith(Number),
    })
    .from(submissions)
    .where(and(
      eq(submissions.organizationId, organization.organizationId),
      inArray(submissions.problemId, ids),
    ))
    .groupBy(submissions.problemId);
  const statisticsByProblem = new Map(statistics.map((row) => [row.problemId, row]));

  const userStatusMap = new Map<number, { accepted: number; attempted: number }>();
  if (userId) {
    const userSubs = await db
      .select({
        problemId: submissions.problemId,
        accepted: sql<number>`count(*) FILTER (WHERE ${submissions.status} = 'accepted')`.mapWith(Number),
        attempted: sql<number>`count(*) FILTER (WHERE ${submissions.status} <> 'pending')`.mapWith(Number),
      })
      .from(submissions)
      .where(and(
        eq(submissions.organizationId, organization.organizationId),
        eq(submissions.userId, userId),
        eq(submissions.mode, "submit"),
        inArray(submissions.problemId, ids),
      ))
      .groupBy(submissions.problemId);
    for (const s of userSubs) {
      userStatusMap.set(s.problemId, { accepted: s.accepted, attempted: s.attempted });
    }
  }

  const result = filtered.map((p) => {
    const cat = p.tags?.[0] ?? "general";
    const stats = statisticsByProblem.get(p.id);
    const acceptance = !stats || stats.total === 0 ? "—" : `${((stats.accepted / stats.total) * 100).toFixed(1)}%`;

    // null for signed-out visitors: they have no progress, and reporting
    // "unsolved" would invent a state for a user who never submitted.
    let status: "solved" | "attempted" | "unsolved" | null = null;
    if (userId) {
      const userStats = userStatusMap.get(p.id);
      status = userStats?.accepted
        ? "solved"
        : userStats?.attempted
          ? "attempted"
          : "unsolved";
    }

    return {
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      category: cat,
      acceptance,
      status,
    };
  });

  return NextResponse.json(result);
}

export const GET = withApiGuard(handleGET);
