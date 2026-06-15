/**
 * Render Chinese (or any Unicode) text as a Three.js Sprite.
 *
 * Why a CanvasTexture + Sprite instead of a 3D text mesh:
 *   - Three.js's TextGeometry requires loading a font JSON (typicons,
 *     helvetiker, etc.) and doesn't ship a CJK font. We need Chinese.
 *   - A 2D-canvas-rendered texture is language-agnostic — the browser's
 *     default sans-serif font picks up the system Chinese fallback
 *     (PingFang on macOS, Microsoft YaHei on Windows, Noto Sans CJK on
 *     Linux). One approach, every language.
 *   - Sprites always face the camera, so labels stay readable from any
 *     view direction — no manual billboard math.
 *
 * Why not embed a Chinese font (we considered it in design):
 *   - Even a subset CJK font is 1-3 MB. That's a huge first-paint
 *     cost for a kids' tool. The browser already has a Chinese font;
 *   - letting it use that keeps the bundle small and the canvas fluid.
 *   - Trade-off: visual style depends on the user's OS. We accept it
 *     (decision logged 2026-06-15) — children are used to the OS they
 *     use, and consistency across problems matters more than
 *     brand-perfect typography.
 *
 * Why we take `THREE` as a parameter (and don't import it at the top):
 *   This file is consumed by `lib/worker-bridge.ts`, which is shared
 *   between the server-side route and the client-side AnimationCanvas.
 *   A top-level `import * as THREE from 'three'` would pull the entire
 *   ~170 kB Three.js bundle into the initial page JS (we hit this exact
 *   regression on 2026-06-15: route size jumped 4.99 kB → 172 kB).
 *   Instead, worker-bridge already does `await import('three')` once,
 *   and threads the resolved module through to us. Zero new imports.
 */

import type {
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
type ThreeModule = typeof import("three");

const DEFAULT_CANVAS_WIDTH = 512;
const DEFAULT_CANVAS_HEIGHT = 128;
const DEFAULT_FONT = 'bold 72px "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif';
const DEFAULT_SCALE_X = 2.4;
const DEFAULT_SCALE_Y = 0.6;
const TEXT_PADDING = 0.85;

export function makeTextSprite(
  THREE: ThreeModule,
  text: string,
  options: {
    color?: number;
    scale?: [number, number];
  } = {},
): Sprite {
  if (!text || text.length === 0) {
    text = " ";
  }
  const colorHex = options.color ?? 0x1e293b;
  const [scaleX, scaleY] = options.scale ?? [DEFAULT_SCALE_X, DEFAULT_SCALE_Y];

  const canvas = document.createElement("canvas");
  canvas.width = DEFAULT_CANVAS_WIDTH;
  canvas.height = DEFAULT_CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: colorHex,
        transparent: true,
      }),
    );
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = DEFAULT_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cssColor = "#" + colorHex.toString(16).padStart(6, "0");
  ctx.fillStyle = cssColor;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.userData = { canvasWidth: canvas.width, canvasHeight: canvas.height };

  const material = new THREE.SpriteMaterial({
    map: texture,
    color: colorHex,
    transparent: true,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scaleX / TEXT_PADDING, scaleY / TEXT_PADDING, 1);
  return sprite;
}

/**
 * Place a text sprite near the midpoint of a line, offset upward so
 * the label sits on top of (not on) the line.
 */
export function placeLabelForLine(
  THREE: ThreeModule,
  sprite: Sprite,
  from: [number, number, number],
  to: [number, number, number],
  offset: [number, number, number] = [0, 0.4, 0],
): Sprite {
  const mid = new THREE.Vector3(
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  );
  sprite.position.set(
    mid.x + offset[0],
    mid.y + offset[1],
    mid.z + offset[2],
  );
  return sprite;
}

/** Dispose the GPU resources owned by a sprite created via `makeTextSprite`. */
export function disposeTextSprite(THREE: ThreeModule, sprite: Sprite): void {
  const mat = sprite.material as SpriteMaterial;
  if (mat.map) mat.map.dispose();
  mat.dispose();
}
