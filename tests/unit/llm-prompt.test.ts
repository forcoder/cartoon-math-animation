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

  it("specifies the output contract (export default function)", () => {
    expect(prompt).toMatch(/export\s+default\s+function/);
  });

  it("forbids dangerous APIs (sandbox boundary)", () => {
    expect(prompt).toMatch(/fetch/i);
    expect(prompt).toMatch(/importScripts/i);
    expect(prompt).toMatch(/eval/i);
  });

  it("includes few-shot examples", () => {
    expect(prompt).toMatch(/Example\s+[123]/i);
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