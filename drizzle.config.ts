import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

// Next.js loads .env.local automatically at runtime, but drizzle-kit runs
// outside Next, so we explicitly source it here. Falls back to .env.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local.");
}

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config;
