import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { resolveOrganizationContext } from "@/lib/organizations";
import { publicCaseResults, publicErrorMessage } from "../public-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handleGET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);

  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("invalid submission id", 400);
  }

  const rows = await db
    .select()
    .from(submissions)
    .where(and(
      eq(submissions.id, id),
      eq(submissions.organizationId, organization.organizationId),
    ))
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
    errorMessage: publicErrorMessage(row),
    caseResults: publicCaseResults(row.caseResults, row.mode),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export const GET = withApiGuard(handleGET);
