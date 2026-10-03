import assert from "node:assert/strict";
import test from "node:test";
import { parseOutputComparator, parseOutputTolerance } from "./comparator.ts";

test("output comparator parser accepts supported modes only", () => {
  assert.equal(parseOutputComparator("exact"), "exact");
  assert.equal(parseOutputComparator("float"), "float");
  assert.equal(parseOutputComparator("custom"), null);
  assert.equal(parseOutputComparator(null), null);
});

test("output tolerance parser accepts finite values in the configured range", () => {
  assert.equal(parseOutputTolerance(0), 0);
  assert.equal(parseOutputTolerance("0.000001"), 0.000001);
  assert.equal(parseOutputTolerance(1), 1);
  assert.equal(parseOutputTolerance(""), null);
  assert.equal(parseOutputTolerance(-0.01), null);
  assert.equal(parseOutputTolerance(1.01), null);
  assert.equal(parseOutputTolerance(Number.POSITIVE_INFINITY), null);
  assert.equal(parseOutputTolerance("not a number"), null);
});
