import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

const STAFF_ROLES = new Set(["admin", "setter"]);

export const runtime = "nodejs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const rows = await db
    .select({ role: users.role, suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  const user = rows[0];
  if (!user || user.suspended || !STAFF_ROLES.has(user.role)) redirect("/dashboard");

  return <>{children}</>;
}
