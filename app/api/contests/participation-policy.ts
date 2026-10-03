export const TEAM_MEMBER_LIMIT = 3;

export function teamHasCapacity(currentMembers: number): boolean {
  return Number.isInteger(currentMembers) && currentMembers >= 0 && currentMembers < TEAM_MEMBER_LIMIT;
}

export function virtualAttemptEndsAt(startedAt: Date, durationMs: number): Date {
  return new Date(startedAt.getTime() + durationMs);
}

export function isVirtualAttemptActive(now: Date, endsAt: Date): boolean {
  return now.getTime() < endsAt.getTime();
}
