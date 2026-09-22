import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbRole = "admin" | "problem_setter" | "contest_setter" | "contestant";

async function clerkHasRole(role: string): Promise<boolean> {
  try {
    const authResult = await auth();
    const has = (authResult as unknown as { has?: (input: unknown) => unknown }).has;
    if (typeof has !== "function") return false;
    const result = has.call(authResult, { role });
    return result instanceof Promise ? await result : Boolean(result);
  } catch {
    return false;
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({
      authenticated: false,
      role: "contestant" as const,
      canAccessAdmin: false,
      canAuthor: false,
      canManageContests: false,
    });
  }

  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  const role: DbRole = rows.length > 0 ? rows[0].role : "contestant";
  const orgAdmin = await clerkHasRole("org:admin");
  const orgContestSetter = await clerkHasRole("org:contest_setter");
  const canAuthor = orgAdmin || role === "admin" || role === "problem_setter";
  const canManageContests =
    orgAdmin || orgContestSetter || role === "admin" || role === "contest_setter";

  return NextResponse.json({
    authenticated: true,
    role,
    canAccessAdmin: canAuthor || canManageContests,
    canAuthor,
    canManageContests,
  });
}
