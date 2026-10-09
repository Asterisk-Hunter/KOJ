import assert from "node:assert/strict";
import { test } from "node:test";
import { publicCaseResults, publicErrorMessage } from "./public-result.ts";

const stored = [{ index: 0, passed: false, verdict: "runtime_error", runtime_ms: 2,
  stdout: "secret input", stderr: "secret traceback", stdin: "hidden", expectedOutput: "hidden", code: "other source" }];

test("submit results strip hidden output and non-allowlisted stored fields", () => {
  assert.deepEqual(publicCaseResults(stored, "submit"), [{ index: 0, passed: false,
    verdict: "runtime_error", runtime_ms: 2, stdout: "", stderr: "" }]);
  assert.equal(publicErrorMessage({ mode: "submit", status: "runtime_error", errorMessage: "hidden stdin" }),
    "Execution failed; test diagnostics are private.");
});

test("sample-only runs and input-independent compile diagnostics remain useful", () => {
  const result = publicCaseResults(stored, "run");
  assert.equal(result?.[0].stdout, "secret input");
  assert.equal(result?.[0].stderr, "secret traceback");
  assert.equal(publicErrorMessage({ mode: "submit", status: "compilation_error", errorMessage: "syntax error" }), "syntax error");
  assert.equal(publicErrorMessage({ mode: "run", status: "runtime_error", errorMessage: "sample traceback" }), "sample traceback");
  assert.equal(publicErrorMessage({ mode: "submit", status: "accepted", errorMessage: null }), null);
});

test("malformed persisted JSON fails closed and run diagnostics are bounded", () => {
  assert.equal(publicCaseResults({}, "submit"), null);
  assert.deepEqual(publicCaseResults([null, {}, { ...stored[0], runtime_ms: Infinity },
    { ...stored[0], verdict: "secret" }, { ...stored[0], index: -1 }], "submit"), []);
  assert.equal(publicCaseResults([{ ...stored[0], stdout: "x".repeat(10000) }], "run")?.[0].stdout.length, 4096);
});
