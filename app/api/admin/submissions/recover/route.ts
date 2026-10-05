import { withApiGuard } from "@/app/api/guard";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/authz";
import { readBoundedJsonObject, MAX_RECOVER_BODY_BYTES } from "@/app/api/body-guard";
import {
  recoverStaleRunningSubmissions,
  STALE_RUNNING_AFTER_MS,
} from "@/app/api/submissions/recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recover old submissions that predate durable queue insertion. Auth:
 * Clerk admin session or a scheduler bearer token matching `CRON_SECRET`.
 *
 * Vercel Cron calls GET. Admins can call POST with an optional
 * `{ "staleAfterMinutes": 5..120 }` body (default 10).
 */

function cronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) return false;
  const authorization = req.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : req.headers.get("x-cron-secret") ?? "";
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handleRecovery(req: NextRequest, allowBody: boolean) {
  if (!cronAuthorized(req)) {
    const grant = await requireAdmin();
    if (!grant.ok) return grant.response;
  }

  let staleAfterMs = STALE_RUNNING_AFTER_MS;
  const rawLength = allowBody ? req.headers.get("content-length") : null;
  const hasBody = allowBody && (
    req.headers.get("transfer-encoding") !== null ||
    (rawLength !== null && Number(rawLength) > 0)
  );
  if (hasBody) {
    const parsed = await readBoundedJsonObject(req, MAX_RECOVER_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const b = parsed.value;
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

async function handleGET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handleRecovery(req, false);
}

async function handlePOST(req: NextRequest) {
  return handleRecovery(req, true);
}

export const GET = withApiGuard(handleGET);
export const POST = withApiGuard(handlePOST);
