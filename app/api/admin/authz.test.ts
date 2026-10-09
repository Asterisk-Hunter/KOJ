import assert from "node:assert/strict";
import test, { mock } from "node:test";

// @types/node 20 predates node:test module mocking; the node 22 runtime has it.
type ModularMock = typeof mock & {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => void;
};
const mockModule: ModularMock["module"] = (mock as ModularMock).module.bind(mock);

type StaffRole = "admin" | "setter" | "contestant";
type Session = { isAuthenticated: boolean; userId: string | null };
type UserRow = { role: StaffRole; suspended: boolean };

let session: Session = { isAuthenticated: false, userId: null };
let userRow: UserRow | null = null;
let organizationFound = true;

function json(body: unknown, init?: { status?: number }) {
  return { body, status: init?.status ?? 200 };
}

// Test doubles for what authz.ts reads: Clerk identity, the Neon users row,
// and the organization membership check the role gates delegate to. The
// organization role policy itself is covered by lib/organization-policy.test.ts.
mockModule("@clerk/nextjs/server", {
  namedExports: {
    auth: async () => session,
    clerkClient: async () => {
      throw new Error("clerkClient is not a gate dependency");
    },
  },
});

mockModule("next/server", {
  namedExports: { NextResponse: { json } },
});

mockModule("@/db", {
  namedExports: {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (userRow ? [userRow] : []),
          }),
        }),
      }),
    },
  },
});

mockModule("@/db/schema", { namedExports: { users: { clerkId: "clerkId" } } });
mockModule("drizzle-orm", { namedExports: { eq: () => ({}) } });

mockModule("@/lib/organizations", {
  namedExports: {
    requireOrganizationRole: async (roles: readonly StaffRole[]) => {
      if (!session.isAuthenticated || !session.userId) {
        return { ok: false, response: json({ error: "unauthorized" }, { status: 401 }) };
      }
      if (!organizationFound) {
        return { ok: false, response: json({ error: "organization not found" }, { status: 404 }) };
      }
      if (!userRow || userRow.suspended || !roles.includes(userRow.role)) {
        return { ok: false, response: json({ error: "forbidden" }, { status: 403 }) };
      }
      return {
        ok: true,
        userId: session.userId,
        context: {
          organizationId: 1,
          slug: "koj",
          name: "KOJ",
          isPublic: true,
          role: userRow.role,
          isMember: true,
          suspended: false,
        },
      };
    },
  },
});

const authz = await import("./authz.ts");

type Grant = {
  ok: boolean;
  dbRole?: string | null;
  role?: string;
  response?: { body: unknown; status?: number };
};

const gates: { name: string; allowedRoles: StaffRole[]; call: () => Promise<Grant> }[] = [
  { name: "requireAdmin", allowedRoles: ["admin"], call: () => authz.requireAdmin() },
  { name: "requireSetter", allowedRoles: ["admin", "setter"], call: () => authz.requireSetter() },
  { name: "requireStaff", allowedRoles: ["admin", "setter"], call: () => authz.requireStaff() },
  {
    name: "requireContestManager",
    allowedRoles: ["admin", "setter"],
    call: () => authz.requireContestManager(),
  },
  {
    name: "requireOrganizationAdmin",
    allowedRoles: ["admin"],
    call: () => authz.requireOrganizationAdmin(),
  },
];

function signIn(role: StaffRole | null, suspended = false) {
  session = { isAuthenticated: true, userId: "user_1" };
  userRow = role ? { role, suspended } : null;
  organizationFound = true;
}

function signOut() {
  session = { isAuthenticated: false, userId: null };
  userRow = null;
  organizationFound = true;
}

function assertDenied(grant: Grant, status: number, error: string) {
  assert.equal(grant.ok, false);
  assert.equal(grant.response?.status, status);
  assert.deepEqual(grant.response?.body, { error });
}

test("anonymous callers are rejected with 401", async () => {
  signOut();
  for (const gate of gates) {
    assertDenied(await gate.call(), 401, "unauthorized");
  }
});

test("contestants are rejected with 403 by every gate", async () => {
  signIn("contestant");
  for (const gate of gates) {
    assertDenied(await gate.call(), 403, "forbidden");
  }
});

test("setters pass staff gates and fail admin-only gates", async () => {
  signIn("setter");
  for (const gate of gates) {
    const grant = await gate.call();
    if (gate.allowedRoles.includes("setter")) {
      assert.equal(grant.ok, true, `${gate.name} must allow setters`);
    } else {
      assertDenied(grant, 403, "forbidden");
    }
  }
  const setterGrant: Grant = await authz.requireSetter();
  assert.equal(setterGrant.dbRole, "setter");
});

test("admins pass every gate", async () => {
  signIn("admin");
  for (const gate of gates) {
    assert.equal((await gate.call()).ok, true, `${gate.name} must allow admins`);
  }
});

test("staff gates report a missing organization as 404", async () => {
  signIn("admin");
  organizationFound = false;
  for (const gate of gates.filter((entry) => entry.name !== "requireAdmin")) {
    assertDenied(await gate.call(), 404, "organization not found");
  }
});

test("suspension revokes admin and setter grants", async () => {
  signIn("admin", true);
  assertDenied(await authz.requireAdmin(), 403, "account suspended");

  signIn("setter", true);
  assertDenied(await authz.requireSetter(), 403, "forbidden");
});

test("ADMIN_CLERK_IDS allowlists an account without an admin row", async () => {
  process.env.ADMIN_CLERK_IDS = "user_0, user_1";
  try {
    signIn(null);
    assert.equal((await authz.requireAdmin()).ok, true);

    signIn("contestant");
    assert.equal((await authz.requireAdmin()).ok, true);
  } finally {
    delete process.env.ADMIN_CLERK_IDS;
  }
});

test("the allowlist does not open setter gates", async () => {
  process.env.ADMIN_CLERK_IDS = "user_1";
  try {
    signIn(null);
    assertDenied(await authz.requireSetter(), 403, "forbidden");
  } finally {
    delete process.env.ADMIN_CLERK_IDS;
  }
});

test("requireStaff reports the granted staff role", async () => {
  signIn("admin");
  const staffGrant: Grant = await authz.requireStaff();
  assert.equal(staffGrant.role, "admin");
});
