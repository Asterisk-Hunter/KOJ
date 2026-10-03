export type AccessRole = "admin" | "setter" | "contestant" | null;
export type StaffAccess = "admin" | "contestManager";
export type AccessDecision = "allowed" | "suspended" | "forbidden";

export function decideStaffAccess(
  role: AccessRole,
  suspended: boolean,
  allowlistedAdmin: boolean,
  access: StaffAccess,
): AccessDecision {
  if (suspended) return "suspended";

  if (access === "admin") {
    return role === "admin" || allowlistedAdmin ? "allowed" : "forbidden";
  }

  return role === "admin" || role === "setter" ? "allowed" : "forbidden";
}
