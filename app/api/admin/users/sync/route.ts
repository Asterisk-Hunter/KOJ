import { createHash } from "node:crypto";
import { withApiGuard } from "@/app/api/guard";
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { jsonError, requireAdmin } from "@/app/api/admin/authz";
import { MAX_ADMIN_USER_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { handleUserDeleted } from "@/app/api/webhooks/clerk/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLERK_PAGE_SIZE = 500;

async function getCompleteClerkDirectory(client: Awaited<ReturnType<typeof clerkClient>>) {
  const clerkIds = new Set<string>();
  let expectedTotal: number | null = null;
  let offset = 0;

  while (expectedTotal === null || offset < expectedTotal) {
    const page = await client.users.getUserList({
      limit: CLERK_PAGE_SIZE,
      offset,
      orderBy: "-created_at",
    });
    if (
      !Number.isSafeInteger(page.totalCount) ||
      page.totalCount < 0 ||
      !Array.isArray(page.data) ||
      (expectedTotal !== null && page.totalCount !== expectedTotal)
    ) {
      throw new Error("invalid Clerk page metadata");
    }
    expectedTotal = page.totalCount;
    const expectedPageSize = Math.min(CLERK_PAGE_SIZE, expectedTotal - offset);
    if (page.data.length !== expectedPageSize) throw new Error("incomplete Clerk page");

    for (const user of page.data) {
      if (typeof user.id !== "string" || user.id.length === 0 || clerkIds.has(user.id)) {
        throw new Error("invalid Clerk directory entry");
      }
      clerkIds.add(user.id);
    }
    offset += page.data.length;
  }

  if (clerkIds.size !== expectedTotal) throw new Error("incomplete Clerk directory");
  return { clerkIds, totalCount: expectedTotal };
}

function createPlanToken(clerkIds: Set<string>, neonIds: string[]): string {
  const payload = JSON.stringify({
    clerkIds: [...clerkIds].sort(),
    neonIds: [...neonIds].sort(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Admin: preview reconciliation against the complete Clerk directory. A
 * separate typed confirmation is required before missing Neon rows can be
 * purged or anonymized; stale previews cannot be applied.
 */
async function handlePOST(req: Request) {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const parsed = await readBoundedJsonObject(req, MAX_ADMIN_USER_BODY_BYTES, "invalid json");
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const keys = Object.keys(body);
  if (keys.some((key) => key !== "confirmation" && key !== "planToken")) {
    return jsonError("unexpected request field", 400);
  }
  const isConfirmation = keys.length > 0;
  if (isConfirmation && (typeof body.confirmation !== "string" || typeof body.planToken !== "string")) {
    return jsonError("confirmation and planToken are required", 400);
  }
  if (typeof body.planToken === "string" && !/^[a-f0-9]{64}$/.test(body.planToken)) {
    return jsonError("planToken is invalid", 400);
  }

  let client: Awaited<ReturnType<typeof clerkClient>>;
  let directory: Awaited<ReturnType<typeof getCompleteClerkDirectory>>;
  try {
    client = await clerkClient();
    directory = await getCompleteClerkDirectory(client);
  } catch {
    return jsonError("Clerk directory could not be read completely; no users were changed", 502);
  }

  let neonRows: Array<{ clerkId: string }>;
  try {
    neonRows = await db.select({ clerkId: users.clerkId }).from(users);
  } catch {
    return jsonError("Neon users could not be read; no users were changed", 500);
  }

  const neonIds = neonRows.map((row) => row.clerkId);
  const missingIds = neonIds.filter((clerkId) => !directory.clerkIds.has(clerkId));
  const planToken = createPlanToken(directory.clerkIds, neonIds);

  if (!isConfirmation) {
    return NextResponse.json({
      status: "preview",
      checked: neonRows.length,
      directoryUsers: directory.totalCount,
      missing: missingIds.length,
      planToken,
    });
  }

  if (body.planToken !== planToken) {
    return jsonError("directory or Neon users changed since preview; review a new preview", 409);
  }
  const expectedConfirmation = `DELETE OR ANONYMIZE ${missingIds.length} USERS`;
  if (body.confirmation !== expectedConfirmation) {
    return jsonError(`type ${expectedConfirmation} to confirm reconciliation`, 400);
  }

  let removed = 0;
  let anonymized = 0;
  for (const clerkId of missingIds) {
    const outcome = await handleUserDeleted(clerkId);
    if (outcome === "deleted") removed++;
    else anonymized++;
  }

  return NextResponse.json({
    status: "applied",
    checked: neonRows.length,
    directoryUsers: directory.totalCount,
    missing: missingIds.length,
    removed,
    anonymized,
  });
}

export const POST = withApiGuard(handlePOST);
