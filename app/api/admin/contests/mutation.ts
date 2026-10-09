import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contests, type Contest } from "@/db/schema";
import { jsonError } from "@/app/api/admin/authz";

type ContestTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Read lifecycle state under the same lock used by registration and other edits. */
export async function withLockedContest(
  idRaw: string,
  organizationId: number,
  mutate: (tx: ContestTransaction, contest: Contest) => Promise<Response>,
): Promise<Response> {
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) return jsonError("invalid contest id", 400);
  return db.transaction(async (tx) => {
    const [contest] = await tx.select().from(contests).where(and(
      eq(contests.id, id), eq(contests.organizationId, organizationId),
    )).limit(1).for("update");
    if (!contest) return jsonError("contest not found", 404);
    return mutate(tx, contest);
  });
}
