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
 */

import {
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  Vector3,
  LinearFilter,
} from "three";

const DEFAULT_CANVAS_WIDTH = 512;
const DEFAULT_CANVAS_HEIGHT = 128;
const DEFAULT_FONT = 'bold 72px "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif';
const DEFAULT_SCALE_X = 2.4;   // world units (matches roughly a stick length on the 0.3-1.5 scale)
const DEFAULT_SCALE_Y = 0.6;
const TEXT_PADDING = 0.85;     // bake some margin around the text so antialiasing doesn't clip

/**
 * Build a Sprite whose texture is the given text rendered with the
 * browser's default font stack (which includes CJK fallbacks).
 *
 * The Sprite is sized in WORLD units (scale.x / scale.y) so it scales
 * naturally with the scene and the fit-to-scene camera will pull the
 * camera back to keep the label visible.
 */
export function makeTextSprite(
  text: string,
  options: {
    color?: number;
    scale?: [number, number];
  } = {},
): Sprite {
  if (!text || text.length === 0) {
    // Caller can guard; we still produce something so the call site
    // doesn't need a separate null check.
    text = " ";
  }
  const colorHex = options.color ?? 0x1e293b;
  const [scaleX, scaleY] = options.scale ?? [DEFAULT_SCALE_X, DEFAULT_SCALE_Y];

  const canvas = document.createElement("canvas");
  canvas.width = DEFAULT_CANVAS_WIDTH;
  canvas.height = DEFAULT_CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // SSR or canvas-blocked environment. The Sprite will be a blank
    // texture — caller will see no text. Better than throwing, since
    // the Worker validation has already passed and we're committed to
    // mounting.
    return new Sprite(
      new SpriteMaterial({
        color: colorHex,
        transparent: true,
      }),
    );
  }

  // Solid rounded background pill so the text is readable on top of
  // any scene background. The pill color is derived from the text
  // color so each call site gets a consistent look.
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Render the text centered, padded so antialiasing doesn't clip the
  // edges.  ctx.font uses the browser's CJK fallback chain.
  ctx.font = DEFAULT_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cssColor = "#" + colorHex.toString(16).padStart(6, "0");
  ctx.fillStyle = cssColor;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new CanvasTexture(canvas);
  // Pixelated scaling on a 512x128 texture is bad when the camera
  // pulls in. LinearFilter keeps the edges smooth at any distance.
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  // We computed the size in world units; tell Three.js the canvas
  // dimensions so the sprite's intrinsic UVs match what we drew.
  texture.userData = { canvasWidth: canvas.width, canvasHeight: canvas.height };

  const material = new SpriteMaterial({
    map: texture,
    color: colorHex,
    transparent: true,
    depthTest: true,
  });
  const sprite = new Sprite(material);
  // Adjust scale so the world-size matches scaleX × scaleY, with
  // TEXT_PADDING baked in so the rendered text doesn't kiss the
  // sprite's edge.
  sprite.scale.set(scaleX / TEXT_PADDING, scaleY / TEXT_PADDING, 1);
  return sprite;
}

/**
 * Place a text sprite near the midpoint of a line, offset upward so
 * the label sits on top of (not on) the line.
 *
 * Returns the sprite so the caller can dispose() it on unmount.
 */
export function placeLabelForLine(
  sprite: Sprite,
  from: [number, number, number],
  to: [number, number, number],
  offset: [number, number, number] = [0, 0.4, 0],
): Sprite {
  const mid = new Vector3(
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

/**
 * Dispose the GPU resources owned by a sprite created via
 * `makeTextSprite`. Safe to call multiple times.
 */
export function disposeTextSprite(sprite: Sprite): void {
  const mat = sprite.material as SpriteMaterial;
  if (mat.map) mat.map.dispose();
  mat.dispose();
}
