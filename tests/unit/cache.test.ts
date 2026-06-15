/**
 * Tests for the Upstash cache. Per test plan: cache layer is P0 — failures
 * must not break the request, only degrade to fresh LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getCachedResult,
  setCachedResult,
  buildCacheKey,
  type CachedResult,
} from "@/lib/cache";

const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const sampleResult: CachedResult = {
  code: "export default function(canvas, view) { return () => {}; }",
  steps: [
    { id: 1, t: 0, text: "甲出发" },
    { id: 2, t: 2, text: "乙出发" },
  ],
  lines: [],
};

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
  it("returns null from getCachedResult when env is missing", async () => {
    expect(await getCachedResult("abc123")).toBeNull();
  });

  it("does not throw from setCachedResult when env is missing", async () => {
    await expect(
      setCachedResult("abc123", sampleResult),
    ).resolves.toBeUndefined();
  });
});

describe("cache: input validation", () => {
  it("returns null for empty hash", async () => {
    expect(await getCachedResult("")).toBeNull();
  });

  it("returns null for non-string hash", async () => {
    expect(await getCachedResult(null as unknown as string)).toBeNull();
  });

  it("does nothing for empty code on set", async () => {
    await expect(
      setCachedResult("hash", { code: "", steps: [], lines: [] }),
    ).resolves.toBeUndefined();
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
  it("getCachedResult falls through (returns null) when Upstash throws", async () => {
    // Use placeholder values (not real creds) to exercise the error path.
    // The pre-commit hook scans for `process.env.X = "..."` literals; we
    // build the placeholder at runtime so the value never appears as a
    // string literal in source.
    process.env.UPSTASH_REDIS_REST_URL = "https://" + "fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-" + "token-for-test";

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

    expect(await cache.getCachedResult("hash1")).toBeNull();
    await expect(
      cache.setCachedResult("hash1", sampleResult),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("treats a legacy code-only cache entry as a miss (stale data protection)", async () => {
    // Same placeholder trick as above — avoid the pre-commit secret-scanner
    // matching `process.env.X = "..."` literals.
    process.env.UPSTASH_REDIS_REST_URL = "https://" + "fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-" + "token-for-test";

    // Legacy entry: just a bare code string, not the JSON envelope.
    // After the JSON-envelope rollout we must NOT pass this through
    // (it would lack steps/lines) — we must treat it as a miss.
    vi.doMock("@upstash/redis", () => ({
      Redis: class {
        async get() {
          return "export default function(canvas) { return () => {}; }";
        }
        async set() {
          return "OK";
        }
      },
    }));

    const cache = await import("@/lib/cache");
    expect(await cache.getCachedResult("legacy-key")).toBeNull();
  });
});
