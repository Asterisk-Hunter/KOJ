import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICK_MS = 1000;
const MAX_TICKS = 55; // ~55 seconds; client reconnects if needed.

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * SSE endpoint for individual submission status (SRS REQ-JUDGE-12).
 * Streams `status` events every 1s while the submission is pending/running.
 * Sends a final `done` event when a terminal verdict is reached, then closes.
 * Client reconnects automatically via EventSource if the stream ends early.
 */
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
  const submissionId = Number(idRaw);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return jsonError("invalid submission id", 400);
  }

  // Verify submission exists and belongs to the authenticated user (or admin)
  const rows = await db
    .select({
      id: submissions.id,
      userId: submissions.userId,
      organizationId: submissions.organizationId,
      status: submissions.status,
      passedTests: submissions.passedTests,
      totalTests: submissions.totalTests,
      executionTimeMs: submissions.executionTimeMs,
      memoryUsedMb: submissions.memoryUsedMb,
      errorMessage: submissions.errorMessage,
    })
    .from(submissions)
    .where(and(
      eq(submissions.id, submissionId),
      eq(submissions.organizationId, organization.organizationId),
    ))
    .limit(1);

  if (rows.length === 0) {
    return jsonError("submission not found", 404);
  }

  if (rows[0].userId !== userId) {
    if (organization.role !== "admin") return jsonError("forbidden", 403);
  }

  const encoder = new TextEncoder();
  let ticks = 0;
  let closed = false;
  let tickInFlight = false;
  let timer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
        );
      };

      const fetchAndSend = async (): Promise<boolean> => {
        const current = await db
          .select({
            status: submissions.status,
            passedTests: submissions.passedTests,
            totalTests: submissions.totalTests,
            executionTimeMs: submissions.executionTimeMs,
            memoryUsedMb: submissions.memoryUsedMb,
            errorMessage: submissions.errorMessage,
          })
          .from(submissions)
          .where(and(
            eq(submissions.id, submissionId),
            eq(submissions.organizationId, organization.organizationId),
          ))
          .limit(1);

        if (current.length === 0) {
          send("error", { message: "submission not found" });
          return true; // done
        }

        const sub = current[0];
        const isTerminal =
          sub.status !== "pending" && sub.status !== "running";

        send(isTerminal ? "done" : "status", {
          status: sub.status,
          passedTests: sub.passedTests,
          totalTests: sub.totalTests,
          executionTimeMs: sub.executionTimeMs,
          memoryUsedMb: sub.memoryUsedMb,
          errorMessage: sub.errorMessage,
        });

        return isTerminal;
      };

      try {
        // Send initial state immediately
        const initialDone = await fetchAndSend();
        if (initialDone) {
          if (!closed) {
            closed = true;
            controller.close();
          }
          return;
        }

        timer = setInterval(() => {
          if (closed || tickInFlight) return;
          void (async () => {
            tickInFlight = true;
            ticks += 1;
            try {
              const done = await fetchAndSend();
              if (done || ticks >= MAX_TICKS) {
                if (timer) clearInterval(timer);
                if (!closed) {
                  closed = true;
                  controller.close();
                }
              }
            } catch {
              if (timer) clearInterval(timer);
              if (!closed) {
                closed = true;
                controller.close();
              }
            } finally {
              tickInFlight = false;
            }
          })();
        }, TICK_MS);
      } catch {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const GET = withApiGuard(handleGET);
