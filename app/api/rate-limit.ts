import "server-only";
import { createHmac } from "node:crypto";
import { pool } from "@/db";

export type RateBudget = { scope: string; identity: string; limit: number; windowSeconds: number };
export type RateResult = { allowed: boolean; retryAfter: number };

export async function consumeRateBudget(budget: RateBudget): Promise<RateResult> {
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("Rate limiter requires a secret");
  const key = createHmac("sha256", secret).update(`${budget.scope}\0${budget.identity}`).digest("hex");
  const result = await pool.query<{ hits: number; retry_after: number }>(
    `INSERT INTO api_rate_limits (key, hits, expires_at)
     VALUES ($1, 1, clock_timestamp() + $2 * interval '1 second')
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN api_rate_limits.expires_at <= clock_timestamp() THEN 1
                   ELSE LEAST(api_rate_limits.hits + 1, $3 + 1) END,
       expires_at = CASE WHEN api_rate_limits.expires_at <= clock_timestamp()
                        THEN clock_timestamp() + $2 * interval '1 second'
                        ELSE api_rate_limits.expires_at END
     RETURNING hits, GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - clock_timestamp())))::integer AS retry_after`,
    [key, budget.windowSeconds, budget.limit],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Rate limiter returned no result");
  if (Math.random() < 0.01) {
    await pool.query(`DELETE FROM api_rate_limits WHERE key IN
      (SELECT key FROM api_rate_limits WHERE expires_at < clock_timestamp() - interval '1 day' LIMIT 1000)`);
  }
  return { allowed: row.hits <= budget.limit, retryAfter: row.retry_after };
}
