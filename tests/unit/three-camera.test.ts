/**
 * Tests for the P3b camera follow + mesh highlight helpers.
 *
 * The helpers are pure functions of (camera / scene, target / name), so
 * we can drive them in a vitest run without a WebGL context.
 */

import { describe, it, expect } from "vitest";
import {
  PerspectiveCamera,
  Scene,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  Vector3,
} from "three";
import {
  tweenCameraTo,
  highlightMesh,
  __INTERNAL,
} from "@/lib/three-camera";

function makeMesh(name: string): Mesh {
  const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  m.name = name;
  return m;
}

describe("tweenCameraTo", () => {
  it("moves the camera a fraction of the way toward the target each call", () => {
    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 0);
    tweenCameraTo(cam, [10, 0, 0], 0.5);
    expect(cam.position.x).toBeCloseTo(5, 5);
    expect(cam.position.y).toBeCloseTo(0, 5);
    expect(cam.position.z).toBeCloseTo(0, 5);
  });

  it("calls lookAt with the optional lookAt point", () => {
    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 0);
    tweenCameraTo(cam, [0, 0, 0], 0.1, [3, 4, 5]);
    // After tween, camera looks toward (3, 4, 5).
    const forward = new Vector3(3, 4, 5).normalize();
    const camForward = new Vector3();
    cam.getWorldDirection(camForward);
    expect(camForward.x).toBeCloseTo(forward.x, 4);
    expect(camForward.y).toBeCloseTo(forward.y, 4);
    expect(camForward.z).toBeCloseTo(forward.z, 4);
  });

  it("converges to the target after many iterations (geometric decay)", () => {
    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 0);
    const target: [number, number, number] = [10, 0, 0];
    for (let i = 0; i < 200; i++) {
      tweenCameraTo(cam, target, 0.1);
    }
    // After 200 steps at alpha=0.1, distance should be < 0.001
    expect(Math.abs(cam.position.x - target[0])).toBeLessThan(0.001);
  });

  it("is a no-op when alpha is 0 (host can disable tween per-frame)", () => {
    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 0);
    tweenCameraTo(cam, [10, 0, 0], 0);
    expect(cam.position.x).toBe(0);
  });
});

describe("highlightMesh", () => {
  it("sets the emissive on the named mesh and clears the previous one", () => {
    const scene = new Scene();
    const a = makeMesh("a");
    const b = makeMesh("b");
    scene.add(a, b);

    highlightMesh(scene, "a", undefined);
    expect((a.material as MeshStandardMaterial).emissive.getHex()).toBe(
      __INTERNAL.HIGHLIGHT_COLOR,
    );
    expect((a.material as MeshStandardMaterial).emissiveIntensity).toBe(
      __INTERNAL.HIGHLIGHT_INTENSITY,
    );
    expect((b.material as MeshStandardMaterial).emissive.getHex()).toBe(0x000000);

    // Switch from a → b
    highlightMesh(scene, "b", "a");
    expect((a.material as MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
    expect((b.material as MeshStandardMaterial).emissive.getHex()).toBe(
      __INTERNAL.HIGHLIGHT_COLOR,
    );
  });

  it("returns false when name does not change (caller can debounce side effects)", () => {
    const scene = new Scene();
    const a = makeMesh("a");
    scene.add(a);

    expect(highlightMesh(scene, "a", undefined)).toBe(true);
    expect(highlightMesh(scene, "a", "a")).toBe(false);
  });

  it("clears the previous highlight when nextName is undefined", () => {
    const scene = new Scene();
    const a = makeMesh("a");
    scene.add(a);

    highlightMesh(scene, "a", undefined);
    expect((a.material as MeshStandardMaterial).emissive.getHex()).toBe(
      __INTERNAL.HIGHLIGHT_COLOR,
    );

    highlightMesh(scene, undefined, "a");
    expect((a.material as MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
  });

  it("does nothing when neither name resolves to a mesh in the scene", () => {
    const scene = new Scene();
    scene.add(makeMesh("a"));
    // No crash, no change.
    expect(() => highlightMesh(scene, "nope", undefined)).not.toThrow();
    expect(highlightMesh(scene, "nope", "alsonope")).toBe(true);
  });
});
