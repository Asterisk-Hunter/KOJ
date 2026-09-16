import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contests, problems } from "@/db/schema";

export type ContestStatus = "draft" | "live" | "ended" | "archived";

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

/** Linked `contest_active` problems become `published` (practice archive) when a contest ends. */
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
  await db
    .update(problems)
    .set({ status: "published", updatedAt: now })
    .where(and(inArray(problems.id, ids), eq(problems.status, "contest_active")));
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
 * @returns number of contests transitioned
 */
export async function settleExpiredContests(now: Date = new Date()): Promise<number> {
  const expired = await db
    .update(contests)
    .set({ status: "ended", updatedAt: now })
    .where(and(eq(contests.status, "live"), lte(contests.endsAt, now)))
    .returning({ id: contests.id });
  if (expired.length === 0) return 0;
  await releaseLinkedProblems(
    expired.map((e) => e.id),
    now,
  );
  return expired.length;
}
