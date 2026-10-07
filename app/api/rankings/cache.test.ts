import assert from "node:assert/strict";
import { test } from "node:test";
import { readStandingsCache, standingsCacheEntry, standingsVersion } from "./cache.ts";
import type { StandingsPayload } from "./cache.ts";

const now = 1700000000000;
const payload: StandingsPayload = {
  contest: { id: 1, title: "Contest", status: "ended", startsAt: new Date(now - 7200000).toISOString(),
    endsAt: new Date(now - 3600000).toISOString(), isFrozen: false, freezeMode: "automatic", participation: "official",
    freezeMinutesRemaining: 0, revealedAfterFreeze: 0 },
  problems: [{ problemId: 10, title: "Problem", position: 1, label: "A", balloonColor: "red", balloonName: "Red", balloonClass: "bg-red-500" }],
  summary: [{ problemId: 10, label: "A", totalSolved: 1, totalAttempts: 1, firstSolveMinutes: 1, acceptanceRate: 100 }],
  rows: [{ rank: 1, username: "contestant", solvedCount: 1, penalty: 1,
    perProblem: [{ problemId: 10, status: "AC", attempts: 1, penaltyMinutes: 1, isFirstToSolve: true, timeMinutes: 1, pendingAttempts: 0 }],
    solved: ["AC"] }],
};
const entry = () => standingsCacheEntry(structuredClone(payload), "current", now + 8000);

test("only a validated current, unexpired cache envelope is accepted", () => {
  assert.deepEqual(readStandingsCache(entry(), "current", payload.contest, now), payload);
  for (const value of [null, false, "json", [], {}, payload, { ...entry(), schema: 0 },
    { ...entry(), version: "stale" }, { ...entry(), expiresAt: now }, { ...entry(), expiresAt: Infinity },
    { ...entry(), expiresAt: now + 8001 }]) {
    assert.equal(readStandingsCache(value, "current", payload.contest, now), null);
  }
});

test("cache entries cannot cross participation, freeze, reveal or contest boundaries", () => {
  for (const change of [{ participation: "virtual" as const }, { isFrozen: true }, { freezeMode: "frozen" },
    { revealedAfterFreeze: 1 }, { status: "live" }, { endsAt: new Date(now).toISOString() }, { id: 2 }]) {
    assert.equal(readStandingsCache(entry(), "current", { ...payload.contest, ...change }, now), null);
  }
});

test("malformed nested JSON and unexpected fields never become HTTP payloads", () => {
  const extra = entry();
  const withCode = { ...extra, payload: { ...extra.payload, code: "private source" } };
  assert.equal(readStandingsCache(withCode, "current", payload.contest, now), null);
  const malformedRow = entry();
  malformedRow.payload.rows[0].perProblem = [];
  assert.equal(readStandingsCache(malformedRow, "current", payload.contest, now), null);
  const mismatchedStatuses = entry();
  mismatchedStatuses.payload.rows[0].solved = ["WA"];
  assert.equal(readStandingsCache(mismatchedStatuses, "current", payload.contest, now), null);
  const numeric = entry();
  numeric.payload.rows[0].penalty = NaN;
  assert.equal(readStandingsCache(numeric, "current", payload.contest, now), null);
});

test("source versions detect verdict/rejudge changes without relying on completion maxima", () => {
  const inputs = { organizationId: 1, participation: "official", submissions: [{ id: 1, status: "accepted", completedAt: now }] };
  assert.equal(standingsVersion(inputs), standingsVersion(structuredClone(inputs)));
  assert.notEqual(standingsVersion(inputs), standingsVersion({ ...inputs, submissions: [{ ...inputs.submissions[0], status: "running" }] }));
  assert.notEqual(standingsVersion(inputs), standingsVersion({ ...inputs, organizationId: 2 }));
  assert.notEqual(standingsVersion(inputs), standingsVersion({ ...inputs, participation: "virtual" }));
});
