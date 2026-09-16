import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

/**
 * Verify a Clerk (Svix-format) webhook signature without extra dependencies:
 * HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` with the base64 webhook
 * secret, compared against every `v1,<sig>` candidate in `svix-signature`.
 * Rejects timestamps older/newer than 5 minutes (replay protection).
 */
export function verifyWebhookSignature(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string,
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  for (const candidate of signatureHeader.split(" ")) {
    const parts = candidate.split(",");
    if (parts.length !== 2 || parts[0] !== "v1") continue;
    let sig: Buffer;
    try {
      sig = Buffer.from(parts[1], "base64");
    } catch {
      continue;
    }
    if (sig.length !== expected.length) continue;
    if (timingSafeEqual(sig, expected)) return true;
  }
  return false;
}
