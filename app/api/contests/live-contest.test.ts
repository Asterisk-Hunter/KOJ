import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import type { NextRequest } from "next/server";

// Node 22 supports module mocks; the project's Node 20 types predate them.
type ModuleMock = typeof mock & { module: (id: string, options: { namedExports: Record<string, unknown> }) => void };
const mockModule = (mock as ModuleMock).module.bind(mock);
type Row = Record<string, unknown>;
type Table = { tableName: string } & Record<string, string>;
type Predicate = (row: Row) => boolean;
type Expression = { text: string; values: unknown[]; mapWith: (mapper: unknown) => Expression };
const table = (name: string, fields: string[]): Table => Object.fromEntries([
  ["tableName", name], ...fields.map((field) => [field, `${name}.${field}`]),
]);
const schema = {
  contests: table("contests", ["id", "slug", "organizationId", "status", "startsAt", "endsAt", "updatedAt", "scoreboardRevealCount", "scoreboardFreezeMode", "scoreboardFrozenAt"]),
  users: table("users", ["clerkId"]),
  contestTeams: table("teams", ["id", "contestId", "name"]),
  contestRegistrations: table("registrations", ["contestId", "userId", "teamId"]),
  contestVirtualRegistrations: table("virtual", ["contestId", "userId", "startedAt", "endsAt"]),
  contestProblems: table("links", ["contestId", "problemId", "organizationId", "position"]),
  problems: table("problems", ["id", "organizationId", "status"]),
  contestClarifications: table("questions", ["id", "contestId", "authorId", "visibility", "createdAt", "question", "answer", "answeredAt"]),
  contestAnnouncements: table("announcements", ["id", "contestId", "createdAt"]),
  submissions: table("submissions", ["id", "contestId", "organizationId", "mode", "participation", "submittedAt", "completedAt", "problemId", "userId", "teamId", "status"]),
};
const valueOf = (row: Row, column: string): unknown => row[column.split(".")[1]];
const eq = (column: string, value: unknown): Predicate => (row) => valueOf(row, column) === value;
const and = (...conditions: Predicate[]): Predicate => (row) => conditions.every((condition) => condition(row));
const compare = (value: unknown): number => value instanceof Date ? value.getTime() : Number(value);
const sql = (strings: TemplateStringsArray, ...values: unknown[]): Expression => {
  const expression: Expression = { text: strings.join("?"), values, mapWith: () => expression };
  return expression;
};
let rows: Record<string, Row[]>;
let authUsers: Array<string | null>;
let suspended: boolean;
let role: "contestant" | "setter";
let bodyRead: (() => void) | null;
let lockRead: ((tableName: string) => void) | null;
let lockTail: Promise<void>;
let locks: string[];
let invalidations: string[];
let readCount: number;
let inserted: ((tableName: string) => void) | null;
let cachedVersion: unknown;
let cacheEnabled: boolean;
let redisRead: (() => Promise<unknown>) | null;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const NOW = new Date("2026-01-01T11:00:00Z").getTime();

function project(row: Row, fields?: Row): Row {
  if (!fields) return { ...row };
  return Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, valueOf(row, String(column))]));
}

// This double models a transaction lock only when the handler actually requests
// FOR UPDATE. Reads take fresh snapshots after acquiring it; no DB is imported.
function onInsert(tableName: string) { inserted?.(tableName); }

