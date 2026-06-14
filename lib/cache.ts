/**
 * Upstash Redis cache for generated Three.js code.
 *
 * Design goals (from eng review 2026-06-14):
 *   - Same-problem cache hit → <2s response (vs ~30s LLM call).
 *   - Expected hit rate 10-20% on a 5-family dogfood pool.
 *   - Cost savings ¥0.05-0.10 per hit.
 *   - MUST degrade gracefully: if env vars are missing or the call fails,
 *     the caller falls back to a fresh LLM call. Cache outages must never
 *     break the user-facing flow.
 *
 * Cache key format: `cartoon:v1:{problemHash}` — versioned so a future
 * prompt change can be rolled out by bumping `v1` without colliding with
 * stale entries from the old prompt.
 *
 * TTL: 30 days. Problems are stable (kids re-do the same homework), and
 * longer TTL means more hits; 30d is a safety cap in case the LLM changes
 * enough that old code becomes misleading.
 */

import { Redis } from "@upstash/redis";

const CACHE_KEY_PREFIX = "cartoon:v1:";
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

let client: Redis | null = null;
let clientInitialized = false;

/**
 * Lazy-init the Upstash client.
 *
 * Returns null (not throws) when env vars are absent so the API route can
 * still function in dev / preview environments where Upstash isn't set up.
 */
function getClient(): Redis | null {
  if (clientInitialized) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    client = null;
  } else {
    client = new Redis({ url, token });
  }
  clientInitialized = true;
  return client;
}

/**
 * Look up a cached code by problem hash.
 *
 * Returns null when:
 *   - cache is unconfigured (dev/preview)
 *   - cache key is missing (cold miss)
 *   - cache call throws (network blip, expired creds) — logged, not rethrown
 *
 * Callers MUST treat null as "no cache, go call LLM" rather than an error.
 */
export async function getCachedCode(problemHash: string): Promise<string | null> {
  if (!problemHash || typeof problemHash !== "string") return null;

  const redis = getClient();
  if (!redis) return null;

  try {
    const value = await redis.get<string>(CACHE_KEY_PREFIX + problemHash);
    return value ?? null;
  } catch (err) {
    // Cache failure must not break the request — log and fall through.
    console.error("[cache] get failed, falling through to LLM:", err);
    return null;
  }
}

/**
 * Store a generated code under its problem hash.
 *
 * Failures are swallowed: a failed write just means the next request will
 * re-call the LLM. That's strictly better than failing the whole render.
 */
export async function setCachedCode(
  problemHash: string,
  code: string,
): Promise<void> {
  if (!problemHash || !code) return;

  const redis = getClient();
  if (!redis) return;

  try {
    await redis.set(CACHE_KEY_PREFIX + problemHash, code, {
      ex: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.error("[cache] set failed (non-fatal):", err);
  }
}

/**
 * Exposed for tests + ops scripts that need to invalidate stale entries
 * when the prompt or model changes. Not used in the request path.
 */
export function buildCacheKey(problemHash: string): string {
  return CACHE_KEY_PREFIX + problemHash;
}