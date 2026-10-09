import assert from "node:assert/strict";
import test from "node:test";
import { findSimilarSubmissions, winnowedFingerprints } from "./similarity.ts";

const firstCode = `function sum(values) {
  let result = 0;
  for (let index = 0; index < values.length; index += 1) {
    result += values[index];
  }
  return result;
}`;

const renamedCode = `function total(items) {
  let answer = 0;
  for (let position = 0; position < items.length; position += 1) {
    answer += items[position];
  }
  return answer;
}`;

function document(submissionId: number, userId: string, code = firstCode) {
  return {
    submissionId,
    userId,
    username: userId,
    language: "javascript",
    submittedAt: "2026-10-04T00:00:00.000Z",
    code,
    truncated: false,
  };
}

test("winnowing normalizes identifiers and ignores whitespace/comments", () => {
  const commentedCode = `// comment\n${renamedCode.replace("function", "function /* inline */")}`;
  assert.deepEqual([...winnowedFingerprints(firstCode)].sort(), [...winnowedFingerprints(commentedCode)].sort());
});

test("comment markers inside literals remain literals, not comments", () => {
  const first = `function send(url) { const value = "https://example.test/a"; return fetch(url); }`;
  const second = `function post(target) { const label = "// not a comment"; return fetch(target); }`;
  assert.deepEqual([...winnowedFingerprints(first)].sort(), [...winnowedFingerprints(second)].sort());
});

test("finds renamed same-problem source candidates without returning source code", () => {
  const matches = findSimilarSubmissions([document(1, "alice"), document(2, "bob", renamedCode)]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].similarity, 100);
  assert.equal(matches[0].sharedFingerprints > 0, true);
  assert.equal("code" in matches[0].first, false);
  assert.equal("code" in matches[0].second, false);
  assert.equal("userId" in matches[0].first, false);
  assert.equal("userId" in matches[0].second, false);
});

test("excludes submissions from the same user and dissimilar programs", () => {
  const unrelated = "print('hi')";
  const matches = findSimilarSubmissions([
    document(1, "alice"),
    document(2, "alice", renamedCode),
    document(3, "bob", unrelated),
  ]);
  assert.deepEqual(matches, []);
});

test("supports configurable candidate threshold and does not report tiny samples", () => {
  assert.deepEqual(findSimilarSubmissions([document(1, "alice"), document(2, "bob")], {
    minimumSimilarity: 1.01,
  }), []);
  assert.deepEqual(findSimilarSubmissions([document(1, "alice", "x = 1"), document(2, "bob", "x = 1")]), []);
});
