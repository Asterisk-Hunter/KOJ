import assert from "node:assert/strict";
import test from "node:test";
import { canManageContestCommunication, canReadClarification } from "./clarification-policy.ts";

const privateQuestion = { authorId: "user_a", answer: "internal", visibility: "private" as const };
const publicQuestion = { authorId: "user_a", answer: "broadcast", visibility: "public" as const };

test("only active setters and admins manage contest communication", () => {
  assert.equal(canManageContestCommunication({ userId: "staff", role: "setter", suspended: false }), true);
  assert.equal(canManageContestCommunication({ userId: "admin", role: "admin", suspended: false }), true);
  assert.equal(canManageContestCommunication({ userId: "staff", role: "setter", suspended: true }), false);
  assert.equal(canManageContestCommunication({ userId: "contestant", role: "contestant", suspended: false }), false);
  assert.equal(canManageContestCommunication({ userId: null, role: "setter", suspended: false }), false);
});

test("private answers are limited to the asker and active staff", () => {
  assert.equal(canReadClarification({ userId: "user_a", role: "contestant", suspended: false }, privateQuestion), true);
  assert.equal(canReadClarification({ userId: "user_b", role: "contestant", suspended: false }, privateQuestion), false);
  assert.equal(canReadClarification({ userId: null, role: null, suspended: false }, privateQuestion), false);
  assert.equal(canReadClarification({ userId: "staff", role: "setter", suspended: false }, privateQuestion), true);
  assert.equal(canReadClarification({ userId: "staff", role: "setter", suspended: true }, privateQuestion), false);
  assert.equal(canReadClarification({ userId: null, role: null, suspended: false }, publicQuestion), true);
  assert.equal(canReadClarification({ userId: null, role: null, suspended: false }, { ...publicQuestion, answer: null }), false);
});
