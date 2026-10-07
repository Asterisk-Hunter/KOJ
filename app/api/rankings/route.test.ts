import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { NextRequest } from "next/server";
import { getTableName } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import type { StandingsPayload } from "./cache.ts";
import { MAX_STANDINGS_CELLS, MAX_STANDINGS_PROBLEMS } from "./limits.ts";
import { countWrongBefore as realCountWrongBefore, penaltyMinutesForSolve as realPenaltyMinutesForSolve } from "@/lib/scoring";
import { getScoreboardFreezeAt as realFreezeAt, selectRevealedSubmissionIds as realRevealedIds } from "@/app/api/contests/scoreboard-policy";

type ModuleMock = typeof mock & {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => void;
};
const mockModule = (mock as ModuleMock).module.bind(mock);
const base = Date.now();
let now = base;
let contest: { id: number; title: string; status: string; startsAt: Date; endsAt: Date;
  scoreboardFreezeMode: "automatic" | "frozen" | "unfrozen"; scoreboardFrozenAt: Date | null;
  scoreboardRevealCount: number; updatedAt: Date };
type Submission = { id: number; userId: string; problemId: number; teamId: number | null;
  status: string; submittedAt: Date; participation: "official" | "virtual"; mode: "run" | "submit" };
let source: Submission[] = [];
let linkedProblems: Array<{ contestId: number; problemId: number; position: number; problemTitle: string }> = [];
let scoringCalls = 0;
let attempts: Array<{ userId: string; startedAt: Date; endsAt: Date }> = [];
let cached = new Map<string, unknown>();
let forcedCache: unknown;
let cacheFailure = false;
let freezeDuringSubmissionRead = false;
let rescheduleDuringSubmissionRead = false;
let unpublishDuringSubmissionRead = false;
let revokeRegistrationDuringSubmissionRead = false;
let registered = true;
let signedIn = true;
let suspended = false;
let organizationFound = true;
let organizationId = 7;
let organizationRole = "contestant";
let databaseQueries: Array<{ table: string; sql: string; params: unknown[]; limit: number | null }> = [];
let getKeys: string[] = [];
let setKeys: string[] = [];
let submissionQueries: { sql: string; params: unknown[] }[] = [];

