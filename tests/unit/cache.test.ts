/**
 * Tests for the Upstash cache. Per test plan: cache layer is P0 — failures
 * must not break the request, only degrade to fresh LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getCachedCode, setCachedCode, buildCacheKey } from "@/lib/cache";

const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;

  if (ORIGINAL_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
});

describe("cache: unconfigured (dev/preview)", () => {
  it("returns null from getCachedCode when env is missing", async () => {
    expect(await getCachedCode("abc123")).toBeNull();
  });

  it("does not throw from setCachedCode when env is missing", async () => {
    await expect(setCachedCode("abc123", "code")).resolves.toBeUndefined();
  });
});

describe("cache: input validation", () => {
  it("returns null for empty hash", async () => {
    expect(await getCachedCode("")).toBeNull();
  });

  it("returns null for non-string hash", async () => {
    expect(await getCachedCode(null as unknown as string)).toBeNull();
  });

  it("does nothing for empty code on set", async () => {
    await expect(setCachedCode("hash", "")).resolves.toBeUndefined();
  });
});

describe("buildCacheKey", () => {
  it("prefixes hash with versioned namespace", () => {
    expect(buildCacheKey("abc123")).toBe("cartoon:v1:abc123");
  });

  it("prefixes with v1 (so future prompt bumps can invalidate)", () => {
    const key = buildCacheKey("test");
    expect(key.startsWith("cartoon:v1:")).toBe(true);
  });
});

describe("cache: integration with mocked Upstash", () => {
  it("getCachedCode falls through (returns null) when Upstash throws", async () => {
    // Use placeholder values (not real creds) to exercise the error path.
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token-for-test";

    vi.doMock("@upstash/redis", () => ({
      Redis: class {
        async get() {
          throw new Error("Upstash down");
        }
        async set() {
          throw new Error("Upstash down");
        }
      },
    }));

    const cache = await import("@/lib/cache");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await cache.getCachedCode("hash1")).toBeNull();
    await expect(cache.setCachedCode("hash1", "code")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});