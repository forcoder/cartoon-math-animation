/**
 * Shared types for the /api/render pipeline.
 *
 * Kept dependency-free so both server (route handler) and any client-side
 * fetcher can import them without pulling in node-only modules.
 */

export interface RenderRequest {
  /** Math problem written by the user in Chinese (or any natural language). */
  problem: string;
  /** Invite code gate, validated against ALLOWED_INVITE_CODES env var. */
  inviteCode: string;
}

/**
 * A single step in the problem's verbal explanation timeline.
 * `t` is the offset in seconds from the start of the animation when this
 * step's text should be highlighted in the side panel.
 */
export interface RenderStep {
  /** Display order, 1-indexed for human-friendly keys. */
  id: number;
  /** Offset from animation start, in seconds. */
  t: number;
  /** Chinese explanation of what this part of the animation is showing. */
  text: string;
}

/**
 * A 3D auxiliary line drawn on top of the animation. P0 stores these
 * but does not render them — they're picked up by P1 (3D 画线).
 */
export interface RenderLine {
  /** Start point in world coordinates. */
  from: [number, number, number];
  /** End point in world coordinates. */
  to: [number, number, number];
  /** Three.js color integer, e.g. 0xef4444. Stored as number for JSON-friendliness. */
  color?: number;
  /** Optional Chinese label rendered next to the line in P2. */
  label?: string;
}

export interface RenderResponse {
  /** Generated Three.js code (a self-contained JS module string). */
  code: string;
  /** Step-by-step verbal explanation synchronized to the animation timeline. */
  steps: RenderStep[];
  /** Auxiliary 3D lines (drawn in P1). */
  lines: RenderLine[];
  /** Total wall-clock latency in ms (includes cache lookup + LLM if any). */
  latency: number;
  /** True when the response came from the Upstash cache, false when freshly generated. */
  fromCache: boolean;
}

export interface ErrorResponse {
  /** Human-friendly error message safe to surface in the UI. */
  error: string;
  /** Whether the client should offer a "再试一次" retry button. */
  retryable: boolean;
}

/**
 * Discriminated result returned by the route handler.
 * The API route serializes either RenderResponse or ErrorResponse based on `ok`.
 */
export type RenderResult =
  | ({ ok: true } & RenderResponse)
  | ({ ok: false } & ErrorResponse);