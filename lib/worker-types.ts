/**
 * Message contracts for the Dedicated Worker sandbox and the main-thread bridge.
 *
 * Keep this file dependency-free so the worker (which has no DOM, no Next.js)
 * can import the types without dragging in any bundler-only modules.
 */

export interface SandboxMessage {
  /** LLM-generated Three.js code, treated as a self-contained JS module string. */
  code: string;
  /**
   * Target canvas dimensions in CSS pixels. Sent along with the code so the
   * worker can include width/height in its stub `canvas` object (some LLM
   * output reads `canvas.width` / `canvas.height` during setup).
   */
  canvasSize: { width: number; height: number };
}

export type SandboxResponseType = 'ready' | 'error' | 'timeout';

export interface SandboxResponse {
  type: SandboxResponseType;
  /** Populated when type === 'error'. */
  message?: string;
  /** Populated when type === 'error' — first 1-3 lines of a stack trace if available. */
  stack?: string;
}

/**
 * A heartbeat the main thread can use to track the animation's render frame
 * budget (60fps × 30s = 1800 frames per design doc). The bridge (or
 * AnimationCanvas) counts these and force-stops when the budget is exhausted.
 */
export interface RenderFrame {
  type: 'frame';
  /** performance.now() at the time the frame was rendered. */
  timestamp: number;
}
