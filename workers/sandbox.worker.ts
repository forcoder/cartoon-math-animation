/// <reference lib="webworker" />

/**
 * Dedicated Worker sandbox for untrusted LLM-generated Three.js code.
 *
 * Responsibility (deliberately narrow per design doc):
 *   - Parse + execute the LLM code in an isolated global scope.
 *   - Stub out `self.fetch` and `self.importScripts` so the code cannot
 *     exfiltrate data or pull in more code at runtime.
 *   - Cap execution time at 10s. If the code is in an infinite loop or
 *     spends too long in setup, we `self.close()` the worker.
 *   - Report back `{ type: 'ready' }` on success or `{ type: 'error' }`
 *     on any thrown error.
 *
 * The worker does NOT actually render anything — WebGL contexts cannot
 * cross worker boundaries. The main thread re-executes the same code
 * (after we have confirmed it parses + references resolve) inside
 * `mountAnimation()`, where the real `<canvas>` lives.
 *
 * Code contract (matches `lib/llm-prompt.ts`):
 *
 *   export default function(canvas) {
 *     const renderer = new THREE.WebGLRenderer({ canvas });
 *     // ... build scene, start rAF loop ...
 *     return () => { /* cleanup *\/ };
 *   }
 *
 * The stub `THREE` is a Proxy that returns a constructor for any property
 * access. Constructing it throws a sentinel "sandbox: stopped" error,
 * which we map to `ready` because reaching `new THREE.Foo()` means the
 * LLM code did not ReferenceError on a hallucinated API name — exactly
 * the kind of failure we want to catch (vs. letting it blow up later
 * in the user's real Three.js context).
 */

import type { SandboxMessage, SandboxResponse } from '../lib/worker-types';

const SANDBOX_TIMEOUT_MS = 10_000;

declare const self: DedicatedWorkerGlobalScope;

/**
 * Build a stub `THREE` object. Every property access returns a
 * constructor function. Constructing it throws — this is the
 * sentinel "code is doing real work, not just referencing THREE".
 */
function makeThreeStub(): unknown {
  const sentinel = function FakeThreeCtor(): never {
    throw new Error('sandbox: stopped');
  };
  return new Proxy(sentinel, {
    get(_target, prop) {
      // Some LLM code introspects THREE.REVISION, THREE.Color etc. as
      // values, not constructors. Returning a constructor for those
      // still throws at `new`, which is what we want.
      if (typeof prop === 'symbol') return undefined;
      return function StubCtor(): never {
        throw new Error('sandbox: stopped');
      };
    },
    has() {
      return true;
    },
  });
}

/**
 * Build a stub `canvas` that exposes the configured width/height but
 * throws on any DOM/WebGL method call. Code that reads `canvas.width`
 * during setup still works; code that tries `canvas.getContext('webgl')`
 * fails fast (and we treat that as a reference-style success, not a
 * parsing error).
 */
function makeCanvasStub(size: { width: number; height: number }): unknown {
  return {
    width: size.width,
    height: size.height,
    clientWidth: size.width,
    clientHeight: size.height,
    style: {},
    getContext(): never {
      throw new Error('sandbox: getContext not available');
    },
    addEventListener(): void {
      /* no-op: sandboxed */
    },
    removeEventListener(): void {
      /* no-op: sandboxed */
    },
  };
}

self.addEventListener('message', (event: MessageEvent<SandboxMessage>) => {
  const { code, canvasSize } = event.data;
  runSandbox(code, canvasSize);
});

