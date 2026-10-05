import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Navigation from "@/app/components/Navigation";
import { db } from "@/db";
import { organizationMemberships, organizations, users } from "@/db/schema";
import { resolveOrganizationContext } from "@/lib/organizations";
import OrganizationManager from "./OrganizationManager";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const [user] = await db
    .select({ suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (user?.suspended) notFound();

  const [visibleOrganizations, activeOrganization] = await Promise.all([
    db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        isPublic: organizations.isPublic,
        role: organizationMemberships.role,
      })
      .from(organizations)
      .leftJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.organizationId, organizations.id),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .where(or(eq(organizations.isPublic, true), eq(organizationMemberships.userId, userId)))
      .orderBy(asc(organizations.name))
      .limit(100),
    resolveOrganizationContext(userId),
  ]);
  if (activeOrganization?.suspended) notFound();

  const members = activeOrganization?.role === "admin"
    ? await db
        .select({
          userId: organizationMemberships.userId,
          username: users.username,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.clerkId))
        .where(eq(organizationMemberships.organizationId, activeOrganization.organizationId))
        .orderBy(asc(users.username))
        .limit(500)
    : [];

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-kjbg bg-grid px-4 pb-16 pt-24 text-kjtext sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 border-b border-kjborder-bright pb-6">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-kjprimary">KOJ / Access Control</p>
            <h1 className="mt-3 font-mono text-3xl font-semibold tracking-tight text-white sm:text-4xl">Organizations</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-kjtext-muted">
              Create a workspace, join a public judge, or manage membership in an organization you administer.
            </p>
          </div>
          <OrganizationManager
            initialOrganizations={visibleOrganizations}
            initialMembers={members}
            activeSlug={activeOrganization?.slug ?? null}
          />
        </div>
      </main>
    </>
  );
}
