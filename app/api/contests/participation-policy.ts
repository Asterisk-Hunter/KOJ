export const TEAM_MEMBER_LIMIT = 3;

export function teamHasCapacity(currentMembers: number): boolean {
  return Number.isInteger(currentMembers) && currentMembers >= 0 && currentMembers < TEAM_MEMBER_LIMIT;
}

export type ContestWindow = { status: string; startsAt: Date; endsAt: Date };

export function isOfficialContestActive(contest: ContestWindow, now: Date): boolean {
  return contest.status === "live" && now >= contest.startsAt && now < contest.endsAt;
}

export function canRegisterForContest(contest: ContestWindow, now: Date): boolean {
  return (contest.status === "live" && now < contest.endsAt) ||
    (contest.status === "draft" && now < contest.startsAt);
}

export function canStartVirtualAttempt(contest: ContestWindow, now: Date): boolean {
  return (contest.status === "ended" || contest.status === "archived") &&
    now >= contest.endsAt && contest.endsAt > contest.startsAt;
}

export function virtualAttemptEndsAt(startedAt: Date, durationMs: number): Date {
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("virtual attempt requires a positive contest duration");
  }
  return new Date(startedAt.getTime() + durationMs);
}

export function isVirtualAttemptActive(now: Date, endsAt: Date): boolean {
  return now.getTime() < endsAt.getTime();
}

export function getArenaParticipation(
  contest: ContestWindow,
  attempt: { startedAt: Date; endsAt: Date } | null,
  now: Date,
): "official" | "virtual" | null {
  if (isOfficialContestActive(contest, now)) return "official";
  if (canStartVirtualAttempt(contest, now) && attempt && now >= attempt.startedAt && isVirtualAttemptActive(now, attempt.endsAt)) {
    return "virtual";
  }
  return null;
}
