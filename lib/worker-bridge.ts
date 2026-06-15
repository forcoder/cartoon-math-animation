/**
 * Main-thread bridge between the LLM-generated code, the Dedicated Worker
 * sandbox, and the live Three.js mount.
 *
 * Lifecycle:
 *   1. `mountAnimation(element, code, view)` is called by AnimationCanvas
 *      when the user has a fresh problem to render.
 *   2. We spawn a `WorkerBridge`, which posts the code into a Dedicated
 *      Worker. The worker validates that the code parses, exports a
 *      function, and runs end-to-end with a stubbed THREE/canvas —
 *      with fetch/importScripts disabled and a 10s timeout. This
 *      catches cheap errors (syntax, missing default export, hallucinated
 *      THREE methods) before we ever allocate a real Three.js context.
 *   3. On `ready`, we append a fresh `<canvas>` to the element, hand
 *      it to the LLM's default-exported function, and store the
 *      returned cleanup. The LLM function owns scene/camera/renderer/
 *      animation loop per the contract in `lib/llm-prompt.ts`.
 *   4. On `error` or `timeout`, we throw a `MountAnimationError` that
 *      AnimationCanvas catches and surfaces to the page-level
 *      ErrorState component.
 *
 * Why Worker validates + main thread renders (vs. one or the other):
 *   - WebGL contexts cannot cross worker boundaries. A worker cannot
 *     own the user's canvas, so the actual render must happen here.
 *   - A worker CAN cheaply catch the failures the design doc cares
 *     about (syntax errors, missing default export, hallucinated API
 *     references, runaway setup loops). Doing that on the main thread
 *     would freeze the UI and still need a separate timeout mechanism.
 *   - Splitting validation from rendering also keeps the LLM code's
 *     execution path deterministic in tests — we can mock the worker
 *     response in vitest without touching WebGL.
 */

import type { SandboxMessage, SandboxResponse } from './worker-types';

export type ViewName = 'default' | 'top' | 'side';

export interface MountResult {
  /**
   * Cleanup function returned by the LLM's default export. The
   * caller (AnimationCanvas) must invoke it on unmount or when the
   * user submits a new problem.
   */
  cleanup: () => void;
}

export interface BridgeResult {
  success: boolean;
  /** True when the worker itself failed to LOAD (404, import error, etc.). */
  loadError?: boolean;
  error?: string;
}

// Hard cap on the wall-clock wait for the worker verdict. The worker
// has its own 10s budget; this gives 2s of postMessage round-trip
// slack so transient scheduling delays do not produce false timeouts.
const BRIDGE_TIMEOUT_MS = 12_000;

interface UserSetupFunction {
  (canvas: HTMLCanvasElement, view: ViewName): () => void;
}

/**
 * Mount a Three.js animation driven by LLM-generated `code` into a
 * container element. The element gets a fresh `<canvas>` appended; the
 * previous canvas (if any) is removed first.
 *
 * Returns a `MountResult` whose `cleanup` is whatever the LLM code
 * returned from its default export (typically: stop the rAF loop and
 * dispose the renderer).
 */
