import assert from "node:assert/strict";
import test from "node:test";
import { canRegisterForContest, canStartVirtualAttempt, getArenaParticipation, isOfficialContestActive, isVirtualAttemptActive, teamHasCapacity, virtualAttemptEndsAt } from "./participation-policy.ts";

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

test("official and registration windows exclude the exact end boundary", () => {
  const contest = { status: "live", startsAt: new Date("2026-01-01T10:00:00Z"), endsAt: new Date("2026-01-01T11:00:00Z") };
  assert.equal(isOfficialContestActive(contest, new Date(contest.startsAt.getTime() - 1)), false);
  assert.equal(isOfficialContestActive(contest, contest.startsAt), true);
  assert.equal(isOfficialContestActive(contest, new Date(contest.endsAt.getTime() - 1)), true);
  assert.equal(isOfficialContestActive(contest, contest.endsAt), false);
  assert.equal(canRegisterForContest(contest, contest.startsAt), true);
  assert.equal(canRegisterForContest(contest, contest.endsAt), false);
  assert.equal(canRegisterForContest({ ...contest, status: "draft" }, contest.startsAt), false);
  assert.equal(canRegisterForContest({ ...contest, status: "ended" }, contest.startsAt), false);
});

test("virtual arena mode requires ended state and the viewer's active time window", () => {
  const contest = { status: "ended", startsAt: new Date("2026-01-01T10:00:00Z"), endsAt: new Date("2026-01-01T11:00:00Z") };
  const attempt = { startedAt: new Date("2026-01-01T12:00:00Z"), endsAt: new Date("2026-01-01T13:00:00Z") };
  assert.equal(canStartVirtualAttempt(contest, contest.endsAt), true);
  assert.equal(getArenaParticipation(contest, null, attempt.startedAt), null);
  assert.equal(getArenaParticipation(contest, attempt, new Date(attempt.startedAt.getTime() - 1)), null);
  assert.equal(getArenaParticipation(contest, attempt, attempt.startedAt), "virtual");
  assert.equal(getArenaParticipation(contest, attempt, attempt.endsAt), null);
  assert.equal(getArenaParticipation({ ...contest, status: "live" }, attempt, attempt.startedAt), null);
  assert.equal(getArenaParticipation({ ...contest, status: "live" }, attempt, contest.startsAt), "official");
});

test("invalid virtual durations fail closed instead of creating expired attempts", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => virtualAttemptEndsAt(now, duration), /positive contest duration/);
  }
});
