import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createStatusStream } from "./[id]/events/status-stream.ts";
import type { SubmissionStatus } from "./[id]/events/status-stream.ts";

const pending: SubmissionStatus = { status: "pending", passedTests: null, totalTests: null,
  executionTimeMs: null, memoryUsedMb: null, errorMessage: null };
const signal = () => new AbortController().signal;

test("terminal initial state emits done without a redundant DB query", async () => {
  const stream = createStatusStream({ initial: { ...pending, status: "accepted" }, signal: signal(),
    load: async () => { throw new Error("must not load"); } });
  const body = await new Response(stream).text();
  assert.match(body, /retry: 1000/);
  assert.match(body, /event: done/);
});

test("pending transitions to running then done, without overlapping polls", async () => {
  let loads = 0;
  let inFlight = 0;
  const stream = createStatusStream({ initial: pending, signal: signal(), tickMs: 1, durationMs: 500,
    load: async () => {
      assert.equal(inFlight++, 0);
      await delay(2);
      inFlight--;
      return { ...pending, status: ++loads === 1 ? "running" : "accepted" };
    } });
  const body = await new Response(stream).text();
  assert.equal(loads, 2);
  assert.match(body, /"status":"running"/);
  assert.match(body, /event: done/);
});

test("abort during a DB read closes and never installs another timer", async () => {
  const abort = new AbortController();
  let complete: (row: SubmissionStatus) => void = () => {};
  let started: () => void = () => {};
  const loading = new Promise<void>((resolve) => { started = resolve; });
  let loads = 0;
  const stream = createStatusStream({ initial: pending, signal: abort.signal, tickMs: 1, durationMs: 500,
    load: () => { loads++; started(); return new Promise((resolve) => { complete = resolve; }); } });
  const bodyPromise = new Response(stream).text();
  await loading;
  abort.abort();
  const body = await bodyPromise;
  complete({ ...pending, status: "accepted" });
  await delay(10);
  assert.equal(loads, 1);
  assert.doesNotMatch(body, /event: done/);
});

test("wall-clock deadline closes even when a DB poll never settles", async () => {
  const stream = createStatusStream({ initial: pending, signal: signal(), tickMs: 1, durationMs: 10,
    load: () => new Promise(() => {}) });
  const body = await new Response(stream).text();
  assert.match(body, /event: status/);
});

test("cancel before first poll stops work and removes the abort listener", async () => {
  let loads = 0;
  const abort = new AbortController();
  const stream = createStatusStream({ initial: pending, signal: abort.signal, tickMs: 1,
    load: async () => { loads++; return pending; } });
  await stream.cancel();
  abort.abort();
  await delay(10);
  assert.equal(loads, 0);
});

test("DB failures close with a generic retryable event, never raw diagnostics", async () => {
  const stream = createStatusStream({ initial: pending, signal: signal(), tickMs: 1,
    load: async () => { throw new Error("private database details"); } });
  const body = await new Response(stream).text();
  assert.match(body, /status temporarily unavailable/);
  assert.doesNotMatch(body, /private database/);
});
