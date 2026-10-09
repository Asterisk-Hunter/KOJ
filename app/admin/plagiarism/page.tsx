import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import PageHeader from "@/app/components/PageHeader";
import { requireOrganizationRole } from "@/lib/organizations";
import { db } from "@/db";
import { problems } from "@/db/schema";
import PlagiarismReport from "./PlagiarismReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PlagiarismPage() {
  const grant = await requireOrganizationRole(["admin"]);
  if (!grant.ok) redirect(grant.response.status === 401 ? "/sign-in" : "/dashboard");

  const problemOptions = await db
    .select({ id: problems.id, title: problems.title })
    .from(problems)
    .where(eq(problems.organizationId, grant.context.organizationId))
    .orderBy(desc(problems.updatedAt))
    .limit(300);

  return (
    <>
      <PageHeader eyebrow="Management / Integrity" title="Similarity Review" description="Advisory, token-based comparison of same-problem submissions." action={{ label: "ADMIN DASHBOARD", href: "/admin" }} />
      <PlagiarismReport problems={problemOptions} />
    </>
  );
}
