import { NextResponse } from "next/server";
import { readBoundedJsonObjectBody, readBoundedStream } from "./bounded-stream";

/** Submission bodies carry source code (100KB cap) plus JSON overhead. */
export const MAX_SUBMISSION_BODY_BYTES = 256 * 1024;

/** Test-case bodies carry input + expected output (10MB each per REQ-PROB-03). */
export const MAX_TEST_CASE_BODY_BYTES = 22 * 1024 * 1024;
export const MAX_RECOVER_BODY_BYTES = 4 * 1024;
export const MAX_CONTEST_BODY_BYTES = 64 * 1024;
export const MAX_CONTEST_PROBLEM_LINK_BODY_BYTES = 16 * 1024;
export const MAX_ADMIN_USER_BODY_BYTES = 4 * 1024;
export const MAX_CONTEST_REGISTRATION_BODY_BYTES = 4 * 1024;
export const MAX_INTERACTIVE_RUN_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_CLERK_WEBHOOK_BODY_BYTES = 1024 * 1024;
export const MAX_PROBLEM_AUTHORING_BODY_BYTES = MAX_TEST_CASE_BODY_BYTES;

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

export type BoundedJsonObjectResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: NextResponse };

export type BoundedTextResult =
  | { ok: true; value: string }
  | { ok: false; response: NextResponse };

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Read a request body with a byte cap, cancelling the stream as soon as it is exceeded. */
export async function readBoundedText(
  req: Request,
  maxBytes: number,
): Promise<BoundedTextResult> {
  const result = await readBoundedStream(req.body, maxBytes);
  if (result.ok) return result;
  return result.reason === "too-large"
    ? { ok: false, response: jsonError("request body too large", 413) }
    : { ok: false, response: jsonError("unreadable request body", 400) };
}

/** Read a JSON body with a byte cap. Returns 413 for oversized bodies and 400 for invalid JSON. */
export async function readBoundedJson(
  req: Request,
  maxBytes: number,
  invalidJsonMessage = "invalid JSON body",
): Promise<BoundedJsonResult> {
  const bounded = await readBoundedText(req, maxBytes);
  if (!bounded.ok) return bounded;
  try {
    return { ok: true, value: JSON.parse(bounded.value) as unknown };
  } catch {
    return { ok: false, response: jsonError(invalidJsonMessage, 400) };
  }
}

export async function readBoundedJsonObject(
  req: Request,
  maxBytes: number,
  invalidJsonMessage = "invalid JSON body",
): Promise<BoundedJsonObjectResult> {
  const parsed = await readBoundedJsonObjectBody(req.body, maxBytes);
  if (parsed.ok) return parsed;
  if (parsed.reason === "too-large") {
    return { ok: false, response: jsonError("request body too large", 413) };
  }
  if (parsed.reason === "unreadable") {
    return { ok: false, response: jsonError("unreadable request body", 400) };
  }
  return { ok: false, response: jsonError(invalidJsonMessage, 400) };
}