mockModule("@/lib/scoring", { namedExports: {
  countWrongBefore: (...args: Parameters<typeof realCountWrongBefore>) => { scoringCalls++; return realCountWrongBefore(...args); },
  penaltyMinutesForSolve: (...args: Parameters<typeof realPenaltyMinutesForSolve>) => { scoringCalls++; return realPenaltyMinutesForSolve(...args); },
} });
mockModule("@/app/api/contests/scoreboard-policy", { namedExports: {
  getScoreboardFreezeAt: (...args: Parameters<typeof realFreezeAt>) => { scoringCalls++; return realFreezeAt(...args); },
  selectRevealedSubmissionIds: (...args: Parameters<typeof realRevealedIds>) => { scoringCalls++; return realRevealedIds(...args); },
} });
mockModule("@clerk/nextjs/server", { namedExports: { auth: async () => ({ userId: signedIn ? "user_1" : null }) } });
mockModule("@/app/api/guard", { namedExports: { withApiGuard: (handler: unknown) => handler } });
mockModule("@/lib/organizations", { namedExports: {
  resolveOrganizationContext: async () => organizationFound ? ({ organizationId, role: organizationRole, isMember: true, suspended }) : null,
} });
mockModule("@/lib/redis", { namedExports: { getRedis: () => ({
  get: async (key: string) => { getKeys.push(key); if (cacheFailure) throw new Error("cache unavailable"); return forcedCache ?? cached.get(key) ?? null; },
  set: async (key: string, value: unknown) => { setKeys.push(key); if (cacheFailure) throw new Error("cache unavailable"); cached.set(key, value); },
}) } });
mockModule("@/db", { namedExports: { db: { select: () => {
  let table = "";
  let filter: SQL | undefined;
  let queryLimit: number | null = null;
  const chain = {
    from(value: PgTable) { table = getTableName(value); return chain; },
    where(value: SQL) { filter = value; return chain; },
    limit(value: number) { queryLimit = value; return chain; },
    orderBy() { return chain; },
    innerJoin() { return chain; },
    then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
      let rows: unknown[];
      assert.ok(filter);
      const parsedQuery = new PgDialect().sqlToQuery(filter);
      databaseQueries.push({ table, ...parsedQuery, limit: queryLimit });
      switch (table) {
        case "contests": rows = parsedQuery.params[0] === 1 && parsedQuery.params[1] === 7 ? [contest] : []; break;
        case "contest_registrations": rows = registered ? [{ userId: "user_1" }] : []; break;
        case "contest_problems": rows = linkedProblems; break;
        case "contest_virtual_registrations": rows = attempts; break;
        case "submissions": {
          assert.ok(filter);
          const query = new PgDialect().sqlToQuery(filter);
          submissionQueries.push(query);
          if (freezeDuringSubmissionRead) {
            contest = { ...contest, scoreboardFreezeMode: "frozen", scoreboardFrozenAt: new Date(contest.startsAt.getTime()),
              updatedAt: new Date(now) };
          }
          if (rescheduleDuringSubmissionRead) contest = { ...contest, startsAt: new Date(now + 60000) };
          if (unpublishDuringSubmissionRead) contest = { ...contest, status: "draft" };
          if (revokeRegistrationDuringSubmissionRead) registered = false;
          rows = source.filter((s) => query.params.includes(s.participation) && query.params.includes(s.mode));
          break;
        }
        case "users": rows = [{ clerkId: "user_1", username: "Alice" }, { clerkId: "user_2", username: "Bob" }]; break;
        case "contest_teams": rows = [{ id: 5, name: "Team" }]; break;
        default: throw new Error(`unexpected table ${table}`);
      }
      return Promise.resolve(queryLimit === null ? rows : rows.slice(0, queryLimit)).then(resolve, reject);
    },
  };
  return chain;
} } } });
const { GET } = await import("./route.ts");
const responseFor = (virtual = false) => GET(new NextRequest(`http://localhost/api/rankings?contestId=1&virtual=${virtual ? "1" : "0"}`));
const read = async (virtual = false): Promise<StandingsPayload> => {
  const response = await responseFor(virtual);
  assert.equal(response.status, 200);
  return response.json();
};
const submission = (id: number, userId: string, submittedAt: Date, participation: "official" | "virtual" = "official"): Submission =>
  ({ id, userId, problemId: 10, teamId: null, status: "accepted", submittedAt, participation, mode: "submit" });

beforeEach((t) => {
  assert.ok("mock" in t);
  now = base;
  t.mock.method(Date, "now", () => now);
  contest = { id: 1, title: "Contest", status: "ended", startsAt: new Date(base - 7200000), endsAt: new Date(base - 3600000),
    scoreboardFreezeMode: "automatic", scoreboardFrozenAt: null, scoreboardRevealCount: 0, updatedAt: new Date(base - 3600000) };
  source = [submission(1, "user_1", new Date(contest.startsAt.getTime() + 60000))];
  linkedProblems = [{ contestId: 1, problemId: 10, position: 1, problemTitle: "Problem" }];
  scoringCalls = 0;
  attempts = [{ userId: "user_1", startedAt: new Date(base - 600000), endsAt: new Date(base + 600000) }];
  cached = new Map(); forcedCache = undefined; cacheFailure = false; freezeDuringSubmissionRead = false;
  rescheduleDuringSubmissionRead = unpublishDuringSubmissionRead = revokeRegistrationDuringSubmissionRead = false;
  registered = signedIn = organizationFound = true; suspended = false; organizationId = 7; organizationRole = "contestant";
  getKeys = []; setKeys = []; submissionQueries = []; databaseQueries = [];
});

test("scheduled published contests deny problem metadata before start, even with a populated cache", async () => {
  await read();
  contest.status = "live";
  contest.startsAt = new Date(now + 60000);
  contest.endsAt = new Date(now + 7200000);
  getKeys = []; setKeys = []; databaseQueries = [];
  for (const viewer of ["contestant", "admin", "anonymous"]) {
    organizationRole = viewer;
    signedIn = viewer !== "anonymous";
    for (const virtual of [false, true]) {
      const response = await responseFor(virtual);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "contest has not started" });
    }
  }
  assert.equal(databaseQueries.some((q) => q.table === "contest_problems"), false);
  assert.deepEqual(getKeys, []);
  assert.deepEqual(setKeys, []);
});

test("live cache hits cannot bypass registration and the exact start is inclusive", async () => {
  contest.status = "live";
  contest.startsAt = new Date(now);
  contest.endsAt = new Date(now + 7200000);
  contest.scoreboardFreezeMode = "unfrozen";
  const allowed = await read();
  assert.equal(allowed.problems[0].problemId, 10);
  assert.equal(allowed.problems[0].title, "Problem");
  assert.ok(cached.has("standings:7:1:official"));
  getKeys = []; databaseQueries = [];
  registered = false;
  assert.equal((await responseFor()).status, 403);
  organizationRole = "admin";
  assert.equal((await responseFor()).status, 403);
  signedIn = false;
  assert.equal((await responseFor()).status, 403);
  assert.equal(databaseQueries.some((q) => q.table === "contest_problems"), false);
  assert.deepEqual(getKeys, []);
  const registrationQuery = databaseQueries.find((q) => q.table === "contest_registrations");
  assert.deepEqual(registrationQuery?.params, [1, "user_1"]);
});

test("suspension and inaccessible organizations deny before cache or source reads", async () => {
  await read();
  getKeys = []; databaseQueries = [];
  suspended = true;
  const denied = await responseFor();
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "account suspended" });
  suspended = false; organizationFound = false;
  assert.equal((await responseFor()).status, 404);
  assert.deepEqual(databaseQueries, []);
  assert.deepEqual(getKeys, []);
});

test("contest lookup is organization scoped even when another organization has a populated cache", async () => {
  await read();
  getKeys = []; databaseQueries = [];
  organizationId = 9;
  assert.equal((await responseFor()).status, 404);
  assert.deepEqual(databaseQueries.map((q) => q.params), [[1, 9]]);
  assert.deepEqual(getKeys, []);
});

test("rescheduling during source reads denies metadata before any cached response", async () => {
  rescheduleDuringSubmissionRead = true;
  const response = await responseFor();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "contest has not started" });
  assert.deepEqual(getKeys, []);
});

test("live registration revocation during source reads denies before cache", async () => {
  contest.status = "live";
  contest.endsAt = new Date(now + 7200000);
  contest.scoreboardFreezeMode = "unfrozen";
  revokeRegistrationDuringSubmissionRead = true;
  assert.equal((await responseFor()).status, 403);
  assert.deepEqual(getKeys, []);
});

test("unpublishing during source reads denies metadata before any cached response", async () => {
  unpublishDuringSubmissionRead = true;
  assert.equal((await responseFor()).status, 404);
  assert.deepEqual(getKeys, []);
});

test("ended and archived public standings remain available to anonymous viewers", async () => {
  signedIn = false; registered = false;
  for (const status of ["ended", "archived"]) {
    contest.status = status;
    assert.equal((await read()).problems[0].problemId, 10);
  }
});

const problemRows = (length: number) => Array.from({ length }, (_, i) => ({
  contestId: 1, problemId: i + 10, position: i + 1, problemTitle: `Problem ${i + 1}`,
}));
const assertNoScoringOrCache = () => {
  assert.equal(scoringCalls, 0);
  assert.deepEqual(getKeys, []);
  assert.deepEqual(setKeys, []);
  assert.equal(databaseQueries.some((q) => q.table === "users" || q.table === "contest_teams"), false);
};

