/**
 * Multi-provider LLM client with a primary + fallback chain.
 *
 * Why we need a chain (2026-06-16):
 *   The LongCat platform we use as primary has shown 429 rate limits
 *   during dogfood. Rather than make the user stare at a 500, we now
 *   try the primary, and on transient failure (429 / 5xx / network)
 *   transparently fall back to a configured secondary provider.
 *   Currently the only fallback is ByteDance 豆包 (Ark) but the
 *   mechanism is provider-agnostic — just add another entry.
 *
 * Env vars:
 *   PRIMARY
 *     LLM_BASE_URL      e.g. https://api.longcat.chat/openai/v1
 *     LLM_API_KEY       sk-...
 *     LLM_MODEL         LongCat-2.0-Preview
 *
 *   FALLBACK chain (comma-separated; same index across the three vars):
 *     LLM_FALLBACK_BASE_URLS  e.g. https://ark.cn-beijing.volces.com/api/v3
 *     LLM_FALLBACK_API_KEYS   e.g. ak-...
 *     LLM_FALLBACK_MODELS     e.g. doubao-lite-32k
 *   If any of the three is missing or empty, fallback is disabled.
 *   Mismatched counts (more URLs than models) are tolerated — the
 *   extra entries are ignored.
 *
 * All providers are assumed to expose an OpenAI-compatible chat
 * completions endpoint, so the `openai` SDK works against each by
 * overriding `baseURL`.
 *
 * Tests stub `getProviderChain()` to inject fake clients.
 */

import OpenAI from "openai";

export const DEFAULT_PRIMARY_MODEL = "LongCat-2.0-Preview";
/** Lower temperature than default to favor correct code over creative code. */
export const DEFAULT_TEMPERATURE = 0.2;

export interface ProviderConfig {
  name: string;             // human label for logs / "provider used" in response
  baseURL: string;
  apiKey: string;
  model: string;
  client: OpenAI;
}

let cachedChain: ProviderConfig[] | null = null;

function makeProvider(name: string, baseURL: string, apiKey: string, model: string): ProviderConfig {
  return { name, baseURL, apiKey, model, client: new OpenAI({ apiKey, baseURL }) };
}

/**
 * Build the (primary + fallbacks) provider chain from environment
 * variables. Called lazily on first use and cached — tests reset via
 * `_resetLLMClientForTests`.
 */
export function getProviderChain(): ProviderConfig[] {
  if (cachedChain) return cachedChain;

  const primaryBase = process.env.LLM_BASE_URL;
  const primaryKey = process.env.LLM_API_KEY;
  const primaryModel = process.env.LLM_MODEL || DEFAULT_PRIMARY_MODEL;
  if (!primaryBase) {
    throw new Error(
      "LLM_BASE_URL is not set. Add it to .env.local (e.g. https://api.longcat.chat/openai/v1).",
    );
  }
  if (!primaryKey) {
    throw new Error(
      "LLM_API_KEY is not set. Add it to .env.local before calling the render route.",
    );
  }

  const chain: ProviderConfig[] = [
    makeProvider("primary", primaryBase, primaryKey, primaryModel),
  ];

  // Fallback chain — same index across the three env vars.
  const fbUrls = (process.env.LLM_FALLBACK_BASE_URLS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const fbKeys = (process.env.LLM_FALLBACK_API_KEYS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const fbModels = (process.env.LLM_FALLBACK_MODELS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const n = Math.min(fbUrls.length, fbKeys.length, fbModels.length);
  for (let i = 0; i < n; i++) {
    chain.push(makeProvider(`fallback-${i + 1}`, fbUrls[i], fbKeys[i], fbModels[i]));
  }

  cachedChain = chain;
  return chain;
}

/** The first provider is the primary; the rest are fallbacks in order. */
export function getPrimaryProvider(): ProviderConfig {
  return getProviderChain()[0];
}

/**
 * Reset for tests. Not exported to consumers — only the test setup imports it.
 */
export function _resetLLMClientForTests(): void {
  cachedChain = null;
}
