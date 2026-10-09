import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import { NextRequest } from "next/server";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { RateBudget } from "../../rate-limit.ts";

type ModuleMock = typeof mock & {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => void;
};
const mockModule = (mock as ModuleMock).module.bind(mock);
let signedIn = true;
let suspended = false;
let problemStatus = "contest_active";
let contestStatus = "ended";
let registered = true;
let linked = true;
let attempt: { startedAt: Date; endsAt: Date } | null;
let contestEndsAt: Date;
let budgets: RateBudget[] = [];
let budgetHits = 0;
let expireDuringBudget = false;
let judgeCalls = 0;
let sent: Record<string, unknown> | null = null;
let previousEnv: NodeJS.ProcessEnv;

mockModule("@clerk/nextjs/server", { namedExports: { auth: async () => ({ userId: signedIn ? "user_1" : null }) } });
mockModule("@/app/api/guard", { namedExports: { withApiGuard: (handler: unknown) => handler } });
mockModule("@/lib/organizations", { namedExports: {
  resolveOrganizationContext: async () => ({ organizationId: 7, suspended, isMember: true }),
} });
mockModule("@/app/api/rate-limit", { namedExports: {
  consumeRateBudget: async (budget: RateBudget) => {
    budgets.push(budget);
    if (expireDuringBudget && attempt) attempt.endsAt.setTime(Date.now());
    return { allowed: ++budgetHits === 1, retryAfter: 3 };
  },
} });
mockModule("@/db", { namedExports: { db: { select: () => {
  let table = "";
  const chain = {
    from(value: PgTable) { table = getTableName(value); return chain; },
    where() { return chain; },
    limit: async () => {
      switch (table) {
        case "problems": return [{ status: problemStatus, outputComparator: "exact", absoluteTolerance: 0.000001,
          relativeTolerance: 0.000001, checkerCode: null }];
        case "contests": return [{ status: contestStatus, startsAt: new Date(Date.now() - 7200000), endsAt: contestEndsAt }];
        case "contest_registrations": return registered ? [{ userId: "user_1" }] : [];
        case "contest_virtual_registrations": return attempt ? [attempt] : [];
        case "contest_problems": return linked ? [{ problemId: 1 }] : [];
        default: throw new Error(`unexpected table ${table}`);
      }
    },
  };
  return chain;
} } } });
const route = await import("./route.ts");
const worker = "another";
const anotherInstance: typeof route = await import(`./route.ts?worker=${worker}`);

beforeEach((t) => {
  assert.ok("mock" in t);
  signedIn = true; suspended = false; problemStatus = "contest_active"; contestStatus = "ended";
  registered = linked = true;
  contestEndsAt = new Date(Date.now() - 60000);
  attempt = { startedAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60000) };
  budgets = []; budgetHits = 0; judgeCalls = 0; sent = null; expireDuringBudget = false;
  previousEnv = process.env;
  process.env = { NODE_ENV: "test", FASTAPI_URL: "https://judge.invalid", JUDGE_INTERNAL_SECRET: "test" };
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    judgeCalls++;
    sent = JSON.parse(String(options.body));
    return Response.json({ status: "accepted", passed_tests: 1, total_tests: 1, execution_time_ms: 1,
      error_message: null, cases: [{ index: 0, passed: true, verdict: "accepted", runtime_ms: 1, stdout: "1", stderr: "" }] });
  });
});
afterEach(() => { process.env = previousEnv; });

const request = (overrides: Record<string, unknown> = {}) => new NextRequest("http://localhost/api/judge/run", {
  method: "POST", body: JSON.stringify({ language: "python", code: "print(1)", problemId: 1, contestId: 1,
    input: "", expectedOutput: "1", ...overrides }),
});

test("active virtual participation works for ended and archived contests", async () => {
  for (const status of ["ended", "archived"]) {
    contestStatus = status; budgetHits = 0;
    assert.equal((await route.POST(request())).status, 200);
  }
  assert.equal(judgeCalls, 2);
  assert.deepEqual(sent?.cases, [{ stdin: "", expected_stdout: "1", is_sample: true }]);
});

test("virtual access requires a started, unexpired attempt and contest problem link", async () => {
  attempt = null;
  assert.equal((await route.POST(request())).status, 403);
  attempt = { startedAt: new Date(Date.now() + 60000), endsAt: new Date(Date.now() + 120000) };
  assert.equal((await route.POST(request())).status, 403);
  attempt = { startedAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now()) };
  assert.equal((await route.POST(request())).status, 403);
  attempt.endsAt = new Date(Date.now() + 60000); linked = false;
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(judgeCalls, 0);
  assert.equal(budgets.length, 0);
});

test("official access uses registration and an exclusive contest end boundary", async () => {
  contestStatus = "live"; contestEndsAt = new Date(Date.now() + 60000);
  registered = false;
  assert.equal((await route.POST(request())).status, 403);
  registered = true;
  assert.equal((await route.POST(request())).status, 200);
  contestEndsAt = new Date(Date.now());
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(judgeCalls, 1);
});

test("published problem context still enforces virtual access; practice stays available", async () => {
  problemStatus = "published"; attempt = null;
  assert.equal((await route.POST(request())).status, 403);
  assert.equal((await route.POST(request({ contestId: null }))).status, 200);
});

test("null, primitive, empty, oversized and malformed case arrays return 400 without judging", async () => {
  for (const cases of [null, "cases", {}, [], [null], [1], [[]], [{}], [{ stdin: "x" }],
    [{ stdin: 1, expectedOutput: "x" }], [{ stdin: "x", expectedOutput: null }],
    Array.from({ length: 11 }, () => ({ stdin: "", expectedOutput: "" })),
    [{ stdin: "x".repeat(65537), expectedOutput: "" }]]) {
    assert.equal((await route.POST(request({ cases }))).status, 400, JSON.stringify(cases)?.slice(0, 100));
  }
  assert.equal(judgeCalls, 0);
  assert.equal(budgets.length, 0);
});

test("custom input and output must be strings; valid multi-case bodies reach the judge", async () => {
  for (const overrides of [{ input: null }, { expectedOutput: 1 }]) {
    assert.equal((await route.POST(request(overrides))).status, 400);
  }
  const cases = [{ stdin: "a", expectedOutput: "1" }];
  assert.equal((await route.POST(request({ cases }))).status, 200);
  assert.deepEqual(sent?.cases, [{ stdin: "a", expected_stdout: "1", is_sample: true }]);
});

test("shared cooldown rejects concurrent requests across route module instances", async () => {
  const responses = await Promise.all([route.POST(request()), anotherInstance.POST(request())]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 429]);
  const rejected = responses.find((r) => r.status === 429);
  assert.equal(rejected?.headers.get("Retry-After"), "3");
  assert.equal(judgeCalls, 1);
  assert.deepEqual(budgets, Array.from({ length: 2 }, () => ({ scope: "interactive-cooldown", identity: "user_1", limit: 1, windowSeconds: 2.5 })));
});

test("access expiry during shared budget acquisition prevents dispatch", async () => {
  expireDuringBudget = true;
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(judgeCalls, 0);
});

test("anonymous, suspended and draft access never reaches the judge", async () => {
  signedIn = false;
  assert.equal((await route.POST(request())).status, 401);
  signedIn = true; suspended = true;
  assert.equal((await route.POST(request())).status, 403);
  suspended = false; problemStatus = "draft";
  assert.equal((await route.POST(request())).status, 404);
  assert.equal(judgeCalls, 0);
});
