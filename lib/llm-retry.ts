/**
 * Minimal retry helper for LLM calls.
 *
 * Why this exists instead of using a third-party retry library:
 *   - The retry policy is project-specific (1 retry, 500ms backoff).
 *   - Error classification is project-specific (5xx/network → retryable).
 *   - Pulling in p-retry adds a dependency for ~30 lines of logic.
 *
 * Retry budget: 1 (so a maximum of 2 total attempts). Design doc says
 * "first-pass success ≥ 60%, with 1 retry → ≥ 90%". A second retry would
 * push latency past 60s and yield diminishing returns.
 */

const RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 1;

/**
 * True for errors where another attempt has a realistic chance of succeeding.
 *
 * Retryable:
 *   - HTTP 5xx from upstream LLM
 *   - Network errors (ECONNRESET, ETIMEDOUT, fetch failures)
 *   - LLM provider's transient "server_error" / "rate_limit_error" types
 *
 * NOT retryable:
 *   - HTTP 4xx (bad input, auth failure — won't change on retry)
 *   - Parse / validation errors (the response didn't even reach the LLM
 *     or the LLM returned garbage — more attempts likely return more garbage)
 *   - AbortError (user navigated away)
 */
export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  // LLM SDK attaches `status` to API errors.
  const anyErr = err as {
    status?: number;
    code?: string;
    type?: string;
    name?: string;
    message?: string;
  };

  if (typeof anyErr.status === "number") {
    return anyErr.status >= 500 && anyErr.status < 600;
  }

  // Provider rate limit / server errors expose a `type` field.
  if (
    anyErr.type === "rate_limit_error" ||
    anyErr.type === "server_error" ||
    anyErr.type === "timeout"
  ) {
    return true;
  }

  // Node-style network errors.
  const networkCodes = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNREFUSED",
    "EAI_AGAIN",
  ]);
  if (anyErr.code && networkCodes.has(anyErr.code)) return true;

  // Generic fetch failures (the undici/Node FetchError name).
  if (anyErr.name === "FetchError") return true;

  // AbortError means the caller cancelled — never retry.
  if (anyErr.name === "AbortError") return false;

  // Default: be conservative. Parsing / validation failures usually indicate
  // a code path issue, not a transient infrastructure blip.
  return false;
}

/**
 * Run `fn` up to (maxRetries + 1) times. Only retries when the thrown
 * error passes `isRetryableError`. Non-retryable errors short-circuit
 * immediately so we don't waste budget or hide bugs.
 *
 * Backoff: fixed 500ms between attempts. Exponential backoff is overkill
 * for a 1-retry budget and would push total latency past the 60s budget.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const hasBudget = attempt < maxRetries;
      if (!hasBudget || !isRetryableError(err)) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }

  // Unreachable: the loop above either returns or throws on the last attempt.
  // TypeScript needs this for control-flow analysis.
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}