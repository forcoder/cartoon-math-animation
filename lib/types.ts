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

export interface RenderResponse {
  /** Generated Three.js code (a self-contained JS module string). */
  code: string;
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