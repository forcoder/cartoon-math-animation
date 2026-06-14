/**
 * Tests for the P2 LLM eval rubric. The rubric is the metric we use to
 * decide whether LongCat (or any LLM) is "good enough" to ship. If this
 * math is wrong, the whole P2 verification is meaningless.
 *
 * Rubric: clarity (5) + accuracy (3) + sync with problem (2) = 10 max.
 * Threshold: ≥ 7 to pass.
 */

import { describe, it, expect } from "vitest";

type Score = { clarity: number; accuracy: number; sync: number };

const MAX_CLARITY = 5;
const MAX_ACCURACY = 3;
const MAX_SYNC = 2;
const MAX_TOTAL = MAX_CLARITY + MAX_ACCURACY + MAX_SYNC;
const PASS_THRESHOLD = 7;

function totalScore(s: Score): number {
  return s.clarity + s.accuracy + s.sync;
}

function passes(s: Score): boolean {
  return totalScore(s) >= PASS_THRESHOLD;
}

function clamp(n: number, max: number): number {
  if (n < 0) return 0;
  if (n > max) return max;
  return n;
}

describe("P2 eval rubric", () => {
  it("max total is 10 (clarity 5 + accuracy 3 + sync 2)", () => {
    expect(MAX_TOTAL).toBe(10);
  });

  it("pass threshold is 7 (70%)", () => {
    expect(PASS_THRESHOLD).toBe(7);
  });

  it("perfect score = 10, passes", () => {
    const perfect: Score = { clarity: 5, accuracy: 3, sync: 2 };
    expect(totalScore(perfect)).toBe(10);
    expect(passes(perfect)).toBe(true);
  });

  it("minimum passing score = 7 (clarity 4 + accuracy 2 + sync 1)", () => {
    expect(totalScore({ clarity: 4, accuracy: 2, sync: 1 })).toBe(7);
    expect(passes({ clarity: 4, accuracy: 2, sync: 1 })).toBe(true);
  });

  it("failing score = 6 (clarity 4 + accuracy 1 + sync 1)", () => {
    expect(passes({ clarity: 4, accuracy: 1, sync: 1 })).toBe(false);
  });

  it("zero score fails", () => {
    expect(passes({ clarity: 0, accuracy: 0, sync: 0 })).toBe(false);
  });

  it("clamps scores above the dimension max", () => {
    expect(clamp(99, MAX_CLARITY)).toBe(5);
    expect(clamp(4, MAX_ACCURACY)).toBe(3);
    expect(clamp(7, MAX_SYNC)).toBe(2);
  });

  it("clamps negative scores to 0", () => {
    expect(clamp(-3, MAX_CLARITY)).toBe(0);
  });

  it("evaluator can run the same problem N times and pass if mean ≥ 7", () => {
    const runs: Score[] = [
      { clarity: 5, accuracy: 3, sync: 2 },
      { clarity: 4, accuracy: 2, sync: 1 },
      { clarity: 3, accuracy: 2, sync: 1 },
    ];
    const mean = runs.reduce((sum, r) => sum + totalScore(r), 0) / runs.length;
    expect(mean).toBeCloseTo(7.67, 1);
    expect(mean >= PASS_THRESHOLD).toBe(true);
  });
});