import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local.");
}

// Single pool per Node process. Next.js will reuse this across requests
// in the same worker (HMR-safe; in dev the module is re-evaluated and we
// detect an existing pool to avoid leaking connections).
declare global {
  // eslint-disable-next-line no-var
  var __koj_pg_pool: Pool | undefined;
}

const pool =
  global.__koj_pg_pool ??
  new Pool({
    connectionString: url,
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  global.__koj_pg_pool = pool;
}

export const db = drizzle(pool, { schema });
export { pool };
