import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contests, submissions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICK_MS = 2000;
const MAX_TICKS = 150; // ~5 minutes; EventSource reconnects automatically.

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function findContest(idRaw: string) {
  const numeric = Number(idRaw);
  const isNumeric = Number.isInteger(numeric) && numeric > 0 && String(numeric) === idRaw;
  if (isNumeric) {
    const rows = await db.select().from(contests).where(eq(contests.id, numeric)).limit(1);
    if (rows.length > 0) return rows[0];
  }
  const slugRows = await db.select().from(contests).where(eq(contests.slug, idRaw)).limit(1);
  if (slugRows.length > 0) return slugRows[0];
  return null;
}

async function versionFor(contestId: number): Promise<{ count: number; maxSubmittedAt: string | null }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      maxSubmittedAt: sql<string | null>`max(${submissions.submittedAt})`.mapWith(
        (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null)),
      ),
    })
    .from(submissions)
    .where(eq(submissions.contestId, contestId));
  return { count: row?.count ?? 0, maxSubmittedAt: row?.maxSubmittedAt ?? null };
}

/**
 * Live leaderboard ticker (SRS REQ-LB-03/04, Redis-free v1): streams a
 * `version` event every 2s. Clients refetch `GET /api/rankings` only when
 * the version changes — push-triggered refresh without polling the full
 * standings. Redis pub/sub remains the documented v2 upgrade for
 * cross-instance fan-out.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  const contest = await findContest(idRaw);
  if (
    !contest ||
    (contest.status !== "live" && contest.status !== "ended" && contest.status !== "archived")
  ) {
    return jsonError("contest not found or not visible", 404);
  }
  const contestId = contest.id;

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
      try {
        send("version", await versionFor(contestId));
        const timer = setInterval(() => {
          void (async () => {
            ticks += 1;
            try {
              send("version", await versionFor(contestId));
            } catch {
              clearInterval(timer);
              if (!closed) {
                closed = true;
                controller.close();
              }
              return;
            }
            if (ticks >= MAX_TICKS) {
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
