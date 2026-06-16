/**
 * Tests for the retry helper. Per test plan: critical for the 1-retry
 * latency budget (45-60s) and error classification (retryable vs not).
 */

import { describe, it, expect, vi } from "vitest";
import { isRetryableError, withRetry } from "@/lib/llm-retry";

describe("isRetryableError", () => {
  it("returns false for null / non-objects", () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError("error string")).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });

  it("returns true for HTTP 5xx", () => {
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 502 })).toBe(true);
    expect(isRetryableError({ status: 599 })).toBe(true);
  });

  it("returns false for HTTP 4xx", () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 429 })).toBe(false);
  });

  it("returns true for transient provider error types (but NOT rate_limit_error — that goes to the fallback chain)", () => {
    expect(isRetryableError({ type: "server_error" })).toBe(true);
    expect(isRetryableError({ type: "timeout" })).toBe(true);
    // rate_limit_error is intentionally NOT retryable at this layer —
    // the fallback chain (lib/llm-fallback.ts) handles 429 by switching
    // providers, which is much more effective than retrying the same
    // rate-limited provider.
    expect(isRetryableError({ type: "rate_limit_error" })).toBe(false);
  });

  it("returns true for Node-style network errors", () => {
    expect(isRetryableError({ code: "ECONNRESET" })).toBe(true);
    expect(isRetryableError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isRetryableError({ code: "ENOTFOUND" })).toBe(true);
    expect(isRetryableError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isRetryableError({ code: "EAI_AGAIN" })).toBe(true);
  });

  it("returns true for generic FetchError name", () => {
    expect(isRetryableError({ name: "FetchError" })).toBe(true);
  });

  it("returns false for AbortError (caller cancelled)", () => {
    expect(isRetryableError({ name: "AbortError" })).toBe(false);
  });

  it("returns false for unknown error shapes (conservative default)", () => {
    expect(isRetryableError({ message: "something weird" })).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on retryable error, returns second-attempt result", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValueOnce("recovered");
    const result = await withRetry(fn);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable error (4xx)", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });
    await expect(withRetry(fn)).rejects.toEqual({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting retry budget", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    await expect(withRetry(fn)).rejects.toEqual({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("waits ~500ms between attempts (not 0)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValueOnce("ok");
    const start = Date.now();
    await withRetry(fn);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(400);
  });

  it("respects custom maxRetries=0 (no retries)", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(withRetry(fn, 0)).rejects.toEqual({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});