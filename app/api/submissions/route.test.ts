import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";

type ModuleMock = typeof mock & {
  module: (name: string, options: { namedExports: Record<string, unknown> }) => void;
};
const mockModule = (mock as ModuleMock).module.bind(mock);
type Row = Record<string, unknown>;
let signedIn = true;
let problemStatus = "published";
let currentProblemStatus = "published";
let contestStatus = "live";
let currentContestStatus = "live";
let endAtAdmission = false;
let expireVirtualAtAdmission = false;
let revokeRegistrationAtAdmission = false;
let unlinkAtAdmission = false;

let virtualEndsAt = new Date(Date.now() + 60000);
let registered = true;
let linked = true;
let failEnqueue = false;
let active = { globalActive: 0, organizationActive: 0, userActive: 0 };
let recent: Date | null = null;
let committed: Row[] = [];
let committedJobs: Row[] = [];
let transactionTail = Promise.resolve();
let transactionCalls = 0;
let lockCalls = 0;

function query(tableRows: () => Row[]) {
  const chain = {
    from(table: PgTable) { tableName = getTableName(table); return chain; },
    where() { return chain; },
    limit() { return chain; },
    orderBy() { return chain; },
    innerJoin() { return chain; },
    for() { return chain; },
    then(resolve: (rows: Row[]) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve().then(tableRows).then(resolve, reject);
    },
  };
  let tableName = "";
  return { chain, name: () => tableName };
}

function select(inTransaction: boolean) {
  const q = query(() => {
    switch (q.name()) {
      case "problems": return [{ id: 1, status: inTransaction ? currentProblemStatus : problemStatus }];
      case "contests": return [{ status: inTransaction ? currentContestStatus : contestStatus,
        startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + (inTransaction && endAtAdmission ? 0 : 60000)) }];
      case "contest_registrations": return registered ? [{ teamId: null }] : [];
      case "contest_virtual_registrations": return [{ endsAt: virtualEndsAt }];
      case "contest_problems": return linked ? [{}] : [];
      case "users": return [{ suspended: false }];
      case "problem_test_cases": return [{ id: 1 }];
      case "judge_jobs": return [active];
      case "submissions": return recent ? [{ submittedAt: recent }] : [];
      default: throw new Error(`unexpected table ${q.name()}`);
    }
  });
  return q.chain;
}

mockModule("@clerk/nextjs/server", { namedExports: {
  auth: async () => ({ userId: signedIn ? "user_1" : null }),
  clerkClient: async () => { throw new Error("unexpected Clerk lookup"); },
} });
mockModule("@/app/api/guard", { namedExports: { withApiGuard: (handler: unknown) => handler } });
mockModule("@/lib/organizations", { namedExports: {
  resolveOrganizationContext: async () => ({ organizationId: 1, suspended: false }),
} });
mockModule("@/app/api/contests/lifecycle", { namedExports: { settleExpiredContests: async () => {} } });
mockModule("@/db", { namedExports: { db: {
  select: () => select(false),
  transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    transactionCalls++;
    const previous = transactionTail;
    let release = () => {};
    transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const staged: Row[] = [];
    const stagedJobs: Row[] = [];
    try {
      const result = await callback({
        execute: async () => {
          lockCalls++;
          if (expireVirtualAtAdmission) virtualEndsAt.setTime(Date.now());
          if (revokeRegistrationAtAdmission) registered = false;
          if (unlinkAtAdmission) linked = false;
        },
        select: () => select(true),
        insert: (table: PgTable) => ({ values: (row: Row) => {
          if (getTableName(table) === "judge_jobs") {
            if (failEnqueue) return Promise.reject(new Error("enqueue unavailable"));
            stagedJobs.push(row);
            return Promise.resolve();
          }
          staged.push(row);
          return { returning: async () => [{ id: 42 }] };
        } }),
      });
      committed.push(...staged);
      committedJobs.push(...stagedJobs);
      if (staged[0]?.submittedAt instanceof Date) recent = staged[0].submittedAt;
      return result;
    } finally { release(); }
  },
} } });