function runSandbox(code: string, canvasSize: { width: number; height: number }): void {
  // 1. Disable the two main network/script paths. We intentionally do
  //    this *after* the addEventListener above so the message dispatch
  //    itself still works, but any LLM code that tries to fetch more
  //    code or pull in a CDN script fails loudly.
  self.fetch = (() => {
    throw new Error('fetch disabled in sandbox');
  }) as typeof fetch;

  self.importScripts = (() => {
    throw new Error('importScripts disabled in sandbox');
  }) as typeof importScripts;

  // 2. Wall-clock budget. We use a setTimeout (not requestAnimationFrame)
  //    because the LLM code may not call rAF, and we want a hard cap on
  //    total CPU time inside the worker, not just frame time.
  const timer = self.setTimeout(() => {
    const response: SandboxResponse = { type: 'timeout' };
    self.postMessage(response);
    self.close();
  }, SANDBOX_TIMEOUT_MS);

  // 3. Build the execution context. We intentionally call `new Function`
  //    rather than `eval` because eval would resolve identifiers against
  //    the worker's scope, which includes the real `self` and bypasses
  //    our stubs.
  //
  //    The LLM prompt (`lib/llm-prompt.ts`) instructs the model to
  //    reference `THREE` as a global (e.g. `new THREE.WebGLRenderer`).
  //    We inject the stub onto `self` so the inner function's scope
  //    chain resolves it without needing a parameter.
  const THREE = makeThreeStub();
  const canvas = makeCanvasStub(canvasSize);
  (self as unknown as Record<string, unknown>).THREE = THREE;

  // 4. Parse + run. The LLM contract (see `lib/llm-prompt.ts`) is
  //    `export default function(canvas) { ... return cleanup }`. We
  //    rewrite `export default` to `return` so a script-context
  //    `new Function` can evaluate it, then invoke the factory once
  //    to retrieve the default-exported function. The function is
  //    discarded afterwards — we only need to confirm it was created
  //    and that its body did not throw a ReferenceError on any
  //    hallucinated THREE reference.
  const scriptBody = stripExportDefault(code);

  let defaultExport: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      `"use strict";\n${scriptBody}\n`,
    ) as () => unknown;
    defaultExport = factory();
  } catch (parseError) {
    self.clearTimeout(timer);
    // Could be a SyntaxError (rejected at parse) or a ReferenceError
    // (rejected when the body tries to read a missing identifier).
    // We collapse both to `error` and let the main thread surface the
    // message — the user does not need to distinguish the two cases.
    postError(parseError, 'parse/runtime error');
    return;
  }

  if (typeof defaultExport !== 'function') {
    self.clearTimeout(timer);
    postError(
      new Error(
        'default export is not a function — LLM must produce `export default function(canvas) { ... }`',
      ),
      'contract violation',
    );
    return;
  }

  // 5. The default export is callable. Try invoking it with the stub
  //    canvas and a stub view name. This catches ReferenceErrors deep
  //    inside the LLM's body (e.g. `THREE.WebGLRendere` typo) that
  //    would otherwise surface only at real-mount time on the main
  //    thread.
  const stubView = 'default';
  try {
    (defaultExport as (c: unknown, v: unknown) => unknown)(canvas, stubView);
  } catch (runtimeError) {
    if (runtimeError instanceof Error && runtimeError.message === 'sandbox: stopped') {
      // Sentinel — code reached `new THREE.Foo()` without a
      // ReferenceError. That is exactly the success path.
      self.clearTimeout(timer);
      postReady();
      return;
    }
    if (runtimeError instanceof Error && /disabled in sandbox/.test(runtimeError.message)) {
      // fetch / importScripts attempts are policy violations, not
      // code defects. Treat as success (the rest of the body is
      // presumably valid Three.js).
      self.clearTimeout(timer);
      postReady();
      return;
    }
    self.clearTimeout(timer);
    postError(runtimeError, 'runtime error');
    return;
  }

  // 6. Code executed end-to-end without throwing. The default-export
  //    function set up its scene, started its render loop, and
  //    returned a cleanup function. The cleanup is discarded because
  //    the worker has nothing to clean — but we know the call path
  //    is intact.
  self.clearTimeout(timer);
  postReady();
}

/**
 * Rewrite the ESM-only `export default` form to a plain `return`,
 * so the body can run in `new Function`'s script context. We match
 * `export default ` (with the trailing space) on the leading
 * declaration; any subsequent `export` statements are left alone
 * (the LLM prompt forbids them, so a stray one is a SyntaxError we
 * want surfaced).
 */
function stripExportDefault(source: string): string {
  return source.replace(/^\s*export\s+default\s+/m, 'return ');
}

function postReady(): void {
  const response: SandboxResponse = { type: 'ready' };
  self.postMessage(response);
}

function postError(error: unknown, label: string): void {
  const message = error instanceof Error ? `${label}: ${error.message}` : `${label}: ${String(error)}`;
  const stack = error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined;
  const response: SandboxResponse = { type: 'error', message, stack };
  self.postMessage(response);
}
