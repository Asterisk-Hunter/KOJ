import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashInviteCode,
  verifyInviteCode,
} from "./invite-code.ts";

describe("hashInviteCode → verifyInviteCode round-trip", () => {
  it("round-trips true for correct code", () => {
    const hash = hashInviteCode("secret123");
    assert.equal(
      verifyInviteCode("secret123", { hash }),
      true,
    );
  });

  it("returns false for wrong code", () => {
    const hash = hashInviteCode("secret123");
    assert.equal(
      verifyInviteCode("wrong", { hash }),
      false,
    );
  });

  it("returns false for empty candidate", () => {
    const hash = hashInviteCode("secret123");
    assert.equal(
      verifyInviteCode("", { hash }),
      false,
    );
  });

  it("returns false for non-string candidate", () => {
    const hash = hashInviteCode("secret123");
    assert.equal(
      verifyInviteCode(123 as unknown as string, { hash }),
      false,
    );
  });

  it("returns false for malformed stored hash", () => {
    assert.equal(
      verifyInviteCode("code", { hash: "not-a-hash" }),
      false,
    );
  });
});

describe("legacy exact-match", () => {
  it("legacy true for matching plaintext", () => {
    assert.equal(
      verifyInviteCode("abc", { hash: null, legacy: "abc" }),
      true,
    );
  });

  it("legacy false for non-matching plaintext", () => {
    assert.equal(
      verifyInviteCode("abc", { hash: null, legacy: "xyz" }),
      false,
    );
  });
});

describe("hash wins when both present", () => {
  it("uses hash over legacy", () => {
    const hash = hashInviteCode("correct");
    assert.equal(
      verifyInviteCode("correct", { hash, legacy: "wrong" }),
      true,
    );
  });

  it("hash mismatch ignores legacy", () => {
    const hash = hashInviteCode("correct");
    assert.equal(
      verifyInviteCode("wrong", { hash, legacy: "correct" }),
      false,
    );
  });
});

describe("hash format", () => {
  it("format is scrypt$hex$hex", () => {
    const hash = hashInviteCode("test");
    const parts = hash.split("$");
    assert.equal(parts.length, 3);
    assert.equal(parts[0], "scrypt");
    assert.match(parts[1], /^[0-9a-f]+$/);
    assert.match(parts[2], /^[0-9a-f]+$/);
  });
});

describe("distinct salts", () => {
  it("two hashes of the same code have different salts", () => {
    const h1 = hashInviteCode("test");
    const h2 = hashInviteCode("test");
    assert.notEqual(h1, h2);
  });
});