function executor(acquire?: () => Promise<void>) {
  return {
    select(fields?: Row) {
      let source: Table;
      let predicate: Predicate = () => true;
      let limit = Infinity;
      let locked = false;
      let group: string | null = null;
      const query = {
        from(input: Table) { source = input; return query; },
        where(input: Predicate) { predicate = input; return query; },
        orderBy() { return query; },
        limit(input: number) { limit = input; return query; },
        for() { locked = true; return query; },
        groupBy(column: string) { group = column; return query; },
        async then(resolve: (result: Row[]) => unknown, reject: (error: unknown) => unknown) {
          try {
            if (locked) {
              assert.ok(acquire, "row locks must be inside the transaction");
              await acquire();
              locks.push(source.tableName);
              lockRead?.(source.tableName);
            }
            readCount += 1;
            const selected = (rows[source.tableName] ?? []).filter(predicate).slice(0, limit);
            if (group) {
              const grouped = new Map<unknown, Row[]>();
              for (const row of selected) {
                const key = valueOf(row, group);
                grouped.set(key, [...(grouped.get(key) ?? []), row]);
              }
              resolve([...grouped].map(([problemId, attempts]) => ({ problemId, attempts: attempts.length, isSolved: attempts.some((row) => row.status === "accepted") })));
            } else if (fields && Object.values(fields).some((field) => typeof field === "object")) {
              resolve([Object.fromEntries(Object.keys(fields).map((key) => {
                if (key === "count") return [key, selected.length];
                if (key === "judgedCount") return [key, selected.filter((row) => row.completedAt !== null).length];
                const column = key === "maxSubmittedAt" ? "submittedAt" : "completedAt";
                const dates = selected.flatMap((row) => row[column] instanceof Date ? [row[column].getTime()] : []);
                return [key, dates.length ? new Date(Math.max(...dates)).toISOString() : null];
              }))]);
            } else resolve(selected.map((row) => project(row, fields)));
          } catch (error) { reject(error); }
        },
      };
      return query;
    },
    insert(source: Table) {
      let values: Row;
      let ignoreConflict = false;
      const insert = () => {
        const target = rows[source.tableName];
        const duplicate = (source.tableName === "registrations" || source.tableName === "virtual") && target.some((row) => row.contestId === values.contestId && row.userId === values.userId);
        if (duplicate) {
          if (ignoreConflict) return [];
          throw new Error("duplicate registration");
        }
        const inserted = { id: target.length + 1, ...values };
        target.push(inserted);
        onInsert(source.tableName);
        return [inserted];
      };
      const query = {
        values(input: Row) { values = input; return query; },
        onConflictDoNothing() { ignoreConflict = true; return query; },
        async returning(fields: Row) { return insert().map((row) => project(row, fields)); },
        async then(resolve: (result: Row[]) => unknown, reject: (error: unknown) => unknown) {
          try { resolve(insert()); } catch (error) { reject(error); }
        },
      };
      return query;
    },
    update(source: Table) {
      return { set: (patch: Row) => ({ where: async (predicate: Predicate) => {
        for (const row of rows[source.tableName].filter(predicate)) Object.assign(row, patch);
      } }) };
    },
    delete(source: Table) {
      return { where: async (predicate: Predicate) => { rows[source.tableName] = rows[source.tableName].filter((row) => !predicate(row)); } };
    },
  };
}
const db = {
  ...executor(),
  async transaction<T>(operation: (tx: ReturnType<typeof executor>) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    let snapshot: Record<string, Row[]> | undefined;
    const acquire = async () => {
      if (release) return;
      const previous = lockTail;
      lockTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      snapshot = structuredClone(rows);
    };
    try { return await operation(executor(acquire)); }
    catch (error) { if (snapshot) rows = snapshot; throw error; }
    finally { release?.(); }
  },
};
const jsonError = (error: string, status: number) => Response.json({ error }, { status });
mockModule("@/db", { namedExports: { db } });
mockModule("@/db/schema", { namedExports: schema });
mockModule("drizzle-orm", { namedExports: {
  eq, and, sql, asc: (column: string) => column, desc: (column: string) => column,
  or: (...conditions: Predicate[]): Predicate => (row) => conditions.some((condition) => condition(row)),
  inArray: (column: string, values: unknown[]): Predicate => (row) => values.includes(valueOf(row, column)),
  gte: (column: string, value: unknown): Predicate => (row) => compare(valueOf(row, column)) >= compare(value),
  lt: (column: string, value: unknown): Predicate => (row) => compare(valueOf(row, column)) < compare(value),
} });
mockModule("next/server", { namedExports: { NextRequest: Request, NextResponse: { json: Response.json } } });
mockModule("@clerk/nextjs/server", { namedExports: {
  auth: async () => ({ userId: authUsers.shift() ?? null }),
  clerkClient: async () => { throw new Error("Clerk network access is forbidden in this suite"); },
} });
mockModule("@/lib/organizations", { namedExports: {
  resolveOrganizationContext: async () => ({ organizationId: 1, suspended, role }),
} });
mockModule("@/app/api/guard", { namedExports: { withApiGuard: (handler: unknown) => handler } });
mockModule("@/app/api/body-guard", { namedExports: {
  MAX_CONTEST_BODY_BYTES: 10000, MAX_CONTEST_REGISTRATION_BODY_BYTES: 10000, MAX_CONTEST_PROBLEM_LINK_BODY_BYTES: 10000,
  readBoundedJsonObject: async (request: Request) => {
    const value: unknown = await request.json(); bodyRead?.(); bodyRead = null;
    return { ok: true, value };
  },
} });
mockModule("@/app/api/admin/authz", { namedExports: {
  jsonError, ensureUserRow: async () => true,
  requireContestManager: async () => role === "setter" && !suspended
    ? { ok: true, userId: "staff", context: { organizationId: 1 } }
    : { ok: false, response: jsonError("forbidden", 403) },
} });
mockModule("@/app/api/admin/audit-logs/writer", { namedExports: { recordAdminAuditEvent: async () => undefined } });
mockModule("@/lib/redis", { namedExports: { getRedis: () => ({
  get: async () => {
    const read = redisRead; redisRead = null;
    return read ? await read() : cacheEnabled ? cachedVersion : null;
  },
  set: async (key: string, value: unknown) => { assert.match(key, /^contest_version:1:1:(official|virtual):v2$/); cachedVersion = value; },
  del: async (...keys: string[]) => { invalidations.push(...keys); },
}) } });
mockModule("@/app/api/contests/lifecycle", { namedExports: {
  settleExpiredContests: async () => 0,
  contestRequiresInvite: (contest: Row) => contest.inviteCodeHash !== null || contest.inviteCode !== null,
  deriveContestUiStatus: (status: string, start: Date, end: Date, now: Date) => status === "ended" || status === "archived" || now >= end ? "Finished" : now < start ? "Registration Open" : "Active",
  nextStatuses: (status: string) => ({ draft: ["live"], live: ["draft", "ended"], ended: ["archived"], archived: ["ended"] })[status],
  lockLinkedProblems: async () => { for (const problem of rows.problems) problem.status = "contest_active"; },
  releaseLinkedProblems: async () => undefined, revertLinkedProblems: async () => undefined,
} });

