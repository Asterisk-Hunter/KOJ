import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessOrganizationResource,
  canChangeMembershipRole,
  canLeaveOrganization,
  canLinkOrganizationResources,
  canManageOrganization,
  isOrganizationRole,
  isValidOrganizationSlug,
  organizationSlug,
} from "./organization-policy.ts";

test("organization roles are restricted to the supported database roles", () => {
  assert.equal(isOrganizationRole("admin"), true);
  assert.equal(isOrganizationRole("setter"), true);
  assert.equal(isOrganizationRole("contestant"), true);
  assert.equal(isOrganizationRole("owner"), false);
});

test("only an organization admin manages the organization", () => {
  assert.equal(canManageOrganization("admin"), true);
  assert.equal(canManageOrganization("setter"), false);
  assert.equal(canManageOrganization(null), false);
});

test("resource access is confined to the selected organization", () => {
  const memberAdmin = { organizationId: 7, isPublic: false, isMember: true };
  const publicVisitor = { organizationId: 7, isPublic: true, isMember: false };
  const privateVisitor = { organizationId: 7, isPublic: false, isMember: false };
  assert.equal(canAccessOrganizationResource(memberAdmin, 7, "read"), true);
  assert.equal(canAccessOrganizationResource(memberAdmin, 7, "participate"), true);
  assert.equal(canAccessOrganizationResource({ ...memberAdmin, organizationId: 8 }, 7, "read"), false);
  assert.equal(canAccessOrganizationResource(publicVisitor, 7, "read"), true);
  assert.equal(canAccessOrganizationResource(publicVisitor, 7, "participate"), false);
  assert.equal(canAccessOrganizationResource(privateVisitor, 7, "read"), false);
});

test("organization resources can only be linked within the same tenant", () => {
  assert.equal(canLinkOrganizationResources(7, 7), true);
  assert.equal(canLinkOrganizationResources(7, 8), false);
});

test("the last organization admin cannot be demoted", () => {
  assert.equal(canChangeMembershipRole("admin", "admin", "setter", 1), false);
  assert.equal(canChangeMembershipRole("admin", "admin", "setter", 2), true);
  assert.equal(canChangeMembershipRole("admin", "admin", "admin", 1), true);
  assert.equal(canChangeMembershipRole("setter", "contestant", "admin", 2), false);
});

test("the last organization admin cannot leave", () => {
  assert.equal(canLeaveOrganization("admin", 1), false);
  assert.equal(canLeaveOrganization("admin", 2), true);
  assert.equal(canLeaveOrganization("contestant", 1), true);
});

test("organization slugs are normalized and validated", () => {
  assert.equal(organizationSlug("  Kottayam Online Judge! "), "kottayam-online-judge");
  assert.equal(isValidOrganizationSlug("college-cp"), true);
  assert.equal(isValidOrganizationSlug("not a slug"), false);
});
