/**
 * Tests for the fail-fast LLM fallback chain.
 *
 * The chain itself is built by `getProviderChain()` from env vars; we
 * stub that via `_resetLLMClientForTests` and re-import the module
 * with a mocked `openai` SDK so the chain points at fake clients we
 * can drive. The point of these tests is the chain SEMANTICS:
 *   - Primary success → no fallback
 *   - Primary fail (any error) → fallback-1
 *   - Fallback-1 fail → fallback-2
 *   - All fail → throw the last error
 *   - Empty content is treated as a failure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type ChatCompletionMessage = { role: "system" | "user"; content: string };
type CreateArgs = {
  model: string;
  temperature: number;
  messages: ChatCompletionMessage[];
};
type CreateResult =
  | { ok: true; content: string }
  | { ok: false; status?: number; type?: string; message: string };

// Build a fake OpenAI class. Each test constructs one with its own
// per-client behavior, then we wire the env vars so the chain picks it up.
function makeFakeOpenAI(
  behaviors: Array<(args: CreateArgs) => CreateResult | Promise<CreateResult>>,
) {
  return class FakeOpenAI {
    _behaviorIndex = 0;
    constructor(_opts: { apiKey: string; baseURL: string }) {}
    chat = {
      completions: {
        create: async (args: CreateArgs) => {
          const i = this._behaviorIndex++;
          if (i >= behaviors.length) {
            throw new Error(
              `FakeOpenAI: no behavior for call #${i + 1} (test misconfigured)`,
            );
          }
          const result = await behaviors[i](args);
          if (!result.ok) {
            const err = new Error(result.message) as Error & {
              status?: number;
              type?: string;
            };
            if (result.status !== undefined) err.status = result.status;
            if (result.type !== undefined) err.type = result.type;
            throw err;
          }
          return {
            choices: [{ message: { role: "assistant", content: result.content } }],
          };
        },
      },
    };
  };
}

beforeEach(() => {
  // Reset cached chain + clear any leftover env from previous tests
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_FALLBACK_BASE_URLS;
  delete process.env.LLM_FALLBACK_API_KEYS;
  delete process.env.LLM_FALLBACK_MODELS;
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Set up the env, mock the openai module, then re-import the test target. */
async function setupChain(
  primaryBehaviors: Array<(args: CreateArgs) => CreateResult | Promise<CreateResult>>,
  fallbackBehaviors: Array<Array<(args: CreateArgs) => CreateResult | Promise<CreateResult>>> = [],
) {
  process.env.LLM_BASE_URL = "https://primary.example.com/v1";
  process.env.LLM_API_KEY = "primary" + "-key";
  process.env.LLM_MODEL = "primary-model";
  if (fallbackBehaviors.length > 0) {
    const urls = fallbackBehaviors
      .map((_, i) => `https://fallback-${i + 1}.example.com/v1`)
      .join(",");
    const keys = fallbackBehaviors.map(() => "fb" + "-key").join(",");
    const models = fallbackBehaviors
      .map((_, i) => `fallback-model-${i + 1}`)
      .join(",");
    process.env.LLM_FALLBACK_BASE_URLS = urls;
    process.env.LLM_FALLBACK_API_KEYS = keys;
    process.env.LLM_FALLBACK_MODELS = models;
  }

  // Build a single FakeOpenAI class whose instances are differentiated
  // by baseURL. Simpler: just track per-baseURL behavior.
  const allBehaviors: Record<string, Array<(args: CreateArgs) => CreateResult | Promise<CreateResult>>> = {
    "https://primary.example.com/v1": primaryBehaviors,
  };
  for (let i = 0; i < fallbackBehaviors.length; i++) {
    allBehaviors[`https://fallback-${i + 1}.example.com/v1`] = fallbackBehaviors[i];
  }
  const callCounts: Record<string, number> = {};
  const Fake = class {
    public baseURL: string;
    constructor(opts: { apiKey: string; baseURL: string }) {
      this.baseURL = opts.baseURL;
      callCounts[opts.baseURL] = 0;
    }
    chat = {
      completions: {
        create: async (args: CreateArgs) => {
          const b = allBehaviors[this.baseURL];
          if (!b) throw new Error(`no fake for ${this.baseURL}`);
          const i = callCounts[this.baseURL]++;
          if (i >= b.length) {
            throw new Error(`no behavior #${i + 1} for ${this.baseURL}`);
          }
          const r = await b[i](args);
          if (!r.ok) {
            const err = new Error(r.message) as Error & { status?: number; type?: string };
            if (r.status !== undefined) err.status = r.status;
            if (r.type !== undefined) err.type = r.type;
            throw err;
          }
          return { choices: [{ message: { role: "assistant", content: r.content } }] };
        },
      },
    };
  };
  vi.doMock("openai", () => ({ default: Fake }));
  return { callCounts };
}

