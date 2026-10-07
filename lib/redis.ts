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
  try {
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return null;
    _redis = new Redis({
      url,
      token,
      // This is an optional cache, not a request-critical dependency. A fresh
      // signal per HTTP request avoids permanently aborting the shared client.
      signal: () => AbortSignal.timeout(250),
      retry: false,
    });
  } catch {
    // Invalid optional configuration must not take down DB-only routes.
    return null;
  }
  return _redis;
}