test("linked-problem overflow uses limit plus one and denies before further reads or scoring", async () => {
  await read(); // Even a populated cache cannot bypass the capacity policy.
  getKeys = []; setKeys = []; databaseQueries = []; scoringCalls = 0;
  linkedProblems = problemRows(MAX_STANDINGS_PROBLEMS + 20);
  const response = await responseFor();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: `standings exceed the ${MAX_STANDINGS_PROBLEMS}-problem limit` });
  assert.equal(databaseQueries.find((q) => q.table === "contest_problems")?.limit, MAX_STANDINGS_PROBLEMS + 1);
  assert.equal(databaseQueries.some((q) => q.table === "submissions" || q.table === "contest_virtual_registrations"), false);
  assertNoScoringOrCache();
});

test("exact linked-problem ceiling returns all problems, not a truncated board", async () => {
  linkedProblems = problemRows(MAX_STANDINGS_PROBLEMS);
  const result = await read();
  assert.equal(result.problems.length, MAX_STANDINGS_PROBLEMS);
  assert.equal(result.problems.at(-1)?.problemId, MAX_STANDINGS_PROBLEMS + 9);
  assert.equal(result.rows[0].perProblem.length, MAX_STANDINGS_PROBLEMS);
});

test("official dense-cell overflow denies before scoring, names or cache access", async () => {
  await read();
  getKeys = []; setKeys = []; databaseQueries = []; scoringCalls = 0;
  linkedProblems = problemRows(10);
  const participants = MAX_STANDINGS_CELLS / linkedProblems.length + 1;
  source = Array.from({ length: participants }, (_, i) => submission(i + 1, `user_${i}`, new Date(contest.startsAt.getTime() + 60000)));
  const response = await responseFor();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: `standings exceed the ${MAX_STANDINGS_CELLS}-cell limit (${participants} standing rows × ${linkedProblems.length} problems)`,
  });
  assertNoScoringOrCache();
});

test("virtual participants with zero submissions count toward the dense-cell budget", async () => {
  linkedProblems = problemRows(10);
  source = [];
  const participants = MAX_STANDINGS_CELLS / linkedProblems.length + 1;
  const template = attempts[0];
  attempts = Array.from({ length: participants }, (_, i) => ({ ...template, userId: `user_${i}` }));
  const response = await responseFor(true);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: `standings exceed the ${MAX_STANDINGS_CELLS}-cell limit (${participants} standing rows × ${linkedProblems.length} problems)`,
  });
  assertNoScoringOrCache();
});

test("the exact cell ceiling admits complete official standings and ignores non-emitted rows", async () => {
  linkedProblems = problemRows(10);
  const participants = MAX_STANDINGS_CELLS / linkedProblems.length;
  source = Array.from({ length: participants }, (_, i) => submission(i + 1, `user_${i}`, new Date(contest.startsAt.getTime() + 60000)));
  source.push(submission(participants + 1, "late_user", new Date(contest.endsAt)),
    { ...submission(participants + 2, "unlinked_user", new Date(contest.startsAt.getTime() + 60000)), problemId: 99999 });
  const result = await read();
  assert.equal(result.rows.length, participants);
  assert.equal(result.rows.reduce((total, row) => total + row.perProblem.length, 0), MAX_STANDINGS_CELLS);
  assert.equal(result.rows.every((row) => row.perProblem.length === linkedProblems.length), true);
});

test("the exact cell ceiling admits every zero-submission virtual participant", async () => {
  linkedProblems = problemRows(10);
  source = [];
  const participants = MAX_STANDINGS_CELLS / linkedProblems.length;
  const template = attempts[0];
  attempts = Array.from({ length: participants }, (_, i) => ({ ...template, userId: `user_${i}` }));
  const result = await read(true);
  assert.equal(result.rows.length, participants);
  assert.equal(result.rows.reduce((total, row) => total + row.perProblem.length, 0), MAX_STANDINGS_CELLS);
  assert.equal(result.rows.every((row) => row.solvedCount === 0), true);
});

