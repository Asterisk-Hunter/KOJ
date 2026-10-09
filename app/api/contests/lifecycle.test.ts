import assert from "node:assert/strict";
import test, { mock } from "node:test";

type ModuleMock = typeof mock & { module: (id: string, options: { namedExports: Record<string, unknown> }) => void };
(mock as ModuleMock).module("@/db", { namedExports: { db: {} } });
const { deriveContestUiStatus, releaseLinkedProblems, revertLinkedProblems } = await import("./lifecycle.ts");

test("UI status uses the same inclusive-start, exclusive-end contest window", () => {
  const start = new Date("2026-01-01T10:00:00Z");
  const end = new Date("2026-01-01T11:00:00Z");
  assert.equal(deriveContestUiStatus("live", start, end, new Date(start.getTime() - 1)), "Registration Open");
  assert.equal(deriveContestUiStatus("live", start, end, start), "Active");
  assert.equal(deriveContestUiStatus("live", start, end, new Date(end.getTime() - 1)), "Active");
  assert.equal(deriveContestUiStatus("live", start, end, end), "Finished");
  assert.equal(deriveContestUiStatus("draft", start, end, end), "Finished");
  assert.equal(deriveContestUiStatus("ended", start, end, start), "Finished");
});

test("ending or unpublishing cannot release a problem retained by another live contest", async () => {
  for (const operation of [releaseLinkedProblems, revertLinkedProblems]) {
    let selects = 0;
    const executor = {
      select: () => {
        const result = selects++ === 0 ? [{ problemId: 9 }] : [{ problemId: 9 }];
        const query = { from: () => query, innerJoin: () => query, where: async () => result };
        return query;
      },
      update: () => { throw new Error("must not change a problem in another live contest"); },
    };
    // Only the queried interface is mocked, never a live database connection.
    const typedExecutor = executor as unknown as Parameters<typeof revertLinkedProblems>[2];
    if (operation === releaseLinkedProblems) await releaseLinkedProblems([1], new Date(), typedExecutor);
    else await revertLinkedProblems(1, new Date(), typedExecutor);
    assert.equal(selects, 2);
  }
});
