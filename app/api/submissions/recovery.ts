import { and, asc, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { submissions } from "@/db/schema";

/**
 * Stale-running recovery: submissions stuck in `pending`/`running` past the
 * cutoff are terminally marked `runtime_error` so UIs stop polling forever.
 *
 * Safety properties:
 * - Only transitions out of `pending`/`running`, guarded again at UPDATE
 *   time — never touches terminal states decided by the judge.
 * - Bounded batch (oldest first); callers re-invoke until `recovered` is 0.
 * - Serialized per call via `pg_advisory_xact_lock` so overlapping
 *   invocations (manual + scheduled) cannot double-process a batch.
 *
 * The FastAPI verdict write repeats the pending/running status guard, so a
 * late verdict cannot overwrite a recovery result.
 */

export const STALE_RUNNING_AFTER_MS = 10 * 60 * 1000;
const RECOVERY_BATCH_LIMIT = 100;

export async function recoverStaleRunningSubmissions(
  now: Date = new Date(),
  staleAfterMs: number = STALE_RUNNING_AFTER_MS,
): Promise<{ recovered: number }> {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('koj-stale-recovery'))`);
    const stale = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          inArray(submissions.status, ["pending", "running"]),
          lt(submissions.submittedAt, cutoff),
        ),
      )
      .orderBy(asc(submissions.submittedAt))
      .limit(RECOVERY_BATCH_LIMIT);
    if (stale.length === 0) return { recovered: 0 };
    const ids = stale.map((s) => s.id);
    const updated = await tx
      .update(submissions)
      .set({
        status: "runtime_error",
        errorMessage: "judge timeout — stale running submission recovered",
        completedAt: now,
      })
      .where(
        and(
          inArray(submissions.id, ids),
          inArray(submissions.status, ["pending", "running"]),
        ),
      )
      .returning({ id: submissions.id });
    return { recovered: updated.length };
  });
}