const registration = await import("./[id]/register/route.ts");
const detail = await import("./[id]/route.ts");
const virtual = await import("./[id]/virtual/route.ts");
const progress = await import("./[id]/progress/route.ts");
const questions = await import("./[id]/clarifications/route.ts");
const admin = await import("../admin/contests/[id]/route.ts");
const scoreboard = await import("../admin/contests/[id]/scoreboard/route.ts");
const problemLinks = await import("../admin/contests/[id]/problems/route.ts");
const events = await import("./[id]/events/route.ts");
const { hashInviteCode } = await import("./invite-code.ts");
const ctx = (id = "round-one") => ({ params: Promise.resolve({ id }) });
function request(body: Row = {}): NextRequest {
  return new Request("http://localhost/api/contests/round-one", { method: "POST", body: JSON.stringify(body) }) as NextRequest;
}

function eventRequest(query = "", signal?: AbortSignal): NextRequest {
  const url = `http://localhost/api/contests/round-one/events${query}`;
  const req = new Request(url, { signal }) as NextRequest;
  Object.assign(req, { nextUrl: new URL(url) });
  return req;
}

beforeEach(() => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: NOW });
  rows = Object.fromEntries(Object.values(schema).map((entry) => [entry.tableName, []]));
  rows.contests.push({ id: 1, slug: "round-one", organizationId: 1, title: "Round", status: "live", startsAt: new Date(NOW - 3600000), endsAt: new Date(NOW + 3600000), updatedAt: new Date(NOW), inviteCode: null, inviteCodeHash: null, scoreboardFreezeMode: "automatic", scoreboardFrozenAt: null, scoreboardRevealCount: 0 });
  rows.users = ["a", "b", "c", "d"].map((clerkId) => ({ clerkId }));
  rows.links.push({ contestId: 1, organizationId: 1, problemId: 9, position: 0 });
  rows.problems.push({ id: 9, organizationId: 1, status: "contest_active", title: "Secret title", difficulty: "hard", tags: ["secret algorithm"], statement: "Secret statement", explanation: "Secret solution" });
  authUsers = ["a"]; suspended = false; role = "contestant";
  bodyRead = null; lockRead = null; lockTail = Promise.resolve(); locks = []; invalidations = [];
  readCount = 0; inserted = null; cachedVersion = null; cacheEnabled = false; redisRead = null;
});
afterEach(() => mock.timers.reset());

