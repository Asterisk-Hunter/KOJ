import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { problems, submissions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;

  const qRaw = url.searchParams.get("q");
  const difficultyRaw = url.searchParams.get("difficulty");
  const categoryRaw = url.searchParams.get("category");

  let q: string | null = null;
  if (qRaw !== null) {
    if (typeof qRaw !== "string") return jsonError("invalid q", 400);
    const trimmed = qRaw.trim().slice(0, 100);
    if (trimmed.length > 0) q = trimmed;
  }

  let difficulty: string | null = null;
  if (difficultyRaw !== null) {
    const trimmed = difficultyRaw.trim().toLowerCase().slice(0, 20);
    if (trimmed.length > 0) {
      // validate against known difficulties; if unknown, treat as filter that yields no results
      if (["easy", "medium", "hard"].includes(trimmed)) {
        difficulty = trimmed;
      } else {
        // keep normalized invalid value so filter produces empty result rather than leaking all
        difficulty = trimmed;
      }
    }
  }

  let category: string | null = null;
  if (categoryRaw !== null) {
    const trimmed = categoryRaw.trim().slice(0, 100);
    if (trimmed.length > 0) category = trimmed;
  }

  // Only published problems are public
  const published = await db
    .select()
    .from(problems)
    .where(eq(problems.status, "published"))
    .orderBy(desc(problems.id));

  let filtered = published;

  if (q !== null) {
    const lowerQ = q.toLowerCase();
    filtered = filtered.filter((p) => {
      const title = p.title.toLowerCase();
      const tags = p.tags ?? [];
      const cat = (tags[0] ?? "general").toLowerCase();
      if (title.includes(lowerQ)) return true;
      if (cat.includes(lowerQ)) return true;
      for (const t of tags) {
        if (t.toLowerCase().includes(lowerQ)) return true;
      }
      return false;
    });
  }

  if (difficulty !== null) {
    filtered = filtered.filter((p) => p.difficulty === difficulty);
  }

  if (category !== null) {
    const lowerCat = category.toLowerCase();
    filtered = filtered.filter((p) => {
      const cat = (p.tags?.[0] ?? "general").toLowerCase();
      return cat === lowerCat;
    });
  }

  if (filtered.length === 0) {
    return NextResponse.json([]);
  }

  const ids = filtered.map((p) => p.id);

  // Acceptance: accepted / completed (completed = not pending/running)
  const subs = await db
    .select({ problemId: submissions.problemId, status: submissions.status })
    .from(submissions)
    .where(inArray(submissions.problemId, ids));

  const completedByProblem = new Map<number, { total: number; accepted: number }>();
  for (const s of subs) {
    if (s.status === "pending" || s.status === "running") continue;
    const entry = completedByProblem.get(s.problemId) ?? { total: 0, accepted: 0 };
    entry.total += 1;
    if (s.status === "accepted") entry.accepted += 1;
    completedByProblem.set(s.problemId, entry);
  }

  let userId: string | null = null;
  try {
    const a = await auth();
    userId = a.userId ?? null;
  } catch {
    userId = null;
  }

  const userStatusMap = new Map<number, string[]>();
  if (userId) {
    const userSubs = await db
      .select({ problemId: submissions.problemId, status: submissions.status })
      .from(submissions)
      .where(and(eq(submissions.userId, userId), inArray(submissions.problemId, ids)));
    for (const s of userSubs) {
      const arr = userStatusMap.get(s.problemId) ?? [];
      arr.push(s.status);
      userStatusMap.set(s.problemId, arr);
    }
  }

  const result = filtered.map((p) => {
    const cat = p.tags?.[0] ?? "general";
    const stats = completedByProblem.get(p.id);
    const acceptance = !stats || stats.total === 0 ? "—" : `${((stats.accepted / stats.total) * 100).toFixed(1)}%`;

    let status: "solved" | "attempted" | "unsolved" = "unsolved";
    if (userId) {
      const statuses = userStatusMap.get(p.id) ?? [];
      if (statuses.includes("accepted")) status = "solved";
      else if (statuses.some((s) => s !== "pending")) status = "attempted";
      else status = "unsolved";
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