export async function mountAnimation(
  element: HTMLElement,
  code: string,
  view: ViewName,
): Promise<MountResult> {
  // 1. Validate the code in a sandboxed worker. Catches cheap errors
  //    before we ever allocate a WebGL context.
  //
  //    Three outcomes from the worker:
  //    a) success: true  — code parsed, we trust it. Continue to main thread.
  //    b) success: false, loadError: false — worker ran, code is bad.
  //       Surface the error to the user.
  //    c) loadError: true — worker itself failed to load (URL 404, etc.).
  //       Degrade gracefully: skip validation, let main thread try.
  //       The worker is defense-in-depth, not a hard requirement.
  let validation: BridgeResult;
  try {
    const bridge = new WorkerBridge();
    try {
      validation = await bridge.executeCode(code, {
        width: element.clientWidth || 640,
        height: element.clientHeight || 360,
      });
    } finally {
      bridge.terminate();
    }
  } catch (workerLoadError) {
    // Synchronous failure (e.g. Worker constructor threw). Treat as load error.
    console.warn(
      '[cartoon] Worker construction failed, running code on main thread only:',
      workerLoadError,
    );
    validation = { success: true };
  }

  if (validation.loadError) {
    console.warn(
      '[cartoon] Worker sandbox failed to load, running code on main thread only:',
      validation.error,
    );
    validation = { success: true };
  }

  if (!validation.success) {
    throw new MountAnimationError(validation.error ?? '代码验证失败', /* retryable */ true);
  }

  // 2. Append a real <canvas> for the LLM code to render into.
  const canvas = document.createElement('canvas');
  const cssWidth = element.clientWidth || 640;
  const cssHeight = element.clientHeight || 360;
  // Three.js reads `canvas.width`/`height` (the buffer), not CSS. CSS
  // makes the canvas fill the parent; the buffer determines render
  // resolution. We set both so a renderer that reads either one works.
  canvas.width = cssWidth;
  canvas.height = cssHeight;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  element.replaceChildren(canvas);

  // 3. Re-execute the LLM code on the main thread. Same transformation
  //    as the worker (export default → return) so the function can
  //    run in `new Function`'s script context. Defense in depth: we
  //    also re-disable `fetch` / `importScripts` here so a worker
  //    bypass cannot exfiltrate data on the main thread. The originals
  //    are restored in `finally` so we never leak the disabled state
  //    into a subsequent mount.
  const originalFetch = globalThis.fetch;
  const originalImportScripts: unknown = (globalThis as { importScripts?: unknown }).importScripts;
  globalThis.fetch = (() => {
    throw new Error('fetch disabled in sandbox');
  }) as typeof fetch;
  if (typeof originalImportScripts === 'function') {
    (globalThis as { importScripts?: unknown }).importScripts = () => {
      throw new Error('importScripts disabled in sandbox');
    };
  }

  let cleanup: () => void;
  const THREE = await import('three');
  // The LLM prompt (`lib/llm-prompt.ts`) instructs the model to
  // reference `THREE` as a global. We inject it onto `globalThis` so
  // the inner function's scope chain resolves it without needing a
  // parameter — matching the worker sandbox's behavior. Restored in
  // `finally` so we never leak the global.
  const hadThree = Object.prototype.hasOwnProperty.call(globalThis, 'THREE');
  const originalThree: unknown = (globalThis as Record<string, unknown>).THREE;
  (globalThis as Record<string, unknown>).THREE = THREE;

  try {
    const scriptBody = stripExportDefault(code);
    // The body has already been transformed so `export default fn`
    // becomes `return fn`. We wrap it in a no-arg factory and
    // immediately invoke to retrieve the default-exported function.
    const factory = new Function(`"use strict";\n${scriptBody}\n`) as () => unknown;
    const defaultExport = factory() as UserSetupFunction;
    if (typeof defaultExport !== 'function') {
      throw new MountAnimationError(
        'LLM 代码必须导出 `export default function(canvas, view) { ... }`',
        /* retryable */ true,
      );
    }
    const returned = defaultExport(canvas, view);

    // Contract allows EITHER:
    //   (a) a cleanup function `() => void`, OR
    //   (b) a `{ stop(): void, setPaused?(p: boolean): void }` controller.
    // LongCat consistently returns (b); older code returns (a). Accept both.
    if (typeof returned === 'function') {
      cleanup = returned;
    } else if (returned && typeof (returned as { stop?: unknown }).stop === 'function') {
      const controller = returned as { stop(): void; setPaused?: (p: boolean) => void };
      cleanup = () => controller.stop();
    } else {
      throw new MountAnimationError(
        'LLM 默认导出函数必须返回 cleanup 函数或 { stop, setPaused } 控制器',
        /* retryable */ true,
      );
    }
  } catch (execError) {
    throw new MountAnimationError(
      execError instanceof Error ? execError.message : '代码执行失败',
      /* retryable */ true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (typeof originalImportScripts === 'function') {
      (globalThis as { importScripts?: unknown }).importScripts = originalImportScripts;
    }
    if (hadThree) {
      (globalThis as Record<string, unknown>).THREE = originalThree;
    } else {
      delete (globalThis as Record<string, unknown>).THREE;
    }
  }

  return { cleanup };
}

/**
 * Rewrite the ESM-only `export default` form to a plain `return`, so
 * the body can run in `new Function`'s script context. Matches the
 * transformation applied by `workers/sandbox.worker.ts` — they must
 * stay in sync, otherwise the worker accepts code that the main
 * thread rejects (or vice versa).
 */
function stripExportDefault(source: string): string {
  return source.replace(/^\s*export\s+default\s+/m, 'return ');
}

export class MountAnimationError extends Error {
  public readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'MountAnimationError';
    this.retryable = retryable;
  }
}

