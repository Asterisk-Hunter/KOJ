import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PREFIX = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Stored shape for a contest invite code. New codes are always hashed;
 *  `legacy` covers pre-hash plaintext rows (verified, never re-written). */
export interface StoredInviteCode {
  hash: string | null;
  legacy?: string | null;
}

/** Hash a fresh invite code with scrypt. Returns `scrypt$<salt>$<key>`. */
export function hashInviteCode(code: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(code, salt, KEY_BYTES);
  return `${PREFIX}$${salt.toString("hex")}$${key.toString("hex")}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function verifyScrypt(candidate: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    if (salt.length === 0 || expected.length === 0) return false;
    const key = scryptSync(candidate, salt, expected.length);
    if (key.length !== expected.length) return false;
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Verify a candidate invite code against a stored hash (preferred) or a
 *  legacy plaintext value (read-only migration path). */
export function verifyInviteCode(
  candidate: unknown,
  stored: StoredInviteCode,
): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (stored.hash) return verifyScrypt(candidate, stored.hash);
  if (stored.legacy) return safeEqual(candidate, stored.legacy);
  return false;
}