test("official team members count as one standing row, not one row per member", async () => {
  linkedProblems = problemRows(MAX_STANDINGS_PROBLEMS);
  source = Array.from({ length: 21 }, (_, i) => ({
    ...submission(i + 1, `user_${i}`, new Date(contest.startsAt.getTime() + 60000)), teamId: 5 + Math.floor(i / 3),
  }));
  const result = await read();
  assert.equal(result.rows.length, 7);
  assert.equal(result.rows.reduce((total, row) => total + row.perProblem.length, 0), 7 * MAX_STANDINGS_PROBLEMS);
});

test("source submission cap rejects overflow before cache, without truncating standings", async () => {
  await read();
  getKeys = []; setKeys = []; databaseQueries = [];
  const template = source[0];
  source = Array.from({ length: 50001 }, (_, i) => ({ ...template, id: i + 1 }));
  const response = await responseFor();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "standings exceed the supported contest size" });
  assert.equal(databaseQueries.find((q) => q.table === "submissions")?.limit, 50001);
  assert.deepEqual(getKeys, []);
  assert.deepEqual(setKeys, []);
});

test("virtual registration cap rejects overflow before submissions or cache reads", async () => {
  attempts = Array.from({ length: 50001 }, (_, i) => ({ ...attempts[0], userId: `user_${i}` }));
  const response = await responseFor(true);
  assert.equal(response.status, 503);
  assert.equal(databaseQueries.find((q) => q.table === "contest_virtual_registrations")?.limit, 50001);
  assert.equal(databaseQueries.some((q) => q.table === "submissions"), false);
  assert.deepEqual(getKeys, []);
});

test("valid cache hit retains scoped official key and response contract", async () => {
  const first = await read();
  const second = await read();
  assert.deepEqual(first, second);
  assert.deepEqual(getKeys, ["standings:7:1:official", "standings:7:1:official"]);
  assert.deepEqual(setKeys, ["standings:7:1:official"]);
  assert.equal(submissionQueries.length, 2); // cache never skips authoritative version inputs
  assert.match(submissionQueries[0].sql, /organization_id/);
  assert.ok(submissionQueries[0].params.includes("official"));
  assert.ok(submissionQueries[0].params.includes("submit"));
});

test("malformed, old-format and extra-field cached JSON falls back to DB", async () => {
  for (const bad of ["not JSON", {}, { contest: {}, rows: [] }, { schema: 1, version: "old", expiresAt: now + 8000,
    payload: { code: "private source" } }]) {
    forcedCache = bad;
    const result = await read();
    assert.equal(result.rows[0].solvedCount, 1);
    assert.equal(JSON.stringify(result).includes("private source"), false);
  }
  assert.equal(setKeys.length, 4);
});

test("verdict and rejudge transitions invalidate cached standings without changed counts", async () => {
  assert.equal((await read()).rows[0].solvedCount, 1);
  source[0].status = "running";
  const changed = await read();
  assert.equal(changed.rows[0].solvedCount, 0);
  assert.equal(changed.rows[0].perProblem[0].status, "PENDING");
  source[0].status = "wrong_answer";
  assert.equal((await read()).rows[0].perProblem[0].status, "WA");
  assert.equal(setKeys.length, 3);
});

test("freeze masks hidden outcomes but staged reveal contributes solves, penalties and first-to-solve", async () => {
  contest.scoreboardFreezeMode = "frozen";
  contest.scoreboardFrozenAt = new Date(contest.startsAt.getTime() + 60000);
  contest.scoreboardRevealCount = 2;
  source = [submission(1, "user_1", new Date(contest.startsAt.getTime() + 120000)),
    submission(2, "user_1", new Date(contest.startsAt.getTime() + 180000)),
    submission(3, "user_2", new Date(contest.startsAt.getTime() + 240000))];
  source[0].status = "wrong_answer";
  forcedCache = { leaked: "must not be read during freeze" };
  const result = await read();
  assert.equal(result.contest.isFrozen, true);
  assert.equal(result.rows[0].username, "Alice");
  assert.equal(result.rows[0].solvedCount, 1);
  assert.equal(result.rows[0].penalty, 23);
  assert.equal(result.rows[0].perProblem[0].isFirstToSolve, true);
  assert.equal(result.summary[0].firstSolveMinutes, 3);
  assert.equal(result.rows[1].perProblem[0].status, "PENDING");
  assert.deepEqual(getKeys, []);
  assert.deepEqual(setKeys, []);
});

