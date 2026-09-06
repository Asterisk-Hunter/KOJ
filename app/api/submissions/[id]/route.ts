import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { submissions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }

  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("invalid submission id", 400);
  }

  const rows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);

  if (rows.length === 0) {
    return jsonError("not found", 404);
  }
  const row = rows[0];
  if (row.userId !== userId) {
    return jsonError("not found", 404);
  }

  return NextResponse.json({
    id: row.id,
    userId: row.userId,
    problemId: row.problemId,
    contestId: row.contestId,
    language: row.language,
    code: row.code,
    status: row.status,
    executionTimeMs: row.executionTimeMs,
    memoryUsedMb: row.memoryUsedMb,
    passedTests: row.passedTests,
    totalTests: row.totalTests,
    errorMessage: row.errorMessage,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
  });
}
