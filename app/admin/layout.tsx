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
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  const role = rows.length > 0 ? rows[0].role : null;
  if (!role || !STAFF_ROLES.has(role)) redirect("/dashboard");

  return <>{children}</>;
}