test("concurrent team creation is idempotent and returns the actual roster", async () => {
  authUsers = ["a", "a"];
  const responses = await Promise.all([registration.POST(request({ teamName: "Alpha" }), ctx()), registration.POST(request({ teamName: "Beta" }), ctx())]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  assert.equal(rows.teams.length, 1); assert.equal(rows.registrations.length, 1);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.ok(bodies.every((body) => body.teamId === rows.teams[0].id));
  assert.equal(locks.filter((name) => name === "contests").length, 2);
});

test("concurrent joins cannot exceed three members", async () => {
  rows.teams.push({ id: 1, contestId: 1, joinCodeHash: hashInviteCode("team-secret") });
  rows.registrations.push({ contestId: 1, userId: "a", teamId: 1 }, { contestId: 1, userId: "b", teamId: 1 });
  authUsers = ["c", "d"];
  const responses = await Promise.all([registration.POST(request({ teamCode: "1.team-secret" }), ctx()), registration.POST(request({ teamCode: "1.team-secret" }), ctx())]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(rows.registrations.length, 3);
});

test("an existing solo registration is not falsely reported as a new team join", async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  const response = await registration.POST(request({ teamCode: "1.invalid-code" }), ctx());
  assert.deepEqual(await response.json(), { registered: true, already: true, teamId: null });
});

test("registration rechecks deadline and rotated invite after lock wait", async () => {
  lockRead = () => mock.timers.tick(3600000);
  assert.equal((await registration.POST(request(), ctx())).status, 403);
  assert.equal(rows.registrations.length, 0);
  mock.timers.setTime(NOW);
  authUsers = ["a"];
  lockRead = () => { rows.contests[0].inviteCode = "rotated"; };
  assert.equal((await registration.POST(request(), ctx())).status, 403);
  assert.equal(rows.registrations.length, 0);
});

test("team creation rolls back if the deadline passes before registration is written", async () => {
  inserted = (tableName) => { if (tableName === "teams") mock.timers.tick(3600000); };
  const response = await registration.POST(request({ teamName: "Too late" }), ctx());
  assert.equal(response.status, 403);
  assert.equal(rows.teams.length, 0); assert.equal(rows.registrations.length, 0);
});

test("team codes cannot select a team from another contest", async () => {
  rows.teams.push({ id: 1, contestId: 2, joinCodeHash: hashInviteCode("team-secret") });
  assert.equal((await registration.POST(request({ teamCode: "1.team-secret" }), ctx())).status, 403);
});

test("scheduled and unregistered viewers receive no problem identifiers or hints", async () => {
  rows.contests[0].startsAt = new Date(NOW + 1);
  const scheduled = await detail.GET(request(), ctx());
  assert.deepEqual((await scheduled.json()).problems, []);
  rows.contests[0].startsAt = new Date(NOW - 1); authUsers = [null];
  const publicView = await (await detail.GET(request(), ctx())).json();
  assert.deepEqual(publicView.problems, []); assert.equal(publicView.problemsCount, 1);
});

test("registered contestants see statements but never live explanations", async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  const body = await (await detail.GET(request(), ctx())).json();
  assert.equal(body.problems[0].statement, "Secret statement");
  assert.equal(body.problems[0].explanation, null);
  authUsers = ["a"]; suspended = true;
  assert.deepEqual((await (await detail.GET(request(), ctx())).json()).problems, []);
});

