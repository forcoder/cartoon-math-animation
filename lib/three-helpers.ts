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
  Box3,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import type { RenderLine } from './types';

export type ViewName = 'default' | 'top' | 'side';

export interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
}

export interface ViewPreset {
  /** Camera position. The view direction (default→z axis, top→y axis, side→x axis)
   *  is implicit in the key. Fit-to-scene scales the distance from the lookAt point
   *  but preserves the direction. */
  cameraPosition: [number, number, number];
  cameraLookAt: [number, number, number];
}

/**
 * View preset = direction (where the camera is looking from) + a SEED distance.
 * `fitCameraToScene` recomputes the actual distance from scene bbox, but the
 * direction is always one of these three — never arbitrary.
 */
export const VIEW_PRESETS: Readonly<Record<ViewName, ViewPreset>> = {
  default: {
    // Horizontal viewpoint: nearly eye-level (y=1) looking down the −z axis.
    // Matches the user's request: "默认使用水平视角".
    cameraPosition: [0, 1, 12],
    cameraLookAt: [0, 0, 0],
  },
  top: {
    // Top-down: camera is straight above, looking straight down.
    // Tiny z offset (0.001) so the lookAt direction is well-defined.
    cameraPosition: [0, 12, 0.001],
    cameraLookAt: [0, 0, 0],
  },
  side: {
    // Pure side view: camera on +x axis, looking at origin.
    cameraPosition: [12, 0, 0],
    cameraLookAt: [0, 0, 0],
  },
};

export const FRAME_BUDGET = 1800; // 60fps × 30s, per design doc
export const DEFAULT_BG_COLOR = 0xf8fafc; // slate-50 — matches the page chrome
export const FIT_PADDING = 1.4; // 40% headroom so objects don't kiss the frustum edge

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
export function applyViewPreset(camera: PerspectiveCamera, view: ViewName): void {
  const preset = VIEW_PRESETS[view];
  camera.position.set(...preset.cameraPosition);
  camera.lookAt(...preset.cameraLookAt);
  camera.updateProjectionMatrix();
}

/**
 * Compute a bounding box that contains every visible mesh in the scene.
 * Lights, helpers, and groups without geometry are excluded — we only
 * care about things that should be inside the camera frustum.
 *
 * If the scene is empty (or contains only lights/helpers), returns null
 * so the caller can fall back to a default camera placement.
 */
export function computeSceneBoundingBox(scene: Scene): Box3 | null {
  const bbox = new Box3();
  let hasGeometry = false;
  scene.traverse((obj) => {
    // Mesh.isMesh narrows the type but `as any` here would lose the
    // type-narrowing benefit. Use a direct property check instead.
    if ((obj as { isMesh?: boolean }).isMesh === true) {
      const mesh = obj as import('three').Mesh;
      if (mesh.geometry) {
        mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) {
          bbox.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
          hasGeometry = true;
        }
      }
    }
  });
  return hasGeometry ? bbox : null;
}

/**
 * Position the camera so EVERY visible mesh in the scene fits inside the
 * frustum, with a 40% padding headroom by default. The view direction
 * is locked to one of the three `VIEW_PRESETS` (horizontal / top-down /
 * side) — fit-to-scene only changes the DISTANCE, never the direction.
 *
 * Math:
 *   requiredDistance = boundingSphereRadius / sin(fov/2)
 *   account for the canvas aspect ratio so wide/tall canvases still fit
 *
 * Call this AFTER all meshes have been added to the scene and AFTER
 * scene.updateMatrixWorld(true) (otherwise mesh.matrixWorld is stale).
 */
export function fitCameraToScene(
  scene: Scene,
  camera: PerspectiveCamera,
  view: ViewName,
  padding: number = FIT_PADDING,
): void {
  const bbox = computeSceneBoundingBox(scene);
  const preset = VIEW_PRESETS[view];

  if (!bbox) {
    // No geometry to frame — just snap to the preset as-is.
    camera.position.set(...preset.cameraPosition);
    camera.lookAt(...preset.cameraLookAt);
    camera.updateProjectionMatrix();
    return;
  }

  const center = new Vector3();
  bbox.getCenter(center);

  // Bounding-sphere radius from the bbox diagonal — over-estimates the
  // true sphere, but the padding factor absorbs that slack.
  const size = new Vector3();
  bbox.getSize(size);
  const bboxRadius = size.length() / 2;

  // PerspectiveCamera.fov is the VERTICAL fov in degrees. Convert and
  // adjust for aspect ratio so a wide canvas doesn't crop the sides.
  const vFovRad = (camera.fov * Math.PI) / 180;
  const aspect = camera.aspect;
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
  const minFovRad = Math.min(vFovRad, hFovRad);
  const distance = (bboxRadius / Math.sin(minFovRad / 2)) * padding;

  // Direction = unit vector from preset.position to preset.lookAt.
  // Place the camera at `center + direction * distance` so the bbox
  // center lands at the lookAt point and the scene fills the frame.
  const dir = new Vector3()
    .fromArray(preset.cameraPosition)
    .sub(new Vector3().fromArray(preset.cameraLookAt))
    .normalize();

  camera.position.copy(center).add(dir.multiplyScalar(distance));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

/**
 * Render a batch of `RenderLine` specs as Three.js LineSegments added
 * to the given scene. Used by mountAnimation in P1 to overlay 3D
 * auxiliary lines (distance markers, angle bisectors, tick marks,
 * dashed dividers) on top of whatever the LLM-generated code already
 * drew.
 *
 * Each `RenderLine` becomes ONE segment (from `from` to `to`). To draw
 * a multi-segment polyline, emit multiple entries — the caller controls
 * the geometry, we just materialise.
 *
 * Default color is 0x1e293b (slate-800) so lines stay visible on the
 * 0xf8fafc background. WebGL clamps `linewidth` to 1 on most platforms
 * (this is a long-standing browser limitation, not our bug) — we keep
 * the contract honest about it.
 *
 * Returns the created LineSegments so the caller can dispose it on
 * unmount. Empty input returns an invisible placeholder so the caller
 * can call `dispose()` uniformly.
 */
export function addLinesToScene(
  scene: Scene,
  lines: ReadonlyArray<RenderLine>,
): LineSegments {
  if (!lines || lines.length === 0) {
    // Empty placeholder so the caller's cleanup path is uniform.
    const geom = new BufferGeometry();
    const mat = new LineBasicMaterial({ color: 0x1e293b });
    const obj = new LineSegments(geom, mat);
    obj.visible = false;
    scene.add(obj);
    return obj;
  }

  const positions = new Float32Array(lines.length * 6);
  const colors = new Float32Array(lines.length * 6);

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const [fx, fy, fz] = ln.from;
    const [tx, ty, tz] = ln.to;
    positions.set([fx, fy, fz, tx, ty, tz], i * 6);

    // Three.js v0.150+ already converts a hex int from sRGB to linear
    // when constructing `new Color(0xef4444)` (the value the user
    // provided is the conventional sRGB hex; the renderer's sRGB output
    // pipeline then re-encodes for display, so we end up with the
    // intended color). Calling `convertSRGBToLinear()` on top would
    // double-convert and make the lines visibly darker.
    const c = new Color(typeof ln.color === "number" ? ln.color : 0x1e293b);
    colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
  }

  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setAttribute("color", new Float32BufferAttribute(colors, 3));

  const mat = new LineBasicMaterial({
    vertexColors: true,
    linewidth: 1,
  });

  const obj = new LineSegments(geom, mat);
  obj.name = "cartoon-aux-lines";
  scene.add(obj);
  return obj;
}
