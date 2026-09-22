import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/authz";
import { readBoundedJson, MAX_RECOVER_BODY_BYTES } from "@/app/api/body-guard";
import {
  recoverStaleRunningSubmissions,
  STALE_RUNNING_AFTER_MS,
} from "@/app/api/submissions/recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/submissions/recover — mark stale `pending`/`running`
 * submissions terminal. Auth: Clerk admin session OR `x-cron-secret`
 * matching `CRON_SECRET` (for schedulers, which have no user session).
 *
 * DEPLOYMENT NOTE: no cron is wired in this repo. To schedule, add a Vercel
 * Cron (or Cloud Scheduler) hitting `POST /api/admin/submissions/recover`
 * every 5–10 min with header `x-cron-secret: $CRON_SECRET`, and set
 * `CRON_SECRET` on the Next deployment. Without it, invoke manually with an
 * admin session. Optional body: `{ "staleAfterMinutes": 5..120 }`
 * (default 10). Re-invoke until `recovered` is 0 (bounded batches).
 */

function cronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) return false;
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    const grant = await requireAdmin();
    if (!grant.ok) return grant.response;
  }

  let staleAfterMs = STALE_RUNNING_AFTER_MS;
  const rawLength = req.headers.get("content-length");
  const hasBody =
    req.headers.get("transfer-encoding") !== null ||
    (rawLength !== null && Number(rawLength) > 0);
  if (hasBody) {
    const parsed = await readBoundedJson(req, MAX_RECOVER_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const b = parsed.value as Record<string, unknown>;
    if (b.staleAfterMinutes !== undefined) {
      const n =
        typeof b.staleAfterMinutes === "string"
          ? Number(b.staleAfterMinutes)
          : b.staleAfterMinutes;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 5 || n > 120) {
        return NextResponse.json(
          { error: "staleAfterMinutes must be a number 5..120" },
          { status: 400 },
        );
      }
      staleAfterMs = Math.floor(n * 60 * 1000);
    }
  }

  const result = await recoverStaleRunningSubmissions(new Date(), staleAfterMs);
  return NextResponse.json(result);
}
