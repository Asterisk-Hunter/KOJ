import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { submissions } from "@/db/schema";

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
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  const submissionId = Number(idRaw);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return jsonError("invalid submission id", 400);
  }

  // Verify submission exists
  const rows = await db
    .select({
      id: submissions.id,
      status: submissions.status,
      passedTests: submissions.passedTests,
      totalTests: submissions.totalTests,
      executionTimeMs: submissions.executionTimeMs,
      memoryUsedMb: submissions.memoryUsedMb,
      errorMessage: submissions.errorMessage,
    })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);

  if (rows.length === 0) {
    return jsonError("submission not found", 404);
  }

  const encoder = new TextEncoder();
  let ticks = 0;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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
          .where(eq(submissions.id, submissionId))
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

        const timer = setInterval(() => {
          void (async () => {
            ticks += 1;
            try {
              const done = await fetchAndSend();
              if (done || ticks >= MAX_TICKS) {
                clearInterval(timer);
                if (!closed) {
                  closed = true;
                  controller.close();
                }
              }
            } catch {
              clearInterval(timer);
              if (!closed) {
                closed = true;
                controller.close();
              }
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
