import { and, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { problems, submissions, users } from "@/db/schema";
import { requireAdmin } from "@/app/api/admin/authz";
import { findSimilarSubmissions, type SimilarityDocument } from "./similarity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CANDIDATES = 120;
const MAX_CODE_CHARS = 50_000;

export async function GET(request: NextRequest) {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const problemIdText = request.nextUrl.searchParams.get("problemId");
  const problemId = Number(problemIdText);
  if (!problemIdText || !Number.isSafeInteger(problemId) || problemId <= 0) {
    return NextResponse.json({ error: "a positive problemId is required" }, { status: 400 });
  }

  const problemRows = await db
    .select({ id: problems.id, title: problems.title })
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);
  const problem = problemRows[0];
  if (!problem) return NextResponse.json({ error: "problem not found" }, { status: 404 });

  const rows = await db
    .select({
      submissionId: submissions.id,
      userId: submissions.userId,
      username: users.username,
      language: submissions.language,
      submittedAt: submissions.submittedAt,
      code: sql<string>`substring(${submissions.code} from 1 for ${MAX_CODE_CHARS + 1})`,
    })
    .from(submissions)
    .leftJoin(users, eq(submissions.userId, users.clerkId))
    .where(and(eq(submissions.problemId, problemId), sql`${submissions.status} <> 'pending' AND ${submissions.status} <> 'running'`))
    .orderBy(desc(submissions.submittedAt))
    .limit(MAX_CANDIDATES);

  const documents: SimilarityDocument[] = rows.map((row) => ({
    submissionId: row.submissionId,
    userId: row.userId,
    username: row.username ?? row.userId.slice(0, 12),
    language: row.language,
    submittedAt: row.submittedAt.toISOString(),
    code: row.code.slice(0, MAX_CODE_CHARS),
    truncated: row.code.length > MAX_CODE_CHARS,
  }));

  return NextResponse.json({
    problem,
    method: {
      name: "normalized-token winnowing",
      tokenShingleSize: 5,
      windowSize: 4,
      minimumSimilarityPercent: 20,
      minimumSharedFingerprints: 3,
    },
    limits: { candidates: MAX_CANDIDATES, sourceCharsPerCandidate: MAX_CODE_CHARS },
    candidateCount: documents.length,
    matches: findSimilarSubmissions(documents),
    advisory: "Similarity is a review lead, not proof of misconduct. Inspect work and context before taking action.",
  });
}
