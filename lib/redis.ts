/**
 * Optional Upstash Redis client. Returns null when REDIS_URL is not set,
 * so every call-site must handle the no-Redis case (DB-only path).
 *
 * Env vars:
 *   REDIS_URL   — Upstash REST endpoint (e.g. https://xxx.upstash.io)
 *   REDIS_TOKEN — Upstash auth token
 */

import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
let _initialised = false;

export function getRedis(): Redis | null {
  if (_initialised) return _redis;
  _initialised = true;
  const url = process.env.REDIS_URL;
  const token = process.env.REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}