test("virtual start resolves slugs and concurrent starts cannot reset the clock", async () => {
  rows.contests[0].status = "ended"; rows.contests[0].endsAt = new Date(NOW);
  authUsers = ["a", "a"];
  const responses = await Promise.all([virtual.POST(request(), ctx()), virtual.POST(request(), ctx())]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(rows.virtual.length, 1);
  assert.equal(compare(rows.virtual[0].endsAt) - compare(rows.virtual[0].startedAt), 3600000);
});

test("virtual start refuses live, cross-organization, and invalid-duration contests", async () => {
  assert.equal((await virtual.POST(request(), ctx())).status, 409);
  authUsers = ["a"]; rows.contests[0].organizationId = 2;
  assert.equal((await virtual.POST(request(), ctx())).status, 404);
  authUsers = ["a"]; rows.contests[0].organizationId = 1; rows.contests[0].status = "ended";
  rows.contests[0].endsAt = rows.contests[0].startsAt;
  assert.equal((await virtual.POST(request(), ctx())).status, 409);
});

test("virtual arena progress excludes official, run, foreign, and expired-window submissions", async () => {
  rows.contests[0].status = "ended"; rows.contests[0].endsAt = new Date(NOW - 1000);
  rows.virtual.push({ contestId: 1, userId: "a", startedAt: new Date(NOW - 1000), endsAt: new Date(NOW + 1000) });
  const attempt = { organizationId: 1, contestId: 1, userId: "a", problemId: 9, participation: "virtual", mode: "submit", status: "wrong_answer", submittedAt: new Date(NOW) };
  rows.submissions.push(attempt, { ...attempt, participation: "official", status: "accepted" }, { ...attempt, mode: "run", status: "accepted" }, { ...attempt, userId: "b", status: "accepted" }, { ...attempt, submittedAt: new Date(NOW + 1000), status: "accepted" });
  assert.deepEqual(await (await progress.GET(request(), ctx("1"))).json(), [{ problemId: 9, attempts: 1, isSolved: false }]);
});

test("arena progress denies anonymous, suspended, unregistered and foreign-organization viewers", async () => {
  authUsers = [null];
  assert.equal((await progress.GET(request(), ctx("1"))).status, 401);
  authUsers = ["a"]; suspended = true;
  assert.equal((await progress.GET(request(), ctx("1"))).status, 403);
  authUsers = ["a"]; suspended = false;
  assert.equal((await progress.GET(request(), ctx("1"))).status, 403);
  authUsers = ["a"]; rows.contests[0].organizationId = 2;
  assert.equal((await progress.GET(request(), ctx("1"))).status, 404);
});

test("arena progress closes at the exact official and virtual deadlines", async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  rows.contests[0].endsAt = new Date(NOW);
  assert.equal((await progress.GET(request(), ctx("1"))).status, 403);
  authUsers = ["a"]; rows.contests[0].status = "ended";
  rows.virtual.push({ contestId: 1, userId: "a", startedAt: new Date(NOW - 1000), endsAt: new Date(NOW) });
  assert.equal((await progress.GET(request(), ctx("1"))).status, 403);
});

test("official team progress includes teammates but not other teams", async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: 3 });
  const attempt = { organizationId: 1, contestId: 1, userId: "b", teamId: 3, problemId: 9, participation: "official", mode: "submit", status: "accepted", submittedAt: new Date(NOW) };
  rows.submissions.push(attempt, { ...attempt, teamId: 4 }, { ...attempt, participation: "virtual" });
  assert.deepEqual(await (await progress.GET(request(), ctx("1"))).json(), [{ problemId: 9, attempts: 1, isSolved: true }]);
});