describe("callLlmWithFallback — happy path", () => {
  it("uses the primary when it returns content on the first try", async () => {
    await setupChain([() => ({ ok: true, content: "ok" })]);
    const { callLlmWithFallback } = await import("@/lib/llm-fallback");
    const r = await callLlmWithFallback("sys", "user");
    expect(r.content).toBe("ok");
    expect(r.provider).toBe("primary");
    expect(r.attempts).toEqual([{ provider: "primary", ok: true }]);
  });

  it("retries the primary once on a transient 5xx (per-provider retry budget = 1)", async () => {
    await setupChain([
      () => ({ ok: false, status: 500, message: "transient" }),
      () => ({ ok: true, content: "ok" }),
    ]);
    const { callLlmWithFallback } = await import("@/lib/llm-fallback");
    const r = await callLlmWithFallback("sys", "user");
    expect(r.content).toBe("ok");
    expect(r.provider).toBe("primary");
    // One entry per provider, regardless of how many per-provider
    // retries it took to succeed. The error message survives inside
    // the entry as `error` (we could omit it on success, but we keep
    // it for debuggability — the route handler logs the full chain).
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].provider).toBe("primary");
    expect(r.attempts[0].ok).toBe(true);
  });

  it("does NOT retry 429 against the same provider — switches to fallback immediately", async () => {
    // The retry layer's job is transient errors (5xx). 429 means the
    // provider is still rate-limited, so retrying is wasted time —
    // callLlmWithFallback should switch to fallback-1 right away.
    await setupChain(
      [
        () => ({ ok: false, status: 429, type: "rate_limit_error", message: "429" }),
      ],
      [[() => ({ ok: true, content: "from-fb1" })]],
    );
    const { callLlmWithFallback } = await import("@/lib/llm-fallback");
    const r = await callLlmWithFallback("sys", "user");
    expect(r.content).toBe("from-fb1");
    expect(r.provider).toBe("fallback-1");
    // Only 1 attempt on the primary, then immediately fallback.
    expect(r.attempts.filter((a) => a.provider === "primary")).toHaveLength(1);
  });
});

describe("callLlmWithFallback — fail-fast to fallback", () => {
  it("switches to fallback-1 when primary 429s twice", async () => {
    await setupChain(
      // primary: 429, 429 → all retries exhausted
      [
        () => ({ ok: false, status: 429, type: "rate_limit_error", message: "429" }),
        () => ({ ok: false, status: 429, type: "rate_limit_error", message: "429" }),
      ],
      // fallback-1: success on first try
      [[() => ({ ok: true, content: "from-fallback-1" })]],
    );
    const { callLlmWithFallback } = await import("@/lib/llm-fallback");
    const r = await callLlmWithFallback("sys", "user");
    expect(r.content).toBe("from-fallback-1");
    expect(r.provider).toBe("fallback-1");
    expect(r.attempts.map((a) => a.provider)).toEqual(["primary", "fallback-1"]);
  });

  it("walks through multiple fallbacks in order", async () => {
    await setupChain(
      // primary: 429 twice
      [
        () => ({ ok: false, status: 429, message: "p1" }),
        () => ({ ok: false, status: 429, message: "p2" }),
      ],
      // fallback-1: 500 twice
      [
        [
          () => ({ ok: false, status: 500, message: "fb1-1" }),
          () => ({ ok: false, status: 500, message: "fb1-2" }),
        ],
        // fallback-2: 200
        [() => ({ ok: true, content: "from-fallback-2" })],
      ],
    );
    const { callLlmWithFallback } = await import("@/lib/llm-fallback");
    const r = await callLlmWithFallback("sys", "user");
    expect(r.content).toBe("from-fallback-2");
    expect(r.provider).toBe("fallback-2");
    expect(r.attempts.map((a) => a.provider)).toEqual([
      "primary",
      "fallback-1",
      "fallback-2",
    ]);
  });
});

