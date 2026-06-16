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
 *
 * P3b added two optional per-step hooks for camera follow + mesh focus:
 *   - `focus.mesh` — name of the mesh that this step is "about" (the
 *     LLM must set `mesh.name` on the corresponding geometry). The
 *     host will swap an emissive highlight onto it when the playhead
 *     crosses this step's `t`.
 *   - `camera` — world position the camera should tween to for this
 *     step. Omit to keep the camera where it was (useful for steps
 *     that just explain a static scene).
 */
export interface RenderStep {
  /** Display order, 1-indexed for human-friendly keys. */
  id: number;
  /** Offset from animation start, in seconds. */
  t: number;
  /** Chinese explanation of what this part of the animation is showing. */
  text: string;
  /** Optional: which mesh this step is about. */
  focus?: { mesh?: string };
  /** Optional: world-space camera position for this step. */
  camera?: [number, number, number];
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
  /** Which provider served this answer ("primary", "fallback-1", ...). */
  provider: string;
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