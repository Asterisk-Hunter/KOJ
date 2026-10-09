import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

type ModuleMock = typeof mock & {
  module: (name: string, options: { namedExports: Record<string, unknown> }) => void;
};
const mockModule = (mock as ModuleMock).module.bind(mock);
const loadPool = (scenario: string): Promise<typeof import("../../../db/index")> =>
  import(`../../../db/index.ts?pool-test=${scenario}`);
let created = 0;
let configuration: Record<string, unknown> = {};
class FakePool extends EventEmitter {
  constructor(config: Record<string, unknown>) {
    super(); created++; configuration = config;
  }
}
mockModule("server-only", { namedExports: {} });
mockModule("pg", { namedExports: { Pool: FakePool } });
mockModule("drizzle-orm/node-postgres", { namedExports: { drizzle: (pool: unknown) => pool } });
mockModule("@/db/schema", { namedExports: {} });

test("production module reloads reuse one pool and idle disconnects are handled", async (t) => {
  const previous = process.env;
  process.env = { NODE_ENV: "production", DATABASE_URL: "postgresql://test:test@database.invalid/test?sslmode=require" };
  t.mock.method(console, "error", () => {});
  try {
    const first = await loadPool("1");
    const second = await loadPool("2");
    assert.equal(created, 1);
    assert.equal(first.pool, second.pool);
    assert.equal(configuration.keepAlive, true);
    assert.equal(configuration.connectionTimeoutMillis, 5000);
    assert.equal(new URL(String(configuration.connectionString)).searchParams.get("sslmode"), "verify-full");
    assert.equal(first.pool.listenerCount("error"), 1);
    assert.doesNotThrow(() => first.pool.emit("error", new Error("private connection details")));
  } finally {
    process.env = previous;
    global.__koj_pg_pool = undefined;
  }
});

test("production cannot opt out of verified database TLS", async () => {
  const previous = process.env;
  process.env = { NODE_ENV: "production", DATABASE_URL: "postgresql://test:test@database.invalid/test?sslmode=disable" };
  try { await assert.rejects(loadPool("insecure"), /verified TLS/); }
  finally { process.env = previous; }
});
