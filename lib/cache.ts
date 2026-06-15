/**
 * Upstash Redis cache for generated render results (code + steps + lines).
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
 * Cache value format: JSON string of `{ code, steps, lines }`. The route
 * handler passes a parsed result in and gets a parsed result back; the
 * JSON shape is opaque to this module.
 *
 * TTL: 30 days. Problems are stable (kids re-do the same homework), and
 * longer TTL means more hits; 30d is a safety cap in case the LLM changes
 * enough that old code becomes misleading.
 */

import { Redis } from "@upstash/redis";
import type { RenderStep, RenderLine } from "./types";

const CACHE_KEY_PREFIX = "cartoon:v1:";
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Opaque result struct stored in the cache. The cache layer doesn't
 *  validate the fields — `getCachedResult` returns whatever was `set`. */
export interface CachedResult {
  code: string;
  steps: RenderStep[];
  lines: RenderLine[];
}

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
 * Look up a cached render result by problem hash.
 *
 * Returns null when:
 *   - cache is unconfigured (dev/preview)
 *   - cache key is missing (cold miss)
 *   - cache call throws (network blip, expired creds) — logged, not rethrown
 *   - stored payload is malformed JSON or the wrong shape — treated as miss
 *
 * Callers MUST treat null as "no cache, go call LLM" rather than an error.
 */
export async function getCachedResult(
  problemHash: string,
): Promise<CachedResult | null> {
  if (!problemHash || typeof problemHash !== "string") return null;

  const redis = getClient();
  if (!redis) return null;

  try {
    const raw = await redis.get<string>(CACHE_KEY_PREFIX + problemHash);
    if (typeof raw !== "string" || raw.length === 0) return null;
    const parsed = JSON.parse(raw) as Partial<CachedResult>;
    if (
      !parsed ||
      typeof parsed.code !== "string" ||
      !Array.isArray(parsed.steps) ||
      !Array.isArray(parsed.lines)
    ) {
      // Stale or wrong-shape entry — pretend it's a miss so the route
      // re-runs the LLM. This protects against legacy code-only caches
      // from before the JSON-envelope rollout.
      return null;
    }
    return {
      code: parsed.code,
      steps: parsed.steps as RenderStep[],
      lines: parsed.lines as RenderLine[],
    };
  } catch (err) {
    // Cache failure must not break the request — log and fall through.
    console.error("[cache] get failed, falling through to LLM:", err);
    return null;
  }
}

/**
 * Store a generated render result under its problem hash.
 *
 * Failures are swallowed: a failed write just means the next request will
 * re-call the LLM. That's strictly better than failing the whole render.
 */
export async function setCachedResult(
  problemHash: string,
  result: CachedResult,
): Promise<void> {
  if (!problemHash) return;
  if (!result || typeof result.code !== "string" || result.code.length === 0) return;

  const redis = getClient();
  if (!redis) return;

  try {
    await redis.set(
      CACHE_KEY_PREFIX + problemHash,
      JSON.stringify({
        code: result.code,
        steps: result.steps,
        lines: result.lines,
      }),
      { ex: CACHE_TTL_SECONDS },
    );
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