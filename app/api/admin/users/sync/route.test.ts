import assert from "node:assert/strict";
import test, { mock } from "node:test";

type ModuleMock = typeof mock & {
  module: (name: string, options: { namedExports: Record<string, unknown> }) => void;
};
const mockModule = (mock as ModuleMock).module.bind(mock);

type DirectoryUser = { id: string };
let directoryUsers: DirectoryUser[] = [];
let directoryTotalCount = 0;
let mutateDirectoryPage: ((offset: number) => DirectoryUser[] | null) | null = null;
let neonRows: Array<{ clerkId: string }> = [];
let deletedUsers: string[] = [];
let requestedOffsets: number[] = [];

mockModule("@/app/api/guard", { namedExports: { withApiGuard: (handler: unknown) => handler } });
mockModule("@/app/api/admin/authz", {
  namedExports: {
    requireAdmin: async () => ({ ok: true, userId: "admin_1" }),
    jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  },
});
mockModule("@clerk/nextjs/server", {
  namedExports: {
    clerkClient: async () => ({
      users: {
        getUserList: async ({ limit, offset }: { limit: number; offset: number }) => {
          requestedOffsets.push(offset);
          const page = mutateDirectoryPage?.(offset) ?? directoryUsers.slice(offset, offset + limit);
          return { data: page, totalCount: directoryTotalCount };
        },
      },
    }),
  },
});
mockModule("@/db/schema", { namedExports: { users: "users" } });
mockModule("@/db", {
  namedExports: {
    db: {
      select: () => ({ from: async () => neonRows }),
    },
  },
});
mockModule("@/app/api/webhooks/clerk/route", {
  namedExports: {
    handleUserDeleted: async (clerkId: string) => {
      deletedUsers.push(clerkId);
      return "deleted";
    },
  },
});

const { POST } = await import("./route.ts");

function reset(options?: {
  directoryUsers?: DirectoryUser[];
  directoryTotalCount?: number;
  neonRows?: Array<{ clerkId: string }>;
  mutateDirectoryPage?: ((offset: number) => DirectoryUser[] | null) | null;
}) {
  directoryUsers = options?.directoryUsers ?? [];
  directoryTotalCount = options?.directoryTotalCount ?? directoryUsers.length;
  neonRows = options?.neonRows ?? [];
  mutateDirectoryPage = options?.mutateDirectoryPage ?? null;
  deletedUsers = [];
  requestedOffsets = [];
}

async function post(body: Record<string, unknown> = {}) {
  return POST(new Request("http://localhost/api/admin/users/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("preview scans the entire directory and never mutates Neon users", async () => {
  reset({
    directoryUsers: Array.from({ length: 5201 }, (_, index) => ({ id: `user_${index}` })),
    neonRows: [{ clerkId: "missing_user" }],
  });

  const response = await post();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "preview");
  assert.equal(body.directoryUsers, 5201);
  assert.equal(body.checked, 1);
  assert.equal(body.missing, 1);
  assert.deepEqual(requestedOffsets, [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]);
  assert.deepEqual(deletedUsers, []);
});

test("confirmation applies only the exact previewed plan", async () => {
  reset({ directoryUsers: [{ id: "current_user" }], neonRows: [{ clerkId: "missing_user" }] });
  const preview = await (await post()).json();

  const response = await post({ confirmation: "DELETE OR ANONYMIZE 1 USERS", planToken: preview.planToken });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "applied");
  assert.equal(body.removed, 1);
  assert.deepEqual(deletedUsers, ["missing_user"]);
});

test("invalid or stale confirmation fails without mutation", async () => {
  reset({ directoryUsers: [{ id: "current_user" }], neonRows: [{ clerkId: "missing_user" }] });
  const preview = await (await post()).json();

  const invalid = await post({ confirmation: "DELETE OR ANONYMIZE 1 USERS", planToken: "0".repeat(64) });
  assert.equal(invalid.status, 409);
  directoryUsers = [{ id: "changed_directory" }];
  const staleAfterChange = await post({ confirmation: "DELETE OR ANONYMIZE 1 USERS", planToken: preview.planToken });
  assert.equal(staleAfterChange.status, 409);
  assert.deepEqual(deletedUsers, []);
});

test("an incomplete Clerk page fails closed", async () => {
  reset({
    directoryUsers: [{ id: "first" }, { id: "second" }],
    directoryTotalCount: 2,
    neonRows: [{ clerkId: "missing_user" }],
    mutateDirectoryPage: (offset) => offset === 0 ? [] : null,
  });

  const response = await post();

  assert.equal(response.status, 502);
  assert.deepEqual(deletedUsers, []);
});
