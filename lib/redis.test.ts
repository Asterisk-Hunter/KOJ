import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

type ModuleMock = typeof mock & {
  module: (name: string, options: { namedExports: Record<string, unknown> }) => void;
};
type Options = { signal: () => AbortSignal; retry: false };
let options: Options | null = null;
let constructions = 0;
let failConstruction = false;
(mock as ModuleMock).module("@upstash/redis", { namedExports: {
  Redis: class {
    constructor(config: Options) {
      constructions++;
      if (failConstruction) throw new Error("invalid cache configuration");
      options = config;
    }
  },
} });

let imports = 0;
async function loadWithEnv(env: Record<string, string | undefined>) {
  // Replace the environment in this isolated test process; never inspect real
  // credentials or instantiate a network-capable client.
  const previous = process.env;
  process.env = { ...env, NODE_ENV: "test" };
  try {
    const redisModule = await import(`./redis.ts?test=${++imports}`);
    return redisModule.getRedis();
  } finally { process.env = previous; }
}

test("missing or invalid optional Redis config takes the DB-only path", async () => {
  const before = constructions;
  for (const env of [{}, { REDIS_URL: "https://cache.invalid" },
    { REDIS_URL: "not a URL", REDIS_TOKEN: "test" },
    { REDIS_URL: "redis://cache.invalid", REDIS_TOKEN: "test" }]) {
    assert.equal(await loadWithEnv(env), null);
  }
  assert.equal(constructions, before);
});

test("Redis constructor failure is fail-open, not a route exception", async () => {
  failConstruction = true;
  try { assert.equal(await loadWithEnv({ REDIS_URL: "https://cache.invalid", REDIS_TOKEN: "test" }), null); }
  finally { failConstruction = false; }
});

test("cache requests have no retries and a fresh bounded abort signal", async () => {
  assert.ok(await loadWithEnv({ REDIS_URL: "https://cache.invalid", REDIS_TOKEN: "test" }));
  assert.ok(options);
  assert.equal(options.retry, false);
  const first = options.signal();
  assert.equal(first.aborted, false);
  await delay(300);
  assert.equal(first.aborted, true);
  const second = options.signal();
  assert.notEqual(first, second);
  assert.equal(second.aborted, false);
});
