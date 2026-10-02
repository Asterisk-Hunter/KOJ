import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import ProblemCreateClient from "@/app/problems/create/ProblemCreateClient";
import { ensureUserRow } from "@/app/api/admin/authz";
import { db } from "@/db";
import { users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProblemCreatePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent("/problems/create")}`);
  }

  let role = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)
    .then((rows) => rows[0]?.role ?? null);

  if (role === null) {
    await ensureUserRow(userId);
    role = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1)
      .then((rows) => rows[0]?.role ?? null);
  }

  if (role !== "admin" && role !== "setter") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center font-mono">
        <p className="text-red-300">403 · authoring access required</p>
        <p className="mt-2 text-sm text-kjtext-muted">
          Problem creation is limited to problem setters and administrators.
        </p>
      </main>
    );
  }

  return <ProblemCreateClient />;
}
