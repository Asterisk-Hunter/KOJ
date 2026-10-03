import assert from "node:assert/strict";
import test from "node:test";
import { decideStaffAccess } from "./access-policy.ts";

test("admin access includes an allowlisted account without a database role", () => {
  assert.equal(decideStaffAccess(null, false, true, "admin"), "allowed");
});

test("suspension overrides database and allowlist staff grants", () => {
  assert.equal(decideStaffAccess("admin", true, true, "admin"), "suspended");
  assert.equal(decideStaffAccess("setter", true, false, "contestManager"), "suspended");
});

test("contest managers require an admin or setter database role", () => {
  assert.equal(decideStaffAccess("admin", false, false, "contestManager"), "allowed");
  assert.equal(decideStaffAccess("setter", false, false, "contestManager"), "allowed");
  assert.equal(decideStaffAccess("contestant", false, true, "contestManager"), "forbidden");
});

test("admin routes reject non-admin database roles without an allowlist grant", () => {
  assert.equal(decideStaffAccess("setter", false, false, "admin"), "forbidden");
  assert.equal(decideStaffAccess("contestant", false, false, "admin"), "forbidden");
});
