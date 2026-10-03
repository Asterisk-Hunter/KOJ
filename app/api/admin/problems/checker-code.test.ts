import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SPECIAL_CHECKER_BYTES, parseCheckerCode } from "./checker-code.ts";

test("checker code treats blank text as disabled", () => {
  assert.deepEqual(parseCheckerCode(undefined), { valid: true, checkerCode: null });
  assert.deepEqual(parseCheckerCode("  \n"), { valid: true, checkerCode: null });
});

test("checker code accepts source at the UTF-8 byte limit", () => {
  const source = "x".repeat(MAX_SPECIAL_CHECKER_BYTES);
  assert.deepEqual(parseCheckerCode(source), { valid: true, checkerCode: source });
});

test("checker code rejects invalid and oversized values", () => {
  assert.deepEqual(parseCheckerCode({ source: "code" }), { valid: false });
  assert.deepEqual(parseCheckerCode("x".repeat(MAX_SPECIAL_CHECKER_BYTES + 1)), { valid: false });
  assert.deepEqual(parseCheckerCode("é".repeat(MAX_SPECIAL_CHECKER_BYTES / 2 + 1)), { valid: false });
});
