import { withApiGuard } from "@/app/api/guard";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { MAX_ADMIN_USER_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { ORGANIZATION_COOKIE, resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = await readBoundedJsonObject(request, MAX_ADMIN_USER_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { slug } = parsed.value;
  if (typeof slug !== "string" || slug.length > 48) {
    return NextResponse.json({ error: "invalid organization slug" }, { status: 400 });
  }
  const organization = await resolveOrganizationContext(userId, slug);
  if (!organization) return NextResponse.json({ error: "organization not found" }, { status: 404 });
  if (organization.suspended) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const cookieStore = await cookies();
  cookieStore.set(ORGANIZATION_COOKIE, organization.slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ organization });
}

export const POST = withApiGuard(handlePOST);
