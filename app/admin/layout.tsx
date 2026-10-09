import { redirect } from "next/navigation";
import { requireOrganizationRole } from "@/lib/organizations";

export const runtime = "nodejs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const grant = await requireOrganizationRole(["admin", "setter"]);
  if (!grant.ok) redirect(grant.response.status === 401 ? "/sign-in" : "/dashboard");

  return <>{children}</>;
}
