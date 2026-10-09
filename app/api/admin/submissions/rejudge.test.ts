import assert from "node:assert/strict";
import test from "node:test";
import { parseRejudgeScope } from "./rejudge-scope.ts";

test("accepts exactly one positive rejudge selector", () => {
  assert.deepEqual(parseRejudgeScope({ submissionId: 12 }), {
    ok: true,
    scope: { kind: "submission", id: 12 },
  });
  assert.deepEqual(parseRejudgeScope({ problemId: 4 }), {
    ok: true,
    scope: { kind: "problem", id: 4 },
  });
  assert.deepEqual(parseRejudgeScope({ contestId: 9 }), {
    ok: true,
    scope: { kind: "contest", id: 9 },
  });
});

test("rejects ambiguous, unexpected, and invalid selectors", () => {
  assert.equal(parseRejudgeScope({ submissionId: 1, problemId: 2 }).ok, false);
  assert.equal(parseRejudgeScope({ submissionId: 0 }).ok, false);
  assert.equal(parseRejudgeScope({ submissionId: "1" }).ok, false);
  assert.equal(parseRejudgeScope({ submissionId: 1, force: true }).ok, false);
  assert.equal(parseRejudgeScope(null).ok, false);
});