test("clarification submission rechecks the live deadline after reading the body", async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  bodyRead = () => mock.timers.tick(3600000);
  assert.equal((await questions.POST(request({ question: "Help?" }), ctx())).status, 403);
  assert.equal(rows.questions.length, 0);
});

test("clarifications disclose only the viewer's private questions and answered broadcasts", async () => {
  rows.questions.push({ id: 1, contestId: 1, authorId: "b", question: "private", answer: "private answer", visibility: "private" }, { id: 2, contestId: 1, authorId: "a", question: "mine", answer: null, visibility: "private" }, { id: 3, contestId: 1, authorId: "b", question: "public", answer: "broadcast", visibility: "public" }, { id: 4, contestId: 1, authorId: "b", question: "unanswered", answer: null, visibility: "public" });
  const body = await (await questions.GET(request(), ctx())).json();
  assert.deepEqual(body.clarifications.map((row: { id: number }) => row.id), [2, 3]);
});

test("draft metadata cannot race publishing and overwrite live state", async () => {
  role = "setter"; rows.contests[0].status = "draft"; rows.problems[0].status = "draft";
  const responses = await Promise.all([admin.PATCH(request({ status: "live" }), ctx("1")), admin.PATCH(request({ title: "Late edit" }), ctx("1"))]);
  assert.deepEqual(responses.map((response) => response.status), [200, 400]);
  assert.equal(rows.contests[0].status, "live"); assert.equal(rows.contests[0].title, "Round");
});

test("linking a problem cannot race publication and alter a live contest", async () => {
  role = "setter"; rows.contests[0].status = "draft"; rows.problems[0].status = "draft";
  rows.problems.push({ id: 10, organizationId: 1, status: "draft" });
  const responses = await Promise.all([admin.PATCH(request({ status: "live" }), ctx("1")), problemLinks.POST(request({ problemId: 10 }), ctx("1"))]);
  assert.deepEqual(responses.map((response) => response.status), [200, 400]);
  assert.equal(rows.links.length, 1);
});

test("a draft problem already linked to another contest cannot be linked again", async () => {
  role = "setter";
  rows.contests.push({ id: 2, slug: "round-two", organizationId: 1, title: "Round Two", status: "draft", startsAt: new Date(NOW + 7200000), endsAt: new Date(NOW + 10800000) });
  rows.problems[0].status = "draft";

  const response = await problemLinks.POST(request({ problemId: 9 }), ctx("2"));

  assert.equal(response.status, 409);
  assert.equal(rows.links.length, 1);
  assert.equal(rows.links[0].contestId, 1);
});

test("draft deletion cannot race publication and remove a live contest", async () => {
  role = "setter"; rows.contests[0].status = "draft"; rows.problems[0].status = "draft";
  const responses = await Promise.all([admin.PATCH(request({ status: "live" }), ctx("1")), admin.DELETE(request(), ctx("1"))]);
  if (responses[0].status === 200) {
    assert.equal(responses[1].status, 400);
    assert.equal(rows.contests[0].status, "live");
  } else {
    assert.equal(responses[0].status, 404);
    assert.equal(responses[1].status, 200);
    assert.equal(rows.contests.length, 0);
  }
});

test("publishing rejects expired contests and already-exposed problems", async () => {
  role = "setter"; rows.contests[0].status = "draft";
  assert.equal((await admin.PATCH(request({ status: "live" }), ctx("1"))).status, 409);
  rows.problems[0].status = "draft"; rows.contests[0].endsAt = new Date(NOW);
  assert.equal((await admin.PATCH(request({ status: "live" }), ctx("1"))).status, 400);
});

