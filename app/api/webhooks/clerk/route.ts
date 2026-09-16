import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contestRegistrations, contests, problems, submissions, users } from "@/db/schema";
import { verifyWebhookSignature } from "@/app/api/webhooks/clerk/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type ClerkEmail = { id: string; email_address: string };
type UserPayload = {
  id: string;
  username?: string | null;
  first_name?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmail[];
};

function primaryEmail(u: UserPayload): string {
  const list = u.email_addresses ?? [];
  return (
    list.find((e) => e.id === u.primary_email_address_id)?.email_address ??
    list[0]?.email_address ??
    ""
  );
}

function displayName(u: UserPayload): string {
  const email = primaryEmail(u);
  return u.username ?? u.first_name ?? (email ? email.split("@")[0] : u.id);
}

async function handleUserCreated(u: UserPayload): Promise<void> {
  const email = primaryEmail(u) || `${u.id}@placeholder.local`;
  await db
    .insert(users)
    .values({ clerkId: u.id, username: displayName(u), email })
    .onConflictDoNothing();
}

async function handleUserUpdated(u: UserPayload): Promise<void> {
  const email = primaryEmail(u);
  const patch: Partial<typeof users.$inferInsert> = {
    username: displayName(u),
    updatedAt: new Date(),
  };
  if (email) patch.email = email;
  await db.update(users).set(patch).where(eq(users.clerkId, u.id));
}

async function handleUserDeleted(clerkId: string): Promise<void> {
  const [sub, reg, authored, created] = await Promise.all([
    db.select({ id: submissions.id }).from(submissions).where(eq(submissions.userId, clerkId)).limit(1),
    db
      .select({ contestId: contestRegistrations.contestId })
      .from(contestRegistrations)
      .where(eq(contestRegistrations.userId, clerkId))
      .limit(1),
    db.select({ id: problems.id }).from(problems).where(eq(problems.authorId, clerkId)).limit(1),
    db.select({ id: contests.id }).from(contests).where(eq(contests.createdBy, clerkId)).limit(1),
  ]);
  if (sub.length > 0 || reg.length > 0 || authored.length > 0 || created.length > 0) {
    // Preserve standings/history: anonymize instead of deleting (FKs are NO ACTION).
    await db
      .update(users)
      .set({
        username: `deleted_${clerkId.slice(-8)}`,
        email: `${clerkId}@deleted.local`,
        role: "contestant",
        updatedAt: new Date(),
      })
      .where(eq(users.clerkId, clerkId));
    return;
  }
  await db.delete(users).where(eq(users.clerkId, clerkId));
}

/**
 * Clerk webhook receiver — keeps Neon `users` in sync (user created /
 * updated / deleted). Org membership events are acknowledged but do not
 * change global DB roles; those stay admin-managed via `/api/admin/users`.
 *
 * Configure in Clerk Dashboard → Webhooks with events
 * `user.created`, `user.updated`, `user.deleted`, and set
 * `CLERK_WEBHOOK_SECRET` (the `whsec_…` signing secret) on the Next app.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return jsonError("webhook not configured", 500);

  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signature = req.headers.get("svix-signature");
  if (!id || !timestamp || !signature) return jsonError("missing signature headers", 400);

  const rawBody = await req.text();
  if (!verifyWebhookSignature(secret, id, timestamp, rawBody, signature)) {
    return jsonError("invalid signature", 401);
  }

  let evt: unknown;
  try {
    evt = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonError("invalid json", 400);
  }
  const type = (evt as { type?: unknown }).type;
  const data = (evt as { data?: unknown }).data;
  if (typeof type !== "string" || typeof data !== "object" || data === null) {
    return jsonError("invalid event", 400);
  }

  switch (type) {
    case "user.created":
      await handleUserCreated(data as UserPayload);
      break;
    case "user.updated":
      await handleUserUpdated(data as UserPayload);
      break;
    case "user.deleted": {
      const deletedId = (data as { id?: unknown }).id;
      if (typeof deletedId !== "string" || deletedId.length === 0) {
        return jsonError("invalid event", 400);
      }
      await handleUserDeleted(deletedId);
      break;
    }
    default:
      // organizationMembership.* and everything else: acknowledged, no-op.
      return NextResponse.json({ received: true, ignored: type });
  }
  return NextResponse.json({ received: true, type });
}

export async function GET() {
  return jsonError("method not allowed", 405);
}
