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
import { Sprite, CanvasTexture, Vector3 } from "three";
import {
  makeTextSprite,
  placeLabelForLine,
  disposeTextSprite,
} from "@/lib/three-text";

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
    const s = makeTextSprite("4cm");
    expect(s).toBeInstanceOf(Sprite);
    expect(s.material.map).toBeInstanceOf(CanvasTexture);
  });

  it("uses the supplied color (or slate-800 as default)", () => {
    const sDefault = makeTextSprite("x");
    expect(sDefault.material.color.getHex()).toBe(0x1e293b);

    const sRed = makeTextSprite("x", { color: 0xef4444 });
    expect(sRed.material.color.getHex()).toBe(0xef4444);
  });

  it("treats empty input as a single space so the call site can ignore nulls", () => {
    expect(() => makeTextSprite("")).not.toThrow();
    expect(() => makeTextSprite("")).not.toThrow();
  });

  it("honors a custom world scale", () => {
    const s = makeTextSprite("4cm", { scale: [3.0, 0.8] });
    expect(s.scale.x).toBeCloseTo(3.0 / 0.85, 5);
    expect(s.scale.y).toBeCloseTo(0.8 / 0.85, 5);
  });
});

describe("placeLabelForLine", () => {
  it("positions the sprite at the midpoint of the line, with the offset", () => {
    const s = makeTextSprite("4cm");
    placeLabelForLine(
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
    const s = makeTextSprite("4cm");
    placeLabelForLine(s, [0, 0, 0], [4, 0, 0]);
    expect(s.position.x).toBeCloseTo(2, 5);
    expect(s.position.y).toBeCloseTo(0.4, 5);
  });

  it("returns the same sprite (so callers can chain)", () => {
    const s = makeTextSprite("x");
    const result = placeLabelForLine(s, [0, 0, 0], [1, 1, 1]);
    expect(result).toBe(s);
  });
});

describe("disposeTextSprite", () => {
  it("disposes the texture and the material", () => {
    const s = makeTextSprite("4cm");
    const map = s.material.map as CanvasTexture;
    const mapDisposeSpy = vi.spyOn(map, "dispose");
    const matDisposeSpy = vi.spyOn(s.material, "dispose");
    disposeTextSprite(s);
    expect(mapDisposeSpy).toHaveBeenCalled();
    expect(matDisposeSpy).toHaveBeenCalled();
  });

  it("is safe to call when the sprite has no map", () => {
    const s = makeTextSprite("4cm");
    s.material.map = null;
    expect(() => disposeTextSprite(s)).not.toThrow();
  });
});