test("publish rechecks expiry after waiting on linked problem locks", async () => {
  role = "setter"; rows.contests[0].status = "draft"; rows.problems[0].status = "draft";
  lockRead = (tableName) => { if (tableName === "problems") mock.timers.tick(3600000); };
  const response = await admin.PATCH(request({ status: "live" }), ctx("1"));
  assert.equal(response.status, 400); assert.equal(rows.contests[0].status, "draft");
});

test("ending a scheduled contest cannot create a negative virtual duration", async () => {
  role = "setter"; rows.contests[0].startsAt = new Date(NOW + 1000);
  assert.equal((await admin.PATCH(request({ status: "ended" }), ctx("1"))).status, 400);
  assert.equal(rows.contests[0].status, "live");
});

test("freeze invalidates the same organization-scoped keys used by standings", async () => {
  role = "setter";
  assert.equal((await scoreboard.POST(request({ action: "freeze" }), ctx("1"))).status, 200);
  assert.deepEqual(invalidations, ["standings:1:1:official", "standings:1:1:virtual"]);
  assert.equal(rows.contests[0].scoreboardFreezeMode, "frozen");
});

test("explicit freeze never advances the cutoff of an active automatic freeze", async () => {
  role = "setter"; mock.timers.setTime(NOW + 300000);
  assert.equal((await scoreboard.POST(request({ action: "freeze" }), ctx("1"))).status, 200);
  assert.equal(compare(rows.contests[0].scoreboardFrozenAt), NOW);
});

test("concurrent staged reveal increments are serialized and capped to scored submissions", async () => {
  role = "setter"; rows.contests[0].status = "ended"; rows.contests[0].endsAt = new Date(NOW);
  rows.contests[0].scoreboardFreezeMode = "frozen"; rows.contests[0].scoreboardFrozenAt = new Date(NOW - 1000);
  const attempt = { organizationId: 1, contestId: 1, mode: "submit", participation: "official", submittedAt: new Date(NOW - 1) };
  rows.submissions.push(attempt, { ...attempt, participation: "virtual" }, { ...attempt, submittedAt: new Date(NOW) });
  await Promise.all([scoreboard.POST(request({ action: "reveal-next" }), ctx("1")), scoreboard.POST(request({ action: "reveal-next" }), ctx("1"))]);
  assert.equal(rows.contests[0].scoreboardRevealCount, 1);
});

