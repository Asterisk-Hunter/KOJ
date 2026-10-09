import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAuditMetadata } from "./metadata.ts";

test("audit metadata retains only safe change names and role/status values", () => {
  assert.deepEqual(
    sanitizeAuditMetadata({
      fields: "title,checkerCode,secret",
      role: "setter",
      status: "live",
      description: "private description",
      code: "secret source",
    }),
    { fields: "title,checkerCode", role: "setter", status: "live" },
  );
});

test("audit metadata accepts bounded numeric identifiers and boolean flags only", () => {
  assert.deepEqual(
    sanitizeAuditMetadata({ contestId: 4, count: 12, attempts: 2, suspended: true, isSample: false, random: 13 }),
    { contestId: 4, count: 12, attempts: 2, suspended: true, isSample: false },
  );
});

test("audit metadata rejects arrays, malformed values, and unsafe numbers", () => {
  assert.deepEqual(sanitizeAuditMetadata(null), {});
  assert.deepEqual(sanitizeAuditMetadata(["admin"]), {});
  assert.deepEqual(sanitizeAuditMetadata({ count: Number.POSITIVE_INFINITY, role: "superadmin" }), {});
});