/**
 * Spawn a Dedicated Worker, send it LLM code, wait for a verdict.
 *
 * One instance per `executeCode` call. The caller must invoke
 * `terminate()` in a `finally` to release the worker thread.
 */
export class WorkerBridge {
  private readonly worker: Worker;
  private canvasSize: { width: number; height: number };
  private settled: boolean = false;
  private resolveFn: ((result: BridgeResult) => void) | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  /** Captures an error that fires BEFORE executeCode() is called. */
  private pendingError: BridgeResult | null = null;

  constructor(workerUrl: string = new URL('../workers/sandbox.worker.ts', import.meta.url).href) {
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.canvasSize = { width: 640, height: 360 };
    this.worker.addEventListener('message', this.onMessage);
    this.worker.addEventListener('error', this.onWorkerError);
  }

  /**
   * Send code to the worker and resolve with a verdict. The worker
   * only needs the canvas dimensions, not the canvas itself — the
   * actual `<canvas>` lives on the main thread where the WebGL
   * context will be created. (See file header for the split-render
   * rationale.)
   */
  public executeCode(
    code: string,
    canvasSize: { width: number; height: number },
  ): Promise<BridgeResult> {
    if (this.resolveFn) {
      return Promise.reject(
        new Error('WorkerBridge is single-shot — call executeCode once per instance'),
      );
    }
    this.canvasSize = { width: canvasSize.width, height: canvasSize.height };

    // If the worker already errored during construction (e.g. 404 on the
    // worker URL), reject immediately instead of hanging forever. This is
    // the most common "Worker 异常：undefined" root cause.
    if (this.pendingError) {
      return Promise.reject(new Error(this.pendingError.error ?? 'Worker failed to load'));
    }

    return new Promise((resolve) => {
      this.resolveFn = resolve;

      this.timeoutHandle = setTimeout(() => {
        this.settle({
          success: false,
          error: '代码执行超时（超过 10s）',
        });
        // The worker may still be running. Forcing close here is safe
        // because we never need a verdict from it.
        this.worker.terminate();
      }, BRIDGE_TIMEOUT_MS);

      const message: SandboxMessage = { code, canvasSize: this.canvasSize };
      this.worker.postMessage(message);
    });
  }

  public terminate(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
    this.worker.terminate();
  }

  private onMessage = (event: MessageEvent<SandboxResponse>): void => {
    const response = event.data;
    switch (response.type) {
      case 'ready':
        this.settle({ success: true });
        return;
      case 'error':
        this.settle({
          success: false,
          error: response.message ?? 'Worker reported an error',
        });
        return;
      case 'timeout':
        this.settle({
          success: false,
          error: '代码执行超时（超过 10s）',
        });
        return;
      default: {
        // Unknown message types are ignored. We keep the bridge open
        // for the configured timeout window in case the worker sends
        // a follow-up `error`/`ready` we care about.
        const exhaustive: never = response.type;
        void exhaustive;
      }
    }
  };

  private onWorkerError = (event: Event): void => {
    // Worker error events vary by browser + cause. Capture every field
    // we can so the user sees a useful message instead of "undefined".
    const e = event as ErrorEvent & {
      filename?: string;
      lineno?: number;
      colno?: number;
    };
    const detail =
      e.message ||
      e.error?.message ||
      (e.error ? String(e.error) : null) ||
      e.filename ||
      `event type=${event.type}`;
    console.error('[cartoon] Worker error event:', event);
    const result: BridgeResult = {
      success: false,
      loadError: true,
      error: `Worker 加载失败：${detail}${e.lineno ? ` (line ${e.lineno})` : ''}`,
    };
    // If executeCode() hasn't been called yet, stash the error so the
    // next call rejects immediately instead of hanging forever.
    if (!this.resolveFn) {
      this.pendingError = result;
      return;
    }
    this.settle(result);
  };

  private settle(result: BridgeResult): void {
    if (this.settled) return;
    this.settled = true;
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.resolveFn) this.resolveFn(result);
  }
}

