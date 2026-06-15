/**
 * Tests for the 3D text Sprite factory used by P2 labels.
 *
 * jsdom doesn't ship a real 2D canvas implementation, so we stub
 * `document.createElement` to return an object with a no-op 2D context.
 * That lets the function under test run end-to-end without throwing;
 * the visual result is irrelevant — we're testing the Sprite structure,
 * the texture wiring, and the scale / position math.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Sprite, CanvasTexture, Vector3, CanvasTexture as CT, SpriteMaterial, LinearFilter, Sprite as S } from "three";
import {
  makeTextSprite,
  placeLabelForLine,
  disposeTextSprite,
} from "@/lib/three-text";

// Build a fake THREE namespace from individual named imports. The
// production call site passes `await import('three')` (the module
// object), and our helper reads `THREE.Vector3` etc. off of it. In
// the test, we synth the same shape from named imports so the helper
// can be exercised without bringing all of three into the test bundle
// at the top level.
const THREE = {
  Vector3,
  CanvasTexture: CT,
  SpriteMaterial,
  Sprite: S,
  LinearFilter,
} as const;

/** Install a jsdom-friendly fake canvas context. */
function installFakeCanvas(): void {
  const ctxStub = {
    clearRect: () => {},
    fillText: () => {},
    // Properties read by makeTextSprite
    font: "",
    fillStyle: "",
    textAlign: "",
    textBaseline: "",
  };
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (String(tag).toLowerCase() === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ctxStub,
      } as unknown as HTMLCanvasElement;
    }
    return originalCreate(tag);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  installFakeCanvas();
});

describe("makeTextSprite", () => {
  it("returns a Three.js Sprite with a CanvasTexture", () => {
    const s = makeTextSprite(THREE, "4cm");
    expect(s).toBeInstanceOf(Sprite);
    expect(s.material.map).toBeInstanceOf(CanvasTexture);
  });

  it("uses the supplied color (or slate-800 as default)", () => {
    const sDefault = makeTextSprite(THREE, "x");
    expect(sDefault.material.color.getHex()).toBe(0x1e293b);

    const sRed = makeTextSprite(THREE, "x", { color: 0xef4444 });
    expect(sRed.material.color.getHex()).toBe(0xef4444);
  });

  it("treats empty input as a single space so the call site can ignore nulls", () => {
    expect(() => makeTextSprite(THREE, "")).not.toThrow();
    expect(() => makeTextSprite(THREE, "")).not.toThrow();
  });

  it("honors a custom world scale", () => {
    const s = makeTextSprite(THREE, "4cm", { scale: [3.0, 0.8] });
    expect(s.scale.x).toBeCloseTo(3.0 / 0.85, 5);
    expect(s.scale.y).toBeCloseTo(0.8 / 0.85, 5);
  });
});

describe("placeLabelForLine", () => {
  it("positions the sprite at the midpoint of the line, with the offset", () => {
    // The test framework's three import is sometimes a CJS proxy that
    // re-exports constructors as namespace objects. Use a fresh local
    // Vector3 constructor so the test isn't subject to interop quirks.
    const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const s = makeTextSprite(THREE, "4cm");
    s.position.set(v3(0, 0, 0).x, 0, 0);
    placeLabelForLine(
      THREE,
      s,
      [-2, 0, 0],
      [2, 0, 0],
      [0, 0.5, 0],
    );
    expect(s.position.x).toBeCloseTo(0, 5);
    expect(s.position.y).toBeCloseTo(0.5, 5);
    expect(s.position.z).toBeCloseTo(0, 5);
  });

  it("uses a default Y offset of 0.4 (so labels don't get occluded by their own line)", () => {
    // The default offset is non-zero on purpose: a label placed at the
    // line's midpoint with y=0 would render directly ON the line and
    // become hard to read. 0.4 lifts it above.
    const s = makeTextSprite(THREE, "4cm");
    placeLabelForLine(THREE, s, [0, 0, 0], [4, 0, 0]);
    expect(s.position.x).toBeCloseTo(2, 5);
    expect(s.position.y).toBeCloseTo(0.4, 5);
  });

  it("returns the same sprite (so callers can chain)", () => {
    const s = makeTextSprite(THREE, "x");
    const result = placeLabelForLine(THREE, s, [0, 0, 0], [1, 1, 1]);
    expect(result).toBe(s);
  });
});

describe("disposeTextSprite", () => {
  it("disposes the texture and the material", () => {
    const s = makeTextSprite(THREE, "4cm");
    const map = s.material.map as CanvasTexture;
    const mapDisposeSpy = vi.spyOn(map, "dispose");
    const matDisposeSpy = vi.spyOn(s.material, "dispose");
    disposeTextSprite(THREE, s);
    expect(mapDisposeSpy).toHaveBeenCalled();
    expect(matDisposeSpy).toHaveBeenCalled();
  });

  it("is safe to call when the sprite has no map", () => {
    const s = makeTextSprite(THREE, "4cm");
    s.material.map = null;
    expect(() => disposeTextSprite(THREE, s)).not.toThrow();
  });
});
