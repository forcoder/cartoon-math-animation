/**
 * Tests for the LLM prompt structure. We don't test the prompt content
 * (it's a string the model sees), but we test:
 *   1. The prompt is non-empty and has the expected sections
 *   2. Few-shot examples are present and well-formed
 *   3. Sandbox constraints are listed (so the LLM knows what NOT to do)
 *
 * These are the structural checks that would catch a regression if someone
 * accidentally deletes a section during prompt iteration.
 */

import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/llm-prompt";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("returns a non-empty string", () => {
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("specifies the JSON envelope output (code + steps + lines)", () => {
    // P0: LLM must wrap the module in a {code, steps, lines} JSON envelope
    // so the route can parse steps / lines alongside the animation code.
    expect(prompt).toMatch(/`code`\s*\(string\)/);
    expect(prompt).toMatch(/`steps`\s*\(array\)/);
    expect(prompt).toMatch(/`lines`\s*\(array\)/);
  });

  it("specifies the inner module signature (export default function)", () => {
    expect(prompt).toMatch(/export\s+default\s+function/);
  });

  it("requires the function signature to accept a `view` argument", () => {
    // Regression guard: original prompt had `function(canvas)`, which
    // made the top/side view buttons no-op (the user's reported bug).
    expect(prompt).toMatch(/function\s*\(\s*canvas\s*,\s*view\s*\)/);
  });

  it("documents the three legal view values: default | top | side", () => {
    expect(prompt).toMatch(/'default'/);
    expect(prompt).toMatch(/'top'/);
    expect(prompt).toMatch(/'side'/);
  });

  it("requires fit-to-scene camera placement (so subjects are never cropped)", () => {
    // The user reported "需要能看到整个所有的主体" — without fit, far-apart
    // objects get cropped at the side / horizontal views.
    expect(prompt).toMatch(/fit[\s-]?to[\s-]?scene/i);
    expect(prompt).toMatch(/Box3/);
    expect(prompt).toMatch(/updateMatrixWorld/);
  });

  it("declares the default view as HORIZONTAL (not 45° overhead)", () => {
    // The user explicitly asked for a horizontal default viewpoint.
    expect(prompt).toMatch(/horizontal/i);
    // The old "0, 2, 6" pattern must NOT appear as the recommended default.
    expect(prompt).not.toMatch(/position\.set\(\s*0\s*,\s*2\s*,\s*6\s*\)/);
  });

  it("includes step-generation guidance with Chinese text requirement", () => {
    // Steps are the new P0 deliverable — the LLM must produce 3-8
    // time-ordered Chinese explanation steps.
    expect(prompt).toMatch(/steps.*guidance/i);
    expect(prompt).toMatch(/Chinese/i);
  });

  it("forbids dangerous APIs (sandbox boundary)", () => {
    expect(prompt).toMatch(/fetch/i);
    expect(prompt).toMatch(/importScripts/i);
    expect(prompt).toMatch(/eval/i);
  });

  it("includes few-shot examples", () => {
    expect(prompt).toMatch(/Example\s+[123]/i);
  });

  it("few-shot examples all accept the `view` argument", () => {
    // Count: each example should have `function(canvas, view)`.
    const matches = prompt.match(/function\s*\(\s*canvas\s*,\s*view\s*\)/g);
    expect(matches).not.toBeNull();
    // We have 3 few-shot examples. Allow ≥ 3 to be tolerant of extra
    // references in the prose.
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it("mentions Chinese math problems", () => {
    expect(prompt).toMatch(/中文|Chinese/i);
  });

  it("specifies a renderable scene (camera, geometry, animation)", () => {
    expect(prompt).toMatch(/camera|renderer|scene/i);
  });
});

describe("buildUserPrompt", () => {
  it("embeds the problem text verbatim", () => {
    const problem = "一根长为12cm的木棒按1:2切分";
    const prompt = buildUserPrompt(problem);
    expect(prompt).toContain(problem);
  });

  it("includes the problem unchanged (no LLM-side translation)", () => {
    const problem = "12cm stick rotated 180° around point O at 1:2 cut";
    const prompt = buildUserPrompt(problem);
    expect(prompt).toContain(problem);
    expect(prompt).not.toContain("translate");
  });
});