/**
 * Tolerant parser for the LLM response.
 *
 * Why we need a custom parser (instead of just JSON.parse):
 *   The LLM is told to output a strict JSON envelope `{ code, steps, lines }`
 *   but in practice it may:
 *     (a) wrap the JSON in a ```json ... ``` fence (despite the prompt),
 *     (b) prepend a one-line preface like "Here's the animation:",
 *     (c) return just bare code (no envelope) if it forgot the format,
 *     (d) emit broken JSON (truncated, mismatched quotes, etc.).
 *   The route handler must never 500 on a parse failure — it should fall
 *   back to a usable result (code-only, empty steps/lines) and surface
 *   a 502 only if even the bare code is unusable.
 *
 * The parser is intentionally forgiving: any one of the four paths below
 * that yields a `code` string is accepted. We log the raw text server-side
 * for debugging but never throw to the caller.
 */

import type { RenderStep, RenderLine } from "./types";

export interface ParsedLlmResponse {
  code: string;
  steps: RenderStep[];
  lines: RenderLine[];
  /** True if the response was the full JSON envelope. False = fallback path. */
  parsedAsJson: boolean;
}

const FENCE_RE = /^```(?:json|js|javascript|ts|typescript)?\s*\n([\s\S]*?)\n```\s*$/;

/**
 * Strip a single markdown fence wrapping the whole response, if present.
 * Idempotent on already-stripped text.
 */
export function stripMarkdownFences(text: string): string {
  const fenced = text.match(FENCE_RE);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function asStepArray(raw: unknown): RenderStep[] {
  if (!Array.isArray(raw)) return [];
  const out: RenderStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as { t?: unknown; text?: unknown; id?: unknown };
    if (typeof item?.text !== "string" || item.text.length === 0) continue;
    const tNum = typeof item.t === "number" ? item.t : Number(item.t);
    if (!Number.isFinite(tNum) || tNum < 0) continue;
    out.push({
      id: typeof item.id === "number" ? item.id : i + 1,
      t: tNum,
      text: item.text,
    });
  }
  // Sort + re-index by time so the UI is always monotonic.
  out.sort((a, b) => a.t - b.t);
  out.forEach((s, i) => (s.id = i + 1));
  return out;
}

function asLineArray(raw: unknown): RenderLine[] {
  if (!Array.isArray(raw)) return [];
  const out: RenderLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { from?: unknown; to?: unknown; color?: unknown; label?: unknown };
    if (!Array.isArray(obj.from) || obj.from.length !== 3) continue;
    if (!Array.isArray(obj.to) || obj.to.length !== 3) continue;
    const from: [number, number, number] = [
      Number(obj.from[0]) || 0,
      Number(obj.from[1]) || 0,
      Number(obj.from[2]) || 0,
    ];
    const to: [number, number, number] = [
      Number(obj.to[0]) || 0,
      Number(obj.to[1]) || 0,
      Number(obj.to[2]) || 0,
    ];
    const color = typeof obj.color === "number" ? obj.color : undefined;
    const label = typeof obj.label === "string" ? obj.label : undefined;
    out.push({ from, to, color, label });
  }
  return out;
}

/**
 * Try increasingly permissive strategies to extract `{ code, steps, lines }`
 * from a raw LLM response. See file header for the four failure shapes.
 */
export function parseLlmResponse(raw: string): ParsedLlmResponse {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { code: "", steps: [], lines: [], parsedAsJson: false };
  }

  const stripped = stripMarkdownFences(raw);

  // Path 1: direct JSON.parse on the whole response.
  try {
    const obj = JSON.parse(stripped);
    return finalize(obj, raw);
  } catch {
    // fall through
  }

  // Path 2: extract the first { ... } substring (handles a leading preface
  // like "Here's the JSON: { ... }").
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = stripped.slice(firstBrace, lastBrace + 1);
    try {
      const obj = JSON.parse(candidate);
      return finalize(obj, raw);
    } catch {
      // fall through
    }
  }

  // Path 3: bare code (no envelope). The LLM forgot the format.
  return {
    code: stripped,
    steps: [],
    lines: [],
    parsedAsJson: false,
  };
}

function finalize(obj: unknown, rawForLog: string): ParsedLlmResponse {
  if (!obj || typeof obj !== "object") {
    return { code: "", steps: [], lines: [], parsedAsJson: false };
  }
  const env = obj as { code?: unknown; steps?: unknown; lines?: unknown };

  if (typeof env.code !== "string" || env.code.length === 0) {
    return { code: "", steps: [], lines: [], parsedAsJson: false };
  }
  return {
    code: stripMarkdownFences(env.code),
    steps: asStepArray(env.steps),
    lines: asLineArray(env.lines),
    parsedAsJson: true,
  };
  // rawForLog is intentionally not used at runtime — kept for future logging.
  void rawForLog;
}
