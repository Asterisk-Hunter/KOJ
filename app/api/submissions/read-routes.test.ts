import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { NextRequest } from "next/server";
import { getTableName } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";

type ModuleMock = typeof mock & {
  module: (name: string, options: { namedExports: Record<string, unknown> }) => void;
};
const mockModule = (mock as ModuleMock).module.bind(mock);
let owner = "user_1";
let suspended = false;
let problemStatus = "published";
let expired = false;
let sampleQuery: SQL | null = null;

mockModule("@clerk/nextjs/server", { namedExports: { auth: async () => ({ userId: "user_1" }) } });
mockModule("@/app/api/guard", { namedExports: { withApiGuard: (handler: unknown) => handler } });
mockModule("@/lib/organizations", { namedExports: {
  resolveOrganizationContext: async () => ({ organizationId: 1, role: "contestant", suspended }),
} });
mockModule("@/db", { namedExports: { db: { select: () => {
  let tableName = "";
  let filter: SQL;
  const chain = {
    from(table: PgTable) { tableName = getTableName(table); return chain; },
    where(condition: SQL) { filter = condition; return chain; },
    limit() { return chain; },
    orderBy() { return chain; },
    then(resolve: (rows: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) {
      let rows: Record<string, unknown>[];
      switch (tableName) {
        case "submissions": rows = [{ id: 1, userId: owner, mode: "submit", status: "runtime_error", code: "my source",
          errorMessage: "hidden input traceback", caseResults: [{ index: 0, passed: false, verdict: "runtime_error",
            runtime_ms: 1, stdout: "hidden input", stderr: "hidden output" }], submittedAt: new Date(), completedAt: null, startedAt: null }]; break;
        case "problems": rows = [{ id: 1, status: problemStatus, checkerCode: "private checker", explanation: "editorial" }]; break;
        case "contests": rows = [{ status: "live", startsAt: new Date(Date.now() - 10000),
          endsAt: new Date(Date.now() + (expired ? 0 : 10000)) }]; break;
        case "contest_registrations": case "contest_problems": rows = [{}]; break;
        case "problem_test_cases": sampleQuery = filter; rows = [{ input: "sample", expectedOutput: "sample output", privateField: "private" }]; break;
        default: throw new Error(`unexpected query ${tableName}`);
      }
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  return chain;
} } } });
const detail = await import("./[id]/route.ts");
const events = await import("./[id]/events/route.ts");
const problem = await import("../problems/[id]/route.ts");
const context = () => ({ params: Promise.resolve({ id: "1" }) });
const request = (path: string) => new NextRequest(`http://localhost${path}`);

beforeEach(() => {
  owner = "user_1"; suspended = false; problemStatus = "published"; expired = false; sampleQuery = null;
});

test("another contestant cannot retrieve source or status", async () => {
  owner = "other_user";
  assert.equal((await detail.GET(request("/api/submissions/1"), context())).status, 404);
  assert.equal((await events.GET(request("/api/submissions/1/events"), context())).status, 403);
});

test("owner detail and terminal SSE redact stored hidden diagnostics", async () => {
  const response = await detail.GET(request("/api/submissions/1"), context());
  const body = await response.text();
  assert.match(body, /my source/);
  assert.doesNotMatch(body, /hidden input|hidden output/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const sse = await events.GET(request("/api/submissions/1/events"), context());
  const streamBody = await sse.text();
  assert.match(streamBody, /event: done/);
  assert.doesNotMatch(streamBody, /hidden input|my source|user_1/);
});

test("draft problems and suspended users cannot retrieve problem content", async () => {
  problemStatus = "draft";
  assert.equal((await problem.GET(request("/api/problems/1"), context())).status, 404);
  assert.equal(sampleQuery, null);
  problemStatus = "published"; suspended = true;
  assert.equal((await problem.GET(request("/api/problems/1"), context())).status, 403);
  assert.equal((await detail.GET(request("/api/submissions/1"), context())).status, 403);
  assert.equal((await events.GET(request("/api/submissions/1/events"), context())).status, 403);
});

test("problem responses select samples only and never serialize checker code", async () => {
  const body = await (await problem.GET(request("/api/problems/1"), context())).json();
  assert.deepEqual(body.samples, [{ input: "sample", expectedOutput: "sample output" }]);
  assert.equal(body.checkerCode, undefined);
  assert.ok(sampleQuery);
  const query = new PgDialect().sqlToQuery(sampleQuery);
  assert.match(query.sql, /is_sample/);
  assert.ok(query.params.includes(true));
});

test("published problems do not attach an expired official contest at its end boundary", async () => {
  expired = true;
  const body = await (await problem.GET(request("/api/problems/1?contestId=1"), context())).json();
  assert.equal(body.contestId, undefined);
});