const { POST } = await import("./route.ts");
const request = (contestId: number | null = null, mode = "submit") => new NextRequest("http://localhost/api/submissions", {
  method: "POST", body: JSON.stringify({ problemId: 1, contestId, language: "python", code: "print(1)", mode }),
});

beforeEach(() => {
  signedIn = true;
  problemStatus = currentProblemStatus = "published";
  contestStatus = currentContestStatus = "live";
  endAtAdmission = expireVirtualAtAdmission = revokeRegistrationAtAdmission = unlinkAtAdmission = false;

  virtualEndsAt = new Date(Date.now() + 60000);
  registered = linked = true;
  failEnqueue = false;
  active = { globalActive: 0, organizationActive: 0, userActive: 0 };
  recent = null;
  committed = []; committedJobs = [];
  transactionCalls = lockCalls = 0;
});

test("enqueue and submission commit together with an admission timestamp", async () => {
  const response = await POST(request());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { id: 42, status: "pending" });
  assert.equal(committed.length, 1);
  assert.deepEqual(committedJobs, [{ submissionId: 42 }]);
  assert.ok(committed[0].submittedAt instanceof Date);
  assert.equal(lockCalls, 2);
});

test("enqueue failure rolls back the pending submission", async () => {
  failEnqueue = true;
  await assert.rejects(POST(request()), /enqueue unavailable/);
  assert.deepEqual(committed, []);
  assert.deepEqual(committedJobs, []);
});

test("concurrent duplicate submits cannot create two jobs", async () => {
  const responses = await Promise.all([POST(request()), POST(request())]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [202, 429]);
  assert.equal(committed.length, 1);
  assert.equal(committedJobs.length, 1);
});

test("run and submit share the cooldown and return Retry-After", async () => {
  recent = new Date();
  const response = await POST(request(null, "run"));
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) >= 1);
  assert.equal(committed.length, 0);
});

test("queue capacity denial has no partial writes", async () => {
  active.globalActive = 500;
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(committed.length, 0);
});

test("contest ending during admission rejects rather than committing", async () => {
  currentContestStatus = "ended";
  const response = await POST(request(1));
  assert.equal(response.status, 403);
  assert.equal(committed.length, 0);
});

test("registration revocation while waiting prevents enqueue", async () => {
  revokeRegistrationAtAdmission = true;
  assert.equal((await POST(request(1))).status, 403);
  assert.equal(committedJobs.length, 0);
});

test("removed contest problem link is rechecked before enqueue", async () => {
  unlinkAtAdmission = true;
  assert.equal((await POST(request(1))).status, 403);
  assert.equal(committedJobs.length, 0);
});

test("official end boundary is exclusive even after waiting for locks", async () => {
  endAtAdmission = true;
  assert.equal((await POST(request(1))).status, 403);
  assert.equal(committed.length, 0);
});

test("virtual end boundary is rechecked after admission locks", async () => {
  contestStatus = currentContestStatus = "ended";
  expireVirtualAtAdmission = true;
  assert.equal((await POST(request(1))).status, 403);
  assert.equal(committed.length, 0);
});

test("cooldown allows a submit at exactly 30 seconds", async (t) => {
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  recent = new Date(now - 30000);
  assert.equal((await POST(request())).status, 202);
});

test("practice access revoked while waiting rejects the insert", async () => {
  currentProblemStatus = "contest_active";
  assert.equal((await POST(request())).status, 403);
  assert.equal(committed.length, 0);
});

test("draft contest problems, unregistered users and missing links cannot enqueue", async () => {
  problemStatus = "draft";
  assert.equal((await POST(request(1))).status, 404);
  problemStatus = "contest_active";
  registered = false;
  assert.equal((await POST(request(1))).status, 403);
  registered = true; linked = false;
  assert.equal((await POST(request(1))).status, 400);
  assert.equal(transactionCalls, 0);
});

test("expired virtual attempts and anonymous users cannot enqueue", async () => {

  contestStatus = currentContestStatus = "ended";
  virtualEndsAt = new Date(Date.now() - 1);
  assert.equal((await POST(request(1))).status, 403);
  signedIn = false;
  assert.equal((await POST(request())).status, 401);
  assert.equal(transactionCalls, 0);
});
