import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contestRegistrations, contests, problems } from "@/db/schema";
import { ensureUserRow, jsonError, requireContestManager } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "contest";
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let i = 2; ; i++) {
    const rows = await db
      .select({ id: contests.id })
      .from(contests)
      .where(eq(contests.slug, candidate))
      .limit(1);
    if (rows.length === 0) return candidate;
    candidate = `${base.slice(0, 80)}-${i}`;
  }
}

/** Admin: list every contest (including drafts) with problem/participant counts. */
export async function GET() {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;

  const contestRows = await db
    .select()
    .from(contests)
    .orderBy(asc(contests.startsAt));

  const problemCounts = await db
    .select({
      contestId: contestProblems.contestId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(contestProblems)
    .groupBy(contestProblems.contestId);

  const registrationCounts = await db
    .select({
      contestId: contestRegistrations.contestId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(contestRegistrations)
    .groupBy(contestRegistrations.contestId);

  const problemCountMap = new Map(problemCounts.map((r) => [r.contestId, r.count]));
  const registrationCountMap = new Map(
    registrationCounts.map((r) => [r.contestId, r.count]),
  );

  return NextResponse.json({
    contests: contestRows.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      status: c.status,
      problems: problemCountMap.get(c.id) ?? 0,
      participants: registrationCountMap.get(c.id) ?? 0,
    })),
  });
}

/**
 * Admin: create a contest (always starts as `draft`; publish via PATCH).
 * Optionally links `problemIds` — each must exist and be `draft` (BR-04).
 */
export async function POST(req: NextRequest) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }
  const b = body as Record<string, unknown>;

  const title = b.title;
  if (typeof title !== "string" || title.trim().length === 0) {
    return jsonError("title is required", 400);
  }
  if (title.trim().length > 200) return jsonError("title too long", 400);

  const descriptionRaw = b.description ?? "";
  if (typeof descriptionRaw !== "string") return jsonError("description must be a string", 400);
  if (descriptionRaw.length > 5000) return jsonError("description too long", 400);

  const inviteRaw = b.inviteCode ?? b.invite_code ?? null;
  let inviteCode: string | null = null;
  if (inviteRaw !== null && inviteRaw !== "") {
    if (typeof inviteRaw !== "string" || inviteRaw.trim().length === 0) {
      return jsonError("inviteCode must be non-empty", 400);
    }
    if (inviteRaw.trim().length > 64) return jsonError("inviteCode too long", 400);
    inviteCode = inviteRaw.trim();
  }

  const startsAtRaw = b.startsAt;
  const endsAtRaw = b.endsAt;
  if (typeof startsAtRaw !== "string" || typeof endsAtRaw !== "string") {
    return jsonError("startsAt and endsAt are required ISO strings", 400);
  }
  const startsAt = new Date(startsAtRaw);
  const endsAt = new Date(endsAtRaw);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return jsonError("startsAt/endsAt must be valid dates", 400);
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return jsonError("endsAt must be after startsAt", 400);
  }

  const slugRaw = b.slug;
  let slug: string;
  if (slugRaw === undefined || slugRaw === null || slugRaw === "") {
    slug = await uniqueSlug(slugify(title.trim()));
  } else {
    if (typeof slugRaw !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugRaw)) {
      return jsonError("slug must be lowercase alphanumeric with dashes", 400);
    }
    if (slugRaw.length > 100) return jsonError("slug too long", 400);
    const existing = await db
      .select({ id: contests.id })
      .from(contests)
      .where(eq(contests.slug, slugRaw))
      .limit(1);
    if (existing.length > 0) return jsonError("slug already exists", 409);
    slug = slugRaw;
  }

  let problemIds: number[] = [];
  if (b.problemIds !== undefined) {
    if (!Array.isArray(b.problemIds)) return jsonError("problemIds must be an array", 400);
    for (const p of b.problemIds) {
      if (typeof p !== "number" || !Number.isInteger(p) || p <= 0) {
        return jsonError("problemIds must be positive integers", 400);
      }
    }
    problemIds = [...new Set(b.problemIds as number[])];
    if (problemIds.length > 0) {
      const rows = await db
        .select({ id: problems.id, status: problems.status })
        .from(problems)
        .where(inArray(problems.id, problemIds));
      if (rows.length !== problemIds.length) return jsonError("one or more problems not found", 404);
      for (const r of rows) {
        if (r.status !== "draft") return jsonError(`problem #${r.id} is not draft (BR-04)`, 400);
      }
    }
  }

  const ready = await ensureUserRow(grant.userId);
  if (!ready) return jsonError("failed to resolve user", 500);

  const inserted = await db
    .insert(contests)
    .values({
      createdBy: grant.userId,
      slug,
      title: title.trim(),
      description: descriptionRaw,
      startsAt,
      endsAt,
      status: "draft",
      inviteCode,
    })
    .returning({ id: contests.id });

  const contestId = inserted[0].id;
  if (problemIds.length > 0) {
    await db.insert(contestProblems).values(
      problemIds.map((problemId, i) => ({ contestId, problemId, position: i })),
    );
  }

  return NextResponse.json({ id: contestId, slug, status: "draft" }, { status: 201 });
}
