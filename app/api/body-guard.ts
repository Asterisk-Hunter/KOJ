import { NextRequest, NextResponse } from "next/server";

/** Submission bodies carry source code (100KB cap) plus JSON overhead. */
export const MAX_SUBMISSION_BODY_BYTES = 256 * 1024;

/** Test-case bodies carry input + expected output (10MB each per REQ-PROB-03). */
export const MAX_TEST_CASE_BODY_BYTES = 22 * 1024 * 1024;

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Read a JSON body with a hard byte cap. Returns a 413 response when the
 *  payload exceeds `maxBytes` and a 400 response when it is not valid JSON. */
export async function readBoundedJson(
  req: NextRequest,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: jsonError("unreadable request body", 400) };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return { ok: false, response: jsonError("request body too large", 413) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonError("invalid JSON body", 400) };
  }
}