async function readVersion(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Row> {
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  const data = new TextDecoder().decode(chunk.value).split("\n").find((line) => line.startsWith("data: "));
  assert.ok(data);
  return JSON.parse(data.slice(6)) as Row;
}

function deferred() {
  let resolve: (value: unknown) => void = () => { throw new Error("deferred promise not initialized"); };
  const promise = new Promise<unknown>((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("SSE phase changes at freeze/end boundaries even with a cached version and no writes", { timeout: 5000 }, async () => {
  cacheEnabled = true;
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  mock.timers.setTime(NOW - 1);
  const response = await events.GET(eventRequest(), ctx());
  const reader = response.body?.getReader(); assert.ok(reader);
  assert.equal((await readVersion(reader)).timePhase, "live");
  await flush();
  const before = readCount;
  mock.timers.tick(2000); await flush();
  assert.equal((await readVersion(reader)).timePhase, "automatic-freeze");
  mock.timers.tick(3600000); await flush();
  assert.equal((await readVersion(reader)).timePhase, "finished");
  assert.equal(readCount, before, "time boundaries cannot depend on another database read");
  assert.equal(invalidations.length, 3, "invalidate standings before notifying each changed phase");
  await reader.cancel();
});

test("SSE version changes on completion and reveal state even when updatedAt is unchanged", { timeout: 5000 }, async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  rows.submissions.push({ organizationId: 1, contestId: 1, mode: "submit", participation: "official", submittedAt: new Date(NOW - 1), completedAt: null });
  const response = await events.GET(eventRequest(), ctx());
  const reader = response.body?.getReader(); assert.ok(reader);
  assert.equal((await readVersion(reader)).judgedCount, 0); await flush();
  rows.submissions[0].completedAt = new Date(NOW);
  mock.timers.tick(2000); await flush();
  assert.equal((await readVersion(reader)).judgedCount, 1);
  rows.contests[0].scoreboardRevealCount = 1;
  mock.timers.tick(2000); await flush();
  assert.equal((await readVersion(reader)).revealCount, 1);
  assert.equal(invalidations.length, 3);
  await reader.cancel();
});

test("SSE cancellation during startup stops polling and further cache work", { timeout: 5000 }, async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  const pending = deferred(); redisRead = () => pending.promise;
  const response = await events.GET(eventRequest(), ctx());
  const reader = response.body?.getReader(); assert.ok(reader);
  const before = readCount;
  const canceled = reader.cancel(); pending.resolve(null);
  await canceled; await flush(); mock.timers.tick(10000); await flush();
  assert.equal(readCount, before); assert.deepEqual(invalidations, []);
});

test("request abort closes a starting SSE stream and never installs a polling timer", { timeout: 5000 }, async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  const pending = deferred(); redisRead = () => pending.promise;
  const controller = new AbortController();
  const req = eventRequest("", controller.signal);
  const response = await events.GET(req, ctx());
  const reader = response.body?.getReader(); assert.ok(reader);
  const before = readCount;
  controller.abort(); pending.resolve(null); await flush();
  assert.equal((await reader.read()).done, true);
  mock.timers.tick(10000); await flush();
  assert.equal(readCount, before); assert.deepEqual(invalidations, []);
});

test("cancelling a running SSE stream clears polling", { timeout: 5000 }, async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  const response = await events.GET(eventRequest(), ctx());
  const reader = response.body?.getReader(); assert.ok(reader);
  await readVersion(reader); await flush();
  await reader.cancel();
  const before = readCount;
  mock.timers.tick(10000); await flush();
  assert.equal(readCount, before);
});

test("SSE closes after its bounded tick budget and leaves no polling timer", { timeout: 5000 }, async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  const response = await events.GET(eventRequest(), ctx());
  const reader = response.body?.getReader(); assert.ok(reader);
  await readVersion(reader); await flush();
  for (let i = 0; i < 25; i++) {
    mock.timers.tick(2000); await flush();
    await readVersion(reader);
  }
  assert.equal((await reader.read()).done, true);
  const before = readCount;
  mock.timers.tick(10000); await flush();
  assert.equal(readCount, before);
});

test("standings events change when a verdict completes and do not expose verdicts", async () => {
  rows.registrations.push({ contestId: 1, userId: "a", teamId: null });
  rows.submissions.push({ organizationId: 1, contestId: 1, mode: "submit", participation: "official", submittedAt: new Date(NOW - 1), completedAt: new Date(NOW) });
  const response = await events.GET(eventRequest(), ctx());
  const reader = response.body?.getReader();
  assert.ok(reader);
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /"maxCompletedAt":"2026-01-01T11:00:00.000Z"/);
  assert.match(event, /"judgedCount":1/); assert.doesNotMatch(event, /accepted|wrong_answer/);
  assert.deepEqual(invalidations, ["standings:1:1:official"]);
  await reader.cancel();
});

test("virtual standings events version virtual submissions and invalidate their cache", async () => {
  rows.contests[0].status = "ended";
  rows.contests[0].endsAt = new Date(NOW);
  rows.submissions.push({ organizationId: 1, contestId: 1, mode: "submit", participation: "virtual", submittedAt: new Date(NOW - 1), completedAt: null });
  const req = eventRequest("?virtual=1");

  const response = await events.GET(req, ctx());
  const reader = response.body?.getReader(); assert.ok(reader);
  assert.equal((await readVersion(reader)).judgedCount, 0);
  await flush();
  rows.submissions[0].completedAt = new Date(NOW);
  mock.timers.tick(2000); await flush();
  assert.equal((await readVersion(reader)).judgedCount, 1);
  assert.deepEqual(invalidations, ["standings:1:1:virtual", "standings:1:1:virtual"]);
  await reader.cancel();
});
