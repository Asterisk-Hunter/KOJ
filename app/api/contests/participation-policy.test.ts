import assert from "node:assert/strict";
import test from "node:test";
import { isVirtualAttemptActive, teamHasCapacity, virtualAttemptEndsAt } from "./participation-policy.ts";

test("teams stop accepting members at the three-person limit", () => {
  assert.equal(teamHasCapacity(0), true);
  assert.equal(teamHasCapacity(2), true);
  assert.equal(teamHasCapacity(3), false);
  assert.equal(teamHasCapacity(-1), false);
});

test("virtual attempts receive a fixed duration and expire at the deadline", () => {
  const startedAt = new Date("2026-01-01T10:00:00Z");
  const endsAt = virtualAttemptEndsAt(startedAt, 60 * 60 * 1000);
  assert.equal(endsAt.toISOString(), "2026-01-01T11:00:00.000Z");
  assert.equal(isVirtualAttemptActive(new Date("2026-01-01T10:59:59Z"), endsAt), true);
  assert.equal(isVirtualAttemptActive(endsAt, endsAt), false);
});
