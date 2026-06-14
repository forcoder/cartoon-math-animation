/**
 * LLM client singleton. OpenAI SDK works against any OpenAI-compatible
 * endpoint (LongCat / 豆包 / Qwen / GLM / DeepSeek / etc.) by overriding
 * `baseURL`. MVP uses LongCat.
 *
 * Env vars:
 *   LLM_BASE_URL  — required, e.g. https://api.longcat.chat/v1
 *   LLM_API_KEY   — required
 *   LLM_MODEL     — required, default LongCat-2.0-Preview
 *
 * Tests can stub `getLLMClient()` without monkey-patching the SDK.
 */

import OpenAI from "openai";

export const DEFAULT_MODEL = "LongCat-2.0-Preview";
/** Lower temperature than default to favor correct code over creative code. */
export const DEFAULT_TEMPERATURE = 0.2;

let instance: OpenAI | null = null;
let initialized = false;

export function getLLMClient(): OpenAI {
  if (!initialized) {
    const baseURL = process.env.LLM_BASE_URL;
    const apiKey = process.env.LLM_API_KEY;
    if (!baseURL) {
      throw new Error(
        "LLM_BASE_URL is not set. Add it to .env.local (e.g. https://api.longcat.chat/v1).",
      );
    }
    if (!apiKey) {
      throw new Error(
        "LLM_API_KEY is not set. Add it to .env.local before calling the render route.",
      );
    }
    instance = new OpenAI({ apiKey, baseURL });
    initialized = true;
  }
  return instance!;
}

export function resolveModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

/**
 * Reset for tests. Not exported to consumers — only the test setup imports it.
 */
export function _resetLLMClientForTests(): void {
  instance = null;
  initialized = false;
}