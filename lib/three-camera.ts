/**
 * Camera follow + mesh focus helpers used by P3b.
 *
 * The user reported wanting "跟随相机 + 步骤高亮" (camera follow +
 * step highlight). We implement both, but in a deliberately small way
 * to avoid the LLM getting confused:
 *
 *   - `tweenCameraTo(camera, target, alpha)` — exponential-decay lerp
 *     toward a world-space target. Called every rAF frame so the
 *     camera glides rather than snaps when the active step changes.
 *
 *   - `highlightMesh(scene, meshName, prevMeshName, color)` — find a
 *     mesh by name and swap its emissive on / off. We don't *clone*
 *     materials (too expensive for a kids' tool); we mutate in place
 *     and remember the original emissive so we can restore it.
 *
 * Both helpers are pure functions of (camera, scene, target / name) —
 * no hidden state — so the LLM function can drive them however it
 * wants and we can test them in isolation.
 */

import {
  PerspectiveCamera,
  Scene,
  Color,
  Mesh,
  MeshStandardMaterial,
} from "three";

const HIGHLIGHT_COLOR = 0xfacc15; // amber-400 — visible on most scene bgs
const HIGHLIGHT_INTENSITY = 0.6;
const TWEEN_ALPHA_DEFAULT = 0.06; // ~ 1 sec time-constant at 60fps

/**
 * Move the camera one step closer to `target` (world-space). Designed
 * to be called every animation frame from the host-side rAF loop so
 * the camera glides rather than snaps. We damp via exponential decay:
 *
 *   pos = pos + (target - pos) * alpha
 *
 * which converges geometrically — the half-life of the distance is
 * roughly -log(0.5) / log(1 - alpha) frames.
 */
export function tweenCameraTo(
  camera: PerspectiveCamera,
  target: [number, number, number],
  alpha: number = TWEEN_ALPHA_DEFAULT,
  lookAt: [number, number, number] = [0, 0, 0],
): void {
  if (alpha <= 0) return; // disabled — leave camera alone
  // Cap alpha to (0, 1] so we never overshoot or divide by zero.
  const a = Math.max(0.01, Math.min(1, alpha));
  camera.position.x += (target[0] - camera.position.x) * a;
  camera.position.y += (target[1] - camera.position.y) * a;
  camera.position.z += (target[2] - camera.position.z) * a;
  camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
}

/**
 * Move the highlight from `prevName` to `nextName` by toggling each
 * mesh's emissive. Returns true if the highlight actually changed
 * (caller can debounce side-effects on false).
 *
 * We mutate MeshStandardMaterial.emissive in place because cloning
 * would be wasteful and a child could add its own behavior to a
 * shared material. If the mesh uses MeshBasicMaterial (no emissive
 * field) we silently skip it — those don't participate in highlighting.
 */
export function highlightMesh(
  scene: Scene,
  nextName: string | undefined,
  prevName: string | undefined,
): boolean {
  if (nextName === prevName) return false;

  if (prevName) {
    const prev = scene.getObjectByName(prevName) as Mesh | undefined;
    if (prev && (prev.material as MeshStandardMaterial).emissive) {
      (prev.material as MeshStandardMaterial).emissive.setHex(0x000000);
      (prev.material as MeshStandardMaterial).emissiveIntensity = 0;
    }
  }
  if (nextName) {
    const next = scene.getObjectByName(nextName) as Mesh | undefined;
    if (next && (next.material as MeshStandardMaterial).emissive) {
      (next.material as MeshStandardMaterial).emissive.setHex(HIGHLIGHT_COLOR);
      (next.material as MeshStandardMaterial).emissiveIntensity = HIGHLIGHT_INTENSITY;
    }
  }
  return nextName !== prevName;
}

/** Exposed for tests; do not import from app code. */
export const __INTERNAL = { HIGHLIGHT_COLOR, HIGHLIGHT_INTENSITY, TWEEN_ALPHA_DEFAULT };
