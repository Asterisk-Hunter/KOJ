import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_PROBLEM_MEMORY_MB,
  MAX_TEST_CASES_PER_PROBLEM,
  MAX_TEST_CASE_STORAGE_BYTES,
  testCaseLimitViolation,
} from "./limits.ts";

test("judge resource limits match the supported worker caps", () => {
  assert.equal(MAX_PROBLEM_MEMORY_MB, 1024);
  assert.equal(MAX_TEST_CASES_PER_PROBLEM, 100);
  assert.equal(MAX_TEST_CASE_STORAGE_BYTES, 16 * 1024 * 1024);
});

test("test case additions enforce per-file, count, and aggregate byte caps", () => {
  assert.equal(testCaseLimitViolation(99, 0, [{ input: "a", expectedOutput: "b" }]), null);
  assert.equal(testCaseLimitViolation(100, 0, [{ input: "a", expectedOutput: "b" }]), "case_count");
  assert.equal(testCaseLimitViolation(0, 0, [{ input: "x".repeat(10 * 1024 * 1024 + 1), expectedOutput: "b" }]), "file_size");
  assert.equal(testCaseLimitViolation(1, MAX_TEST_CASE_STORAGE_BYTES, [{ input: "a", expectedOutput: "b" }]), "storage_size");
});

test("test case replacement applies the byte delta without changing the count", () => {
  const oldCase = { input: "old", expectedOutput: "output" };
  const newCase = { input: "new", expectedOutput: "result" };
  const oldBytes = Buffer.byteLength(oldCase.input) + Buffer.byteLength(oldCase.expectedOutput);
  assert.equal(testCaseLimitViolation(1, oldBytes, [newCase], [oldCase]), null);
});

test("test case storage uses UTF-8 bytes and allows the exact aggregate limit", () => {
  const halfLimit = { input: "é".repeat(MAX_TEST_CASE_STORAGE_BYTES / 4), expectedOutput: "" };
  assert.equal(testCaseLimitViolation(0, 0, [halfLimit, halfLimit]), null);
  assert.equal(testCaseLimitViolation(0, 0, [halfLimit, halfLimit, { input: "a", expectedOutput: "" }]), "storage_size");
});
