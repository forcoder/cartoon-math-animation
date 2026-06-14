/**
 * Three.js helpers for the main-thread animation mount.
 *
 * The Worker validates that LLM-generated code parses and references
 * resolve, but the actual WebGL render lives here, on the main thread,
 * where the `<canvas>` element exists. WebGL contexts cannot cross
 * worker boundaries, so this split is structural, not a design choice.
 *
 * The LLM-generated code's default-exported function receives a real
 * `<canvas>` element and a `view` name, and is expected to return a
 * cleanup function. The host page can call `applyViewPreset` to
 * reposition the camera when the user clicks a view button — the LLM
 * code is expected to expose its camera via the `THREE` global or
 * accept `view` as a parameter; either pattern works because the
 * host page re-executes the LLM function on view change.
 */

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Color,
  AmbientLight,
  DirectionalLight,
} from 'three';

export interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
}

export interface ViewPreset {
  cameraPosition: [number, number, number];
  cameraLookAt: [number, number, number];
}

export const VIEW_PRESETS: Readonly<Record<'default' | 'top' | 'side', ViewPreset>> = {
  default: {
    cameraPosition: [5, 5, 8],
    cameraLookAt: [0, 0, 0],
  },
  top: {
    cameraPosition: [0, 12, 0.001],
    cameraLookAt: [0, 0, 0],
  },
  side: {
    cameraPosition: [12, 0, 0],
    cameraLookAt: [0, 0, 0],
  },
};

export const FRAME_BUDGET = 1800; // 60fps × 30s, per design doc
export const DEFAULT_BG_COLOR = 0xf8fafc; // slate-50 — matches the page chrome

/**
 * Create a Scene, PerspectiveCamera, and WebGLRenderer bound to the
 * provided canvas. Lighting is added with sensible defaults so the
 * LLM code can focus on geometry, not on a dark void.
 */
export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const width = canvas.clientWidth || canvas.width || 640;
  const height = canvas.clientHeight || canvas.height || 360;

  const scene = new Scene();
  scene.background = new Color(DEFAULT_BG_COLOR);

  const camera = new PerspectiveCamera(50, width / height, 0.1, 1000);
  const defaultView = VIEW_PRESETS.default;
  camera.position.set(...defaultView.cameraPosition);
  camera.lookAt(...defaultView.cameraLookAt);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);

  // Default lighting — overwritten by LLM code if it wants a different mood.
  const ambient = new AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const keyLight = new DirectionalLight(0xffffff, 0.8);
  keyLight.position.set(5, 8, 5);
  scene.add(keyLight);

  return { scene, camera, renderer };
}

/**
 * Drive requestAnimationFrame, capping at `frameBudget` frames so an
 * infinite animation cannot burn the user's CPU. Returns a `stop`
 * function that the caller invokes on cleanup.
 *
 * `onFrame` is called with delta-time in seconds. If it returns a
 * truthy value the loop stops early (used by the LLM `animate(t, ctx)`
 * contract to signal completion).
 */
export function startRenderLoop(
  scene: Scene,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
  onFrame?: (deltaSeconds: number, totalSeconds: number) => boolean | void,
  frameBudget: number = FRAME_BUDGET,
): () => void {
  let stopped = false;
  let frameCount = 0;
  let lastTs = performance.now();
  const startTs = lastTs;

  function tick(now: number): void {
    if (stopped) return;
    const delta = (now - lastTs) / 1000;
    const total = (now - startTs) / 1000;
    lastTs = now;
    frameCount += 1;

    if (onFrame) {
      const done = onFrame(delta, total);
      if (done) {
        stop();
        return;
      }
    }

    renderer.render(scene, camera);

    if (frameCount >= frameBudget) {
      stop();
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  let rafId = requestAnimationFrame(tick);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
  }

  return stop;
}

/**
 * Apply a view preset to a camera (position + lookAt). Used when the
 * user clicks a preset button and the camera needs to snap to a new
 * vantage point.
 */
export function applyViewPreset(camera: PerspectiveCamera, view: keyof typeof VIEW_PRESETS): void {
  const preset = VIEW_PRESETS[view];
  camera.position.set(...preset.cameraPosition);
  camera.lookAt(...preset.cameraLookAt);
  camera.updateProjectionMatrix();
}