test("freeze edits made while reading verdicts refresh visibility before scoring", async () => {
  freezeDuringSubmissionRead = true;
  const result = await read();
  assert.equal(result.contest.isFrozen, true);
  assert.equal(result.rows[0].solvedCount, 0);
  assert.equal(result.rows[0].perProblem[0].status, "PENDING");
  assert.deepEqual(getKeys, []);
});

test("automatic freeze and end boundaries cannot reuse pre-boundary cached payloads", async () => {
  contest.status = "live";
  contest.startsAt = new Date(base - 7200000);
  contest.endsAt = new Date(base + 3600000);
  source[0].submittedAt = new Date(base - 60000);
  now = base - 1;
  assert.equal((await read()).contest.isFrozen, false);
  const stored = cached.get("standings:7:1:official") as { expiresAt: number };
  assert.equal(stored.expiresAt, base);
  now = base;
  source.push(submission(2, "user_2", new Date(base)));
  const frozen = await read();
  assert.equal(frozen.contest.isFrozen, true);
  assert.equal(frozen.rows.find((r) => r.username === "Bob")?.perProblem[0].status, "PENDING");
  now = contest.endsAt.getTime();
  const final = await read();
  assert.equal(final.contest.isFrozen, false);
  assert.equal(final.rows.find((r) => r.username === "Bob")?.solvedCount, 1);
});

test("virtual cache, timing and first-to-solve remain separate from official freezes", async () => {
  await read();
  contest.scoreboardFreezeMode = "frozen";
  contest.scoreboardFrozenAt = new Date(contest.startsAt.getTime() + 60000);
  source.push(submission(2, "user_1", new Date(attempts[0].startedAt.getTime() + 120000), "virtual"));
  const result = await read(true);
  assert.equal(result.contest.participation, "virtual");
  assert.equal(result.contest.isFrozen, false);
  assert.equal(result.rows[0].penalty, 2);
  assert.equal(result.rows[0].perProblem[0].isFirstToSolve, false);
  assert.equal(result.summary[0].firstSolveMinutes, null);
  assert.equal(getKeys.at(-1), "standings:7:1:virtual");
  assert.equal(setKeys.at(-1), "standings:7:1:virtual");
});

test("official team grouping does not merge separate virtual attempts", async () => {
  source[0].teamId = 5;
  source.push({ ...submission(2, "user_2", new Date(contest.startsAt.getTime() + 120000)), teamId: 5 });
  const official = await read();
  assert.equal(official.rows.length, 1);
  assert.equal(official.rows[0].username, "Team");
  attempts.push({ ...attempts[0], userId: "user_2" });
  source.push({ ...submission(3, "user_1", new Date(base - 480000), "virtual"), teamId: 5 },
    { ...submission(4, "user_2", new Date(base - 420000), "virtual"), teamId: 5 });
  assert.equal((await read(true)).rows.length, 2);
});

test("official and virtual end windows exclude late or unregistered historical rows", async () => {
  source[0].submittedAt = new Date(contest.endsAt);
  assert.equal((await read()).rows.length, 0);
  source = [submission(2, "user_1", new Date(attempts[0].endsAt), "virtual"),
    submission(3, "user_2", new Date(base), "virtual")];
  const result = await read(true);
  assert.equal(result.rows.length, 1); // registered virtual participants still appear with zero solves
  assert.equal(result.rows[0].solvedCount, 0);
});

test("Redis read and write failures leave authoritative standings usable", async () => {
  cacheFailure = true;
  const result = await read();
  assert.equal(result.rows[0].solvedCount, 1);
});
