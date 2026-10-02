import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { judgeJobs, submissions } from "@/db/schema";

export const STALE_RUNNING_AFTER_MS = 10 * 60 * 1000;
const RECOVERY_BATCH_LIMIT = 100;

export async function recoverStaleRunningSubmissions(
  now: Date = new Date(),
  staleAfterMs: number = STALE_RUNNING_AFTER_MS,
): Promise<{ recovered: number }> {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('koj-stale-recovery'))`);
    const orphaned = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .leftJoin(judgeJobs, eq(judgeJobs.submissionId, submissions.id))
      .where(
        and(
          inArray(submissions.status, ["pending", "running"]),
          lt(submissions.submittedAt, cutoff),
          isNull(judgeJobs.id),
        ),
      )
      .orderBy(asc(submissions.submittedAt))
      .limit(RECOVERY_BATCH_LIMIT);
    if (orphaned.length === 0) return { recovered: 0 };

    const ids = orphaned.map((submission) => submission.id);
    const insertedJobs = await tx
      .insert(judgeJobs)
      .values(ids.map((submissionId) => ({ submissionId })))
      .onConflictDoNothing({ target: judgeJobs.submissionId })
      .returning({ submissionId: judgeJobs.submissionId });
    const recoveredIds = insertedJobs.map((job) => job.submissionId);
    if (recoveredIds.length === 0) return { recovered: 0 };

    const recovered = await tx
      .update(submissions)
      .set({
        status: "pending",
        startedAt: null,
        completedAt: null,
        errorMessage: "submission requeued by recovery",
        judgeInfraError: true,
      })
      .where(
        and(
          inArray(submissions.id, recoveredIds),
          inArray(submissions.status, ["pending", "running"]),
        ),
      )
      .returning({ id: submissions.id });
    return { recovered: recovered.length };
  });
}
