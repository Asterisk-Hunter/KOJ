import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import PageHeader from "@/app/components/PageHeader";
import { requireAdmin } from "@/app/api/admin/authz";
import { db } from "@/db";
import { problems } from "@/db/schema";
import PlagiarismReport from "./PlagiarismReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PlagiarismPage() {
  const grant = await requireAdmin();
  if (!grant.ok) redirect(grant.response.status === 401 ? "/sign-in" : "/dashboard");

  const problemOptions = await db
    .select({ id: problems.id, title: problems.title })
    .from(problems)
    .orderBy(desc(problems.updatedAt))
    .limit(300);

  return (
    <>
      <PageHeader eyebrow="Management / Integrity" title="Similarity Review" description="Advisory, token-based comparison of same-problem submissions." action={{ label: "ADMIN DASHBOARD", href: "/admin" }} />
      <PlagiarismReport problems={problemOptions} />
    </>
  );
}
