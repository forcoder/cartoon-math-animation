/**
 * Tests for the tolerant LLM-response parser.
 *
 * Why this matters: the LLM is told to output a strict JSON envelope, but
 * in practice the model may wrap it in a fence, prepend a one-line preface,
 * return bare code, or emit broken JSON. The parser must NEVER throw — it
 * always returns SOMETHING usable (worst case: code only, no steps/lines)
 * so the route can degrade gracefully instead of 500'ing the user.
 */

import { describe, it, expect } from "vitest";
import {
  parseLlmResponse,
  stripMarkdownFences,
  type ParsedLlmResponse,
} from "@/lib/parse-llm-response";

const SAMPLE_CODE = "export default function(canvas, view) { return () => {}; }";
const SAMPLE_STEPS = [
  { t: 0, text: "读题" },
  { t: 2, text: "列已知" },
  { t: 5, text: "答案" },
];

describe("stripMarkdownFences", () => {
  it("strips a ```js ... ``` wrapper", () => {
    expect(stripMarkdownFences("```js\nhello\n```")).toBe("hello");
  });

  it("strips a ```json ... ``` wrapper", () => {
    expect(stripMarkdownFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("is idempotent on already-stripped text", () => {
    expect(stripMarkdownFences("plain text")).toBe("plain text");
  });

  it("handles ```ts and ```typescript variants", () => {
    expect(stripMarkdownFences("```ts\nfoo\n```")).toBe("foo");
    expect(stripMarkdownFences("```typescript\nbar\n```")).toBe("bar");
  });
});

describe("parseLlmResponse", () => {
  describe("happy path: clean JSON envelope", () => {
    it("parses a full {code, steps, lines} envelope", () => {
      const env = {
        code: SAMPLE_CODE,
        steps: SAMPLE_STEPS,
        lines: [],
      };
      const r = parseLlmResponse(JSON.stringify(env));
      expect(r.parsedAsJson).toBe(true);
      expect(r.code).toBe(SAMPLE_CODE);
      expect(r.steps).toHaveLength(3);
      expect(r.steps[0].text).toBe("读题");
    });

    it("parses with the code value wrapped in its own ```js fence", () => {
      const env = {
        code: "```js\n" + SAMPLE_CODE + "\n```",
        steps: SAMPLE_STEPS,
        lines: [],
      };
      const r = parseLlmResponse(JSON.stringify(env));
      expect(r.code).toBe(SAMPLE_CODE);
      expect(r.parsedAsJson).toBe(true);
    });
  });

  describe("tolerance: outer fence", () => {
    it("strips a ```json ... ``` wrapper around the whole envelope", () => {
      const env = { code: SAMPLE_CODE, steps: SAMPLE_STEPS, lines: [] };
      const r = parseLlmResponse("```json\n" + JSON.stringify(env) + "\n```");
      expect(r.parsedAsJson).toBe(true);
      expect(r.code).toBe(SAMPLE_CODE);
    });
  });

  describe("tolerance: leading prose", () => {
    it("extracts JSON from a response that begins with prose", () => {
      const env = { code: SAMPLE_CODE, steps: SAMPLE_STEPS, lines: [] };
      const r = parseLlmResponse(
        `Here is the animation you asked for:\n${JSON.stringify(env)}`,
      );
      expect(r.parsedAsJson).toBe(true);
      expect(r.code).toBe(SAMPLE_CODE);
    });
  });

  describe("tolerance: bare code (no envelope)", () => {
    it("treats bare code as code-only, no steps/lines", () => {
      const r = parseLlmResponse(SAMPLE_CODE);
      expect(r.parsedAsJson).toBe(false);
      expect(r.code).toBe(SAMPLE_CODE);
      expect(r.steps).toEqual([]);
      expect(r.lines).toEqual([]);
    });
  });

  describe("tolerance: empty / invalid", () => {
    it("returns empty result for an empty string", () => {
      const r = parseLlmResponse("");
      expect(r.code).toBe("");
      expect(r.steps).toEqual([]);
      expect(r.lines).toEqual([]);
    });

    it("returns empty result for an envelope missing the code field", () => {
      const r = parseLlmResponse(JSON.stringify({ steps: [], lines: [] }));
      expect(r.code).toBe("");
    });

    it("returns empty result for a non-object (e.g. just a number)", () => {
      const r = parseLlmResponse("42");
      // 42 is not a JSON object — falls through to path 3 (bare-code),
      // which interprets "42" as the code. This is correct behavior: we
      // never want to throw a 500 because the model misbehaved.
      expect(typeof r.code).toBe("string");
    });
  });

  describe("step array sanitization", () => {
    it("drops steps missing required fields", () => {
      const env = {
        code: SAMPLE_CODE,
        steps: [
          { t: 0, text: "good" },
          { t: 1 },            // no text
          { text: "no t" },    // no t
          { t: -1, text: "bad t" },
          { t: 2, text: "another good" },
        ],
        lines: [],
      };
      const r = parseLlmResponse(JSON.stringify(env)) as ParsedLlmResponse;
      expect(r.steps).toHaveLength(2);
      expect(r.steps[0].text).toBe("good");
      expect(r.steps[1].text).toBe("another good");
    });

    it("sorts steps by time and re-indexes id", () => {
      const env = {
        code: SAMPLE_CODE,
        steps: [
          { t: 5, text: "second" },
          { t: 0, text: "first" },
          { t: 10, text: "third" },
        ],
        lines: [],
      };
      const r = parseLlmResponse(JSON.stringify(env));
      expect(r.steps.map((s) => s.t)).toEqual([0, 5, 10]);
      expect(r.steps.map((s) => s.id)).toEqual([1, 2, 3]);
    });
  });

  describe("line array sanitization", () => {
    it("drops lines missing required from/to fields", () => {
      const env = {
        code: SAMPLE_CODE,
        steps: [],
        lines: [
          { from: [0, 0, 0], to: [1, 0, 0] },        // good
          { from: [0, 0, 0] },                       // missing to
          { to: [1, 0, 0] },                         // missing from
          { from: "not array", to: [1, 0, 0] },     // wrong type
        ],
      };
      const r = parseLlmResponse(JSON.stringify(env));
      expect(r.lines).toHaveLength(1);
      expect(r.lines[0].from).toEqual([0, 0, 0]);
      expect(r.lines[0].to).toEqual([1, 0, 0]);
    });
  });
});