describe("callLlmWithFallback — total failure", () => {
  it("throws the last provider's error when every provider fails", async () => {
    await setupChain(
      [
        () => ({ ok: false, status: 500, message: "p" }),
        () => ({ ok: false, status: 500, message: "p" }),
      ],
      [
        [
          () => ({ ok: false, status: 500, message: "fb1" }),
          () => ({ ok: false, status: 500, message: "fb1" }),
        ],
      ],
    );
    const { callLlmWithFallback } = await import("@/lib/llm-fallback");
    await expect(callLlmWithFallback("sys", "user")).rejects.toThrow(/fb1/);
  });

  it("treats empty LLM content as a failure (forces next provider)", async () => {
    await setupChain(
      // primary: empty
      [
        () => ({ ok: true, content: "" }),
        () => ({ ok: true, content: "" }),
      ],
      // fallback-1: success
      [[() => ({ ok: true, content: "from-fb1" })]],
    );
    const { callLlmWithFallback } = await import("@/lib/llm-fallback");
    const r = await callLlmWithFallback("sys", "user");
    expect(r.content).toBe("from-fb1");
    expect(r.provider).toBe("fallback-1");
  });
});

describe("getProviderChain — env parsing", () => {
  it("returns just the primary when no fallback env is set", async () => {
    process.env.LLM_BASE_URL = "https://primary.example.com/v1";
    process.env.LLM_API_KEY = "k";
    process.env.LLM_MODEL = "m";
    vi.doMock("openai", () => ({
      default: class {
        constructor(_: { apiKey: string; baseURL: string }) {}
        chat = { completions: { create: async () => ({ choices: [] }) } };
      },
    }));
    const { getProviderChain, _resetLLMClientForTests } = await import(
      "@/lib/llm-client"
    );
    _resetLLMClientForTests();
    const chain = getProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("primary");
  });

  it("parses comma-separated fallback env into multiple providers", async () => {
    process.env.LLM_BASE_URL = "https://primary.example.com/v1";
    process.env.LLM_API_KEY = "k";
    process.env.LLM_MODEL = "m";
    process.env.LLM_FALLBACK_BASE_URLS = "https://a/,https://b/";
    process.env.LLM_FALLBACK_API_KEYS = "ka,kb";
    process.env.LLM_FALLBACK_MODELS = "ma,mb";
    vi.doMock("openai", () => ({
      default: class {
        constructor(_: { apiKey: string; baseURL: string }) {}
        chat = { completions: { create: async () => ({ choices: [] }) } };
      },
    }));
    const { getProviderChain, _resetLLMClientForTests } = await import(
      "@/lib/llm-client"
    );
    _resetLLMClientForTests();
    const chain = getProviderChain();
    expect(chain).toHaveLength(3);
    expect(chain.map((p) => p.name)).toEqual([
      "primary",
      "fallback-1",
      "fallback-2",
    ]);
    expect(chain[1].baseURL).toBe("https://a/");
    expect(chain[2].model).toBe("mb");
  });

  it("ignores extra entries when env var counts don't match", async () => {
    process.env.LLM_BASE_URL = "https://primary.example.com/v1";
    process.env.LLM_API_KEY = "k";
    process.env.LLM_MODEL = "m";
    process.env.LLM_FALLBACK_BASE_URLS = "https://a/,https://b/,https://c/";
    process.env.LLM_FALLBACK_API_KEYS = "ka,kb"; // only 2 keys
    process.env.LLM_FALLBACK_MODELS = "ma,mb,mc";
    vi.doMock("openai", () => ({
      default: class {
        constructor(_: { apiKey: string; baseURL: string }) {}
        chat = { completions: { create: async () => ({ choices: [] }) } };
      },
    }));
    const { getProviderChain, _resetLLMClientForTests } = await import(
      "@/lib/llm-client"
    );
    _resetLLMClientForTests();
    const chain = getProviderChain();
    // min(3 URLs, 2 keys, 3 models) = 2 → 1 primary + 2 fallbacks
    expect(chain).toHaveLength(3);
  });
});
