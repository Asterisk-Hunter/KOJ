import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedJsonObjectBody, readBoundedStream } from "./bounded-stream.ts";

test("bounded stream accepts a body exactly at its UTF-8 byte limit", async () => {
  const result = await readBoundedStream(
    new Blob(["é"]).stream() as ReadableStream<Uint8Array>,
    2,
  );

  assert.deepEqual(result, { ok: true, value: "é" });
});

test("bounded stream cancels after exceeding its byte limit", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
    },
    cancel() {
      cancelled = true;
    },
  });

  const result = await readBoundedStream(body, 4);

  assert.deepEqual(result, { ok: false, reason: "too-large" });
  assert.equal(cancelled, true);
});

test("bounded stream reports read failures", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("stream failed"));
    },
  });

  const result = await readBoundedStream(body, 10);

  assert.deepEqual(result, { ok: false, reason: "unreadable" });
});

test("bounded JSON object accepts only JSON objects", async () => {
  const objectResult = await readBoundedJsonObjectBody(
    new Blob([JSON.stringify({ key: "value" })]).stream() as ReadableStream<Uint8Array>,
    100,
  );
  assert.deepEqual(objectResult.ok && objectResult.value, { key: "value" });

  const arrayResult = await readBoundedJsonObjectBody(
    new Blob([JSON.stringify(["value"])]).stream() as ReadableStream<Uint8Array>,
    100,
  );
  assert.deepEqual(arrayResult, { ok: false, reason: "invalid-shape" });
});

test("bounded JSON object reports malformed JSON", async () => {
  const result = await readBoundedJsonObjectBody(
    new Blob(["{"]).stream() as ReadableStream<Uint8Array>,
    100,
  );

  assert.deepEqual(result, { ok: false, reason: "invalid-json" });
});

test("bounded JSON object returns 413 for oversized input", async () => {
  const result = await readBoundedJsonObjectBody(
    new Blob([JSON.stringify({ key: "too long" })]).stream() as ReadableStream<Uint8Array>,
    4,
  );

  assert.deepEqual(result, { ok: false, reason: "too-large" });
});
