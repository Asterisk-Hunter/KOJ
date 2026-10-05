import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local.");
}

const databaseUrl = new URL(url);
if (databaseUrl.searchParams.get("sslmode") !== "disable") {
  databaseUrl.searchParams.set("sslmode", "verify-full");
}
if (process.env.NODE_ENV === "production" && databaseUrl.searchParams.get("sslmode") === "disable") {
  throw new Error("Production database connections require verified TLS.");
}

// Single pool per Node process. Next.js will reuse this across requests
// in the same worker (HMR-safe; in dev the module is re-evaluated and we
// detect an existing pool to avoid leaking connections).
declare global {
  var __koj_pg_pool: Pool | undefined;
}

const pool =
  global.__koj_pg_pool ??
  new Pool({
    connectionString: databaseUrl.toString(),
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 15000,
  });

if (process.env.NODE_ENV !== "production") {
  global.__koj_pg_pool = pool;
}

export const db = drizzle(pool, { schema });
export { pool };
