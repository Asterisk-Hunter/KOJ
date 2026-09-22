import { and, eq, inArray, lte, not } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, problems, type Contest } from "@/db/schema";

export type ContestStatus = "draft" | "live" | "ended" | "archived";

export type ContestUiStatus = "Active" | "Registration Open" | "Upcoming" | "Finished";

/**
 * Shared contest display-status derivation (single source of truth; all
 * contest read routes must import this instead of duplicating it).
 * Deliberately preserved: a `live` contest whose `startsAt` is still in the
 * future shows "Registration Open" (scheduled/published-early contests).
 */
export function deriveContestUiStatus(
  dbStatus: string,
  startsAt: Date,
  endsAt: Date,
  now: Date = new Date(),
): ContestUiStatus {
  if (dbStatus === "archived" || dbStatus === "ended") return "Finished";
  if (dbStatus === "live") {
    if (now >= startsAt && now <= endsAt) return "Active";
    if (now < startsAt) return "Registration Open";
    return "Finished";
  }
  // draft
  if (now < startsAt) {
    const diff = startsAt.getTime() - now.getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (diff <= sevenDays) return "Registration Open";
    return "Upcoming";
  }
  if (now >= startsAt && now <= endsAt) return "Registration Open";
  return "Finished";
}

/**
 * Registration policy (single source of truth): registration is allowed only
 * strictly before `startsAt`. Applies to both `draft` and `live`
 * (published-early) contests — see deriveContestUiStatus note above.
 */
export function isRegistrationOpen(startsAt: Date, now: Date = new Date()): boolean {
  return now.getTime() < startsAt.getTime();
}

/** True when a contest requires an invite code (hashed preferred, legacy fallback). */
export function contestRequiresInvite(contest: Pick<Contest, "inviteCode" | "inviteCodeHash">): boolean {
  return contest.inviteCodeHash !== null || contest.inviteCode !== null;
}

/** Admin-driven status transitions. Time-based `live -> ended` is automatic (see below). */
export function nextStatuses(from: ContestStatus): ContestStatus[] {
  switch (from) {
    case "draft":
      return ["live"];
    case "live":
      return ["draft", "ended"];
    case "ended":
      return ["archived"];
    case "archived":
      return ["ended"];
    default: {
      const _exhaustive: never = from;
      return _exhaustive;
    }
  }
}

/** Linked `draft` problems go `contest_active` when their contest is published. */
export async function lockLinkedProblems(contestId: number, now: Date): Promise<void> {
  const links = await db
    .select({ problemId: contestProblems.problemId })
    .from(contestProblems)
    .where(eq(contestProblems.contestId, contestId));
  const ids = [...new Set(links.map((l) => l.problemId))];
  if (ids.length === 0) return;
  await db
    .update(problems)
    .set({ status: "contest_active", updatedAt: now })
    .where(and(inArray(problems.id, ids), eq(problems.status, "draft")));
}

/** Linked `contest_active` problems become `published` (practice archive) when a contest ends.
 *  Skips any problem still linked to another `live` contest. */
export async function releaseLinkedProblems(
  contestIds: number[],
  now: Date,
): Promise<void> {
  if (contestIds.length === 0) return;
  const links = await db
    .select({ problemId: contestProblems.problemId })
    .from(contestProblems)
    .where(inArray(contestProblems.contestId, contestIds));
  const ids = [...new Set(links.map((l) => l.problemId))];
  if (ids.length === 0) return;

  // Find problems still linked to another live contest (exclude the ending contest ids)
  const stillContested = await db
    .select({ problemId: contestProblems.problemId })
    .from(contestProblems)
    .innerJoin(contests, eq(contestProblems.contestId, contests.id))
    .where(
      and(
        inArray(contestProblems.problemId, ids),
        eq(contests.status, "live"),
        not(inArray(contestProblems.contestId, contestIds)),
      ),
    );
  const stillContestedIds = new Set(stillContested.map((r) => r.problemId));
  const releasable = ids.filter((id) => !stillContestedIds.has(id));
  if (releasable.length === 0) return;

  await db
    .update(problems)
    .set({ status: "published", updatedAt: now })
    .where(and(inArray(problems.id, releasable), eq(problems.status, "contest_active")));
}

/** Reverse of publish: linked `contest_active` problems return to `draft` on unpublish. */
export async function revertLinkedProblems(contestId: number, now: Date): Promise<void> {
  const links = await db
    .select({ problemId: contestProblems.problemId })
    .from(contestProblems)
    .where(eq(contestProblems.contestId, contestId));
  const ids = [...new Set(links.map((l) => l.problemId))];
  if (ids.length === 0) return;
  await db
    .update(problems)
    .set({ status: "draft", updatedAt: now })
    .where(and(inArray(problems.id, ids), eq(problems.status, "contest_active")));
}

/**
 * Automatic end handling (REQ-CONT-04/07): any `live` contest past `endsAt`
 * flips to `ended` and its problems publish to the archive. Called lazily at
 * the top of contest reads/writes — no cron needed at college scale.
 *
 * Atomic: the contest flip and the linked problem release run in one
 * transaction, so readers never see `ended` contests with stale
 * `contest_active` problems (or vice versa).
 *
 * @returns number of contests transitioned
 */
export async function settleExpiredContests(now: Date = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(contests)
      .set({ status: "ended", updatedAt: now })
      .where(and(eq(contests.status, "live"), lte(contests.endsAt, now)))
      .returning({ id: contests.id });
    if (expired.length === 0) return 0;
    const links = await tx
      .select({ problemId: contestProblems.problemId })
      .from(contestProblems)
      .where(
        inArray(
          contestProblems.contestId,
          expired.map((e) => e.id),
        ),
      );
    const ids = [...new Set(links.map((l) => l.problemId))];
    if (ids.length > 0) {
      await tx
        .update(problems)
        .set({ status: "published", updatedAt: now })
        .where(and(inArray(problems.id, ids), eq(problems.status, "contest_active")));
    }
    return expired.length;
  });
}
