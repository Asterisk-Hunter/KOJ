import assert from "node:assert/strict";
import test from "node:test";
import { getManualFreezeAt, getScoreboardFreezeAt, selectRevealedSubmissionIds } from "./scoreboard-policy.ts";

test("freeze mode supports automatic, explicit freeze, and explicit unfreeze", () => {
  const startsAt = new Date("2026-01-01T10:00:00Z");
  const endsAt = new Date("2026-01-01T12:00:00Z");
  assert.equal(getScoreboardFreezeAt("automatic", null, startsAt, endsAt)?.toISOString(), "2026-01-01T11:00:00.000Z");
  assert.equal(getScoreboardFreezeAt("frozen", new Date("2026-01-01T10:30:00Z"), startsAt, endsAt)?.toISOString(), "2026-01-01T10:30:00.000Z");
  assert.equal(getScoreboardFreezeAt("unfrozen", null, startsAt, endsAt), null);
});

test("manual freeze preserves an active cutoff and starts now when previously unfrozen", () => {
  const start = new Date("2026-01-01T10:00:00Z");
  const end = new Date("2026-01-01T12:00:00Z");
  const now = new Date("2026-01-01T11:30:00Z");
  assert.equal(getManualFreezeAt("automatic", null, start, end, now).toISOString(), "2026-01-01T11:00:00.000Z");
  const earlier = new Date("2026-01-01T10:30:00Z");
  assert.equal(getManualFreezeAt("frozen", earlier, start, end, now), earlier);
  assert.equal(getManualFreezeAt("unfrozen", null, start, end, now), now);
  const beforeAutoFreeze = new Date("2026-01-01T10:30:00Z");
  assert.equal(getManualFreezeAt("automatic", null, start, end, beforeAutoFreeze), beforeAutoFreeze);
});

test("staged reveal is chronological and stable for ties", () => {
  const freezeAt = new Date("2026-01-01T11:00:00Z");
  const submissions = [
    { id: 8, submittedAt: new Date("2026-01-01T11:01:00Z") },
    { id: 4, submittedAt: new Date("2026-01-01T10:59:00Z") },
    { id: 7, submittedAt: new Date("2026-01-01T11:00:00Z") },
    { id: 6, submittedAt: new Date("2026-01-01T11:01:00Z") },
  ];
  assert.deepEqual([...selectRevealedSubmissionIds(submissions, freezeAt, 2)], [7, 6]);
  assert.equal(selectRevealedSubmissionIds(submissions, freezeAt, 99).size, 3);
});
