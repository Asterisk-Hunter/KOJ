import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ProblemCreateClient from "@/app/problems/create/ProblemCreateClient";
import { requireOrganizationRole } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProblemCreatePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent("/problems/create")}`);
  }

  const grant = await requireOrganizationRole(["admin", "setter"]);
  if (!grant.ok) {
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
