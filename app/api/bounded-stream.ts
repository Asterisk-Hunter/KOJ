export type BoundedStreamResult =
  | { ok: true; value: string }
  | { ok: false; reason: "too-large" | "unreadable" };

export type BoundedJsonObjectBodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: "too-large" | "unreadable" | "invalid-json" | "invalid-shape" };

export async function readBoundedStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<BoundedStreamResult> {
  if (!body) return { ok: true, value: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(bytes) };
}

export async function readBoundedJsonObjectBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<BoundedJsonObjectBodyResult> {
  const bounded = await readBoundedStream(body, maxBytes);
  if (!bounded.ok) return bounded;

  let value: unknown;
  try {
    value = JSON.parse(bounded.value) as unknown;
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "invalid-shape" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}
