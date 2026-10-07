import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { resolveOrganizationContext } from "@/lib/organizations";
import { publicErrorMessage } from "../../public-result";
import { createStatusStream } from "./status-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handleGET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return jsonError("unauthorized", 401);
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);

  const { id: idRaw } = await ctx.params;
  const submissionId = Number(idRaw);
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) return jsonError("invalid submission id", 400);

  const load = async () => {
    const [row] = await db.select({
      userId: submissions.userId,
      mode: submissions.mode,
      status: submissions.status,
      passedTests: submissions.passedTests,
      totalTests: submissions.totalTests,
      executionTimeMs: submissions.executionTimeMs,
      memoryUsedMb: submissions.memoryUsedMb,
      errorMessage: submissions.errorMessage,
    }).from(submissions).where(and(
      eq(submissions.id, submissionId),
      eq(submissions.organizationId, organization.organizationId),
    )).limit(1);
    return row ?? null;
  };
  const initial = await load();
  if (!initial) return jsonError("submission not found", 404);
  if (initial.userId !== userId && organization.role !== "admin") return jsonError("forbidden", 403);

  const publicStatus = (row: NonNullable<Awaited<ReturnType<typeof load>>>) => ({
    status: row.status,
    passedTests: row.passedTests,
    totalTests: row.totalTests,
    executionTimeMs: row.executionTimeMs,
    memoryUsedMb: row.memoryUsedMb,
    errorMessage: publicErrorMessage(row),
  });
  const stream = createStatusStream({
    initial: publicStatus(initial),
    signal: req.signal,
    load: async () => {
      const row = await load();
      return row && (row.userId === userId || organization.role === "admin") ? publicStatus(row) : null;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const GET = withApiGuard(handleGET);
