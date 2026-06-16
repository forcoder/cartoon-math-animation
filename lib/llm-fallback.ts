/**
 * Fail-fast LLM call with primary + fallback provider chain.
 *
 * Why fail-fast (and not "deep retry on each model"):
 *   Latency budget is 60s end-to-end. If the primary is rate-limited
 *   (429), another retry of the same primary is almost certainly still
 *   429. Switching providers has a much better hit rate than retrying
 *   the dead one. We do still keep the per-provider retry (1 attempt
 *   with 500ms backoff) inside `withRetry` so a *transient* hiccup
 *   doesn't immediately fail-over.
 *
 * Returns the first successful response plus the name of the
 * provider that produced it (so callers can surface "served by
 * fallback-1" in logs / analytics).
 *
 * Failure modes (in order):
 *   1. All providers exhausted → throws the LAST error (most likely
 *      to be a 429, which is what the user actually hit).
 *   2. Provider throws a non-retryable error (4xx other than 429) →
 *      we still try the next provider, but we log a warning. The
 *      intent is that even a 401/403 on the primary can be saved by
 *      a different provider whose key still works.
 *   3. Empty / unusable content from the LLM → thrown as
 *      "LLM returned empty content" so the parser-degradation path
 *      in route.ts handles it.
 */

import { getProviderChain, type ProviderConfig } from "./llm-client";
import { withRetry } from "./llm-retry";

export interface CallOptions {
  temperature?: number;
  maxRetriesPerProvider?: number;
}

export interface CallSuccess {
  content: string;
  provider: string;            // name of the provider that succeeded
  attempts: Array<{ provider: string; ok: boolean; error?: string }>;
}

export async function callLlmWithFallback(
  systemPrompt: string,
  userPrompt: string,
  options: CallOptions = {},
): Promise<CallSuccess> {
  const chain = getProviderChain();
  if (chain.length === 0) {
    throw new Error("No LLM providers configured");
  }
  const maxRetriesPerProvider = options.maxRetriesPerProvider ?? 1;
  const temperature = options.temperature ?? 0.2;

  const attempts: CallSuccess["attempts"] = [];
  let lastError: unknown;

  for (const provider of chain) {
    // One entry per provider in `attempts` — we record the last error
    // seen for this provider (if any), or { ok: true } on the first
    // successful attempt. The onRetry bookkeeping ensures we only
    // write the entry once per provider, not once per per-provider retry.
    let providerEntry: { provider: string; ok: boolean; error?: string } = {
      provider: provider.name,
      ok: false,
      error: "no attempt made",
    };
    try {
      const content = await withRetry(
        () => callOnce(provider, systemPrompt, userPrompt, temperature),
        maxRetriesPerProvider,
        ({ err }) => {
          if (err !== undefined) {
            providerEntry = {
              provider: provider.name,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          } else {
            providerEntry = { provider: provider.name, ok: true };
          }
        },
      );
      // Push this provider's final entry. Replace the placeholder we
      // already pushed at the start of the iteration.
      const existingIdx = attempts.findIndex((a) => a.provider === provider.name);
      if (existingIdx >= 0) {
        attempts[existingIdx] = providerEntry;
      } else {
        attempts.push(providerEntry);
      }
      return { content, provider: provider.name, attempts };
    } catch (err) {
      // All per-provider retries exhausted. Record the final error and
      // move to the next provider. Replace the placeholder if present.
      const msg = err instanceof Error ? err.message : String(err);
      providerEntry = { provider: provider.name, ok: false, error: msg };
      const existingIdx = attempts.findIndex((a) => a.provider === provider.name);
      if (existingIdx >= 0) {
        attempts[existingIdx] = providerEntry;
      } else {
        attempts.push(providerEntry);
      }
      lastError = err;
      continue;
    }
  }

  // All providers failed. Re-throw the last error so the route
  // handler can surface a meaningful retryable signal.
  throw lastError ?? new Error("All LLM providers failed");
}

async function callOnce(
  provider: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
): Promise<string> {
  const completion = await provider.client.chat.completions.create({
    model: provider.model,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const raw = completion.choices[0]?.message?.content;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("LLM returned empty content");
  }
  return raw;
}
