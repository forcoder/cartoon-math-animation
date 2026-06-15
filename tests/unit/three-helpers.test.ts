/**
 * Tests for camera fit-to-scene and view preset helpers.
 *
 * Why these tests exist:
 *   The user reported that toggling the "top" / "side" view buttons did
 *   nothing — root cause was the LLM-generated function never read the
 *   `view` argument, so the camera stayed put on every re-mount. We now
 *   ship a `fitCameraToScene` helper that the LLM prompt can reference,
 *   plus corrected VIEW_PRESETS (default = horizontal, not 45° overhead).
 *   These tests pin those contracts so they don't silently regress.
 */

import { describe, it, expect } from "vitest";
import {
  Scene,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import {
  VIEW_PRESETS,
  FIT_PADDING,
  fitCameraToScene,
  computeSceneBoundingBox,
  type ViewName,
} from "@/lib/three-helpers";

function makeBoxAt(x: number, y: number, z: number, size = 1): Mesh {
  const geom = new BoxGeometry(size, size, size);
  const mesh = new Mesh(geom, new MeshBasicMaterial());
  mesh.position.set(x, y, z);
  return mesh;
}

function makeCamera(): PerspectiveCamera {
  return new PerspectiveCamera(50, 16 / 9, 0.1, 1000);
}

describe("VIEW_PRESETS", () => {
  it("has the three required view keys", () => {
    const keys = Object.keys(VIEW_PRESETS).sort();
    expect(keys).toEqual(["default", "side", "top"]);
  });

  it("default view is HORIZONTAL (low y, not overhead)", () => {
    // Regression guard: original default was [5, 5, 8] (45° overhead).
    // The user explicitly asked for a horizontal eye-level default.
    const pos = VIEW_PRESETS.default.cameraPosition;
    expect(pos[1]).toBeLessThan(2);
  });

  it("default, top, and side view DIRECTIONS are all distinct", () => {
    // The fit-to-scene logic relies on each preset pointing along a
    // different axis. If two presets collide, the view switch becomes
    // a no-op (the exact bug the user reported).
    const d = VIEW_PRESETS.default.cameraPosition;
    const t = VIEW_PRESETS.top.cameraPosition;
    const s = VIEW_PRESETS.side.cameraPosition;
    expect(d.join(",")).not.toBe(t.join(","));
    expect(d.join(",")).not.toBe(s.join(","));
    expect(t.join(",")).not.toBe(s.join(","));
  });

  it("top view points along +y (camera above scene)", () => {
    const [x, y, z] = VIEW_PRESETS.top.cameraPosition;
    expect(Math.abs(x)).toBeLessThan(0.5);
    expect(y).toBeGreaterThan(1);
    expect(Math.abs(z)).toBeLessThan(0.5);
  });

  it("side view points along +x (camera to the right of scene)", () => {
    const [x, y, z] = VIEW_PRESETS.side.cameraPosition;
    expect(x).toBeGreaterThan(1);
    expect(Math.abs(y)).toBeLessThan(0.5);
    expect(Math.abs(z)).toBeLessThan(0.5);
  });
});

describe("computeSceneBoundingBox", () => {
  it("returns null for an empty scene (no geometry to frame)", () => {
    const scene = new Scene();
    expect(computeSceneBoundingBox(scene)).toBeNull();
  });

  it("frames a single box at the origin", () => {
    const scene = new Scene();
    const box = makeBoxAt(0, 0, 0, 2); // 2×2×2 box
    scene.add(box);
    scene.updateMatrixWorld(true);
    const bbox = computeSceneBoundingBox(scene);
    expect(bbox).not.toBeNull();
    expect(bbox!.min.x).toBeCloseTo(-1, 5);
    expect(bbox!.max.x).toBeCloseTo(1, 5);
  });

  it("frames BOTH objects even when they are far apart", () => {
    // This is the original bug shape: two cars 6 units apart got cropped
    // at view='side' because the bbox was never computed.
    const scene = new Scene();
    scene.add(makeBoxAt(-3, 0, 0, 0.8));
    scene.add(makeBoxAt(3, 0, 0, 0.8));
    scene.updateMatrixWorld(true);
    const bbox = computeSceneBoundingBox(scene);
    expect(bbox).not.toBeNull();
    expect(bbox!.min.x).toBeLessThan(-3);
    expect(bbox!.max.x).toBeGreaterThan(3);
  });
});

describe("fitCameraToScene", () => {
  it("returns the camera to the preset position when scene is empty", () => {
    const scene = new Scene();
    const camera = makeCamera();
    fitCameraToScene(scene, camera, "default");
    expect(camera.position.toArray()).toEqual(
      new Vector3(...VIEW_PRESETS.default.cameraPosition).toArray()
    );
  });

  it("places the default-view camera in front of the bbox center (horizontal)", () => {
    const scene = new Scene();
    scene.add(makeBoxAt(0, 0, 0, 2));
    scene.updateMatrixWorld(true);
    const camera = makeCamera();
    fitCameraToScene(scene, camera, "default");
    // y should be small (horizontal), z should be positive (looking from +z)
    expect(camera.position.y).toBeLessThan(2);
    expect(camera.position.z).toBeGreaterThan(0);
  });

  it("places the top-view camera above the bbox center", () => {
    const scene = new Scene();
    scene.add(makeBoxAt(0, 0, 0, 2));
    scene.updateMatrixWorld(true);
    const camera = makeCamera();
    fitCameraToScene(scene, camera, "top");
    expect(camera.position.y).toBeGreaterThan(camera.position.x);
    expect(camera.position.y).toBeGreaterThan(Math.abs(camera.position.z));
  });

  it("places the side-view camera on the +x side of the bbox center", () => {
    const scene = new Scene();
    scene.add(makeBoxAt(0, 0, 0, 2));
    scene.updateMatrixWorld(true);
    const camera = makeCamera();
    fitCameraToScene(scene, camera, "side");
    expect(camera.position.x).toBeGreaterThan(camera.position.y);
    expect(camera.position.x).toBeGreaterThan(Math.abs(camera.position.z));
  });

  it("frames BOTH far-apart objects (the original bug)", () => {
    // Two boxes 6 units apart on the x axis. The view='side' should
    // pull the camera back far enough that both are inside the frustum.
    const scene = new Scene();
    scene.add(makeBoxAt(-3, 0, 0, 0.8));
    scene.add(makeBoxAt(3, 0, 0, 0.8));
    scene.updateMatrixWorld(true);
    const camera = makeCamera();
    fitCameraToScene(scene, camera, "side");

    // bbox spans from x ≈ -3.4 to x ≈ 3.4, so the diagonal is ≥ 6.8.
    // With padding 1.4 the camera should be at least 3.4 units from origin.
    expect(camera.position.length()).toBeGreaterThan(3);
  });

  it("honors the padding factor (camera is FURTHER with more padding)", () => {
    const scene = new Scene();
    scene.add(makeBoxAt(0, 0, 0, 2));
    scene.updateMatrixWorld(true);

    const camTight = makeCamera();
    fitCameraToScene(scene, camTight, "default", 1.0);
    const camPadded = makeCamera();
    fitCameraToScene(scene, camPadded, "default", 2.0);

    expect(camPadded.position.length()).toBeGreaterThan(camTight.position.length());
  });

  it("FIT_PADDING defaults to a value > 1 (gives the scene some breathing room)", () => {
    // Sanity check on the exported constant — if someone sets this to 1.0
    // the bbox will kiss the frustum edge, defeating the purpose.
    expect(FIT_PADDING).toBeGreaterThan(1);
  });
});

describe("ViewName type", () => {
  it("includes default, top, and side as the only legal values", () => {
    // Compile-time check via a const-asserted tuple cast.
    const allowed: ViewName[] = ["default", "top", "side"];
    expect(new Set(allowed)).toEqual(new Set(Object.keys(VIEW_PRESETS)));
  });
});
