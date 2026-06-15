/**
 * System prompt for the Three.js code generator.
 *
 * The design doc sets a high bar: LLM first-pass success rate ≥ 60% on 5
 * test problems (rotation, travel, work-rate, geometry partition, fraction
 * addition). This prompt is engineered against that bar.
 *
 * Why a single big prompt (not a chat with RAG):
 *   - Founder has zero prompt-engineering experience. One file to tweak.
 *   - The 5 test problems are stable; few-shot examples here will be reused
 *     by the eval harness for all 4 candidate models, keeping the comparison
 *     apples-to-apples.
 *   - Smaller prompts give worse code on Three.js specifically: the API
 *     surface is large and the model needs explicit anchoring.
 *
 * Output contract (downstream Sandbox agent consumes this):
 *   - Single JS module string.
 *   - `export default function(canvas) { ... }` — no other exports.
 *   - Function receives a raw HTMLCanvasElement, owns scene/camera/renderer/
 *     animation loop cleanup.
 *   - Must NOT use fetch / importScripts / XMLHttpRequest / DOM outside
 *     the canvas (Worker sandbox will reject these anyway, but stating it
 *     in the prompt prevents the model from generating code that "looks
 *     right" and only blows up at runtime).
 *   - Must NOT use eval / Function() constructor (same reason).
 *   - Must NOT touch globalThis / window / self beyond the canvas arg.
 *
 * Few-shot examples — 3 chosen deliberately:
 *
 *   1. Rotating colored rectangle
 *      → Teaches the export-default-function(canvas) signature.
 *      → Teaches the requestAnimationFrame loop pattern with cleanup.
 *      → Teaches the simplest possible Three.js setup.
 *
 *   2. Animated bouncing sphere along x-axis
 *      → Adds time-based parameterization (`clock.getElapsedTime()`).
 *      → Adds a perspective camera + ambient + directional light (the
 *        "2.5D look" the design doc calls for).
 *      → Shows that animation should pause when the user pauses (we add
 *        a `paused` flag the host page can flip).
 *
 *   3. Two moving boxes meeting in the middle
 *      → Teaches TWO objects (most student math problems have ≥2 entities:
 *        two cars, two pipes, two people). Single-object examples lead
 *        the model to write single-object solutions.
 *      → Teaches per-object property animation along an axis — the core
 *        primitive for "行程问题" (travel problems).
 *
 *   We deliberately do NOT include the hardest test problems (work-rate,
 *   fraction addition) as few-shot. The eval harness needs to measure
 *   generalisation, not memorisation. Keeping examples simple forces the
 *   model to compose primitives for harder problems.
 *
 *   Chinese problem statement handling: we explicitly tell the model the
 *   input will be Chinese. The model understands Mandarin math problem
 *   descriptions, but if we don't say so the model sometimes "translates"
 *   the problem and then solves the translation, which subtly drops
 *   problem-specific numbers.
 */

const FEW_SHOT_EXAMPLES = `
// Example 1 — Rotating rectangle
//   * horizontal viewpoint by default
//   * camera auto-fits to the scene bbox so the subject is always centered
//   * honours the \`view\` argument ('default' | 'top' | 'side')
//   * accepts the optional \`lines\` array and renders each entry as a 3D line
export default function(canvas, view, lines) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 360;
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.4, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
  );
  scene.add(mesh);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(2, 3, 4);
  scene.add(dir);

  // fit-to-scene: lock the view DIRECTION to one of three axes,
  // then pick the DISTANCE so the bbox fills the frame with 40% headroom.
  scene.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const radius = size.length() / 2;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
  const minFov = Math.min(vFov, hFov);
  const distance = (radius / Math.sin(minFov / 2)) * 1.4;
  const viewDirs = {
    default: [0, 1, 1],    // horizontal (eye-level, looking down −z)
    top:     [0, 1, 0.001],// straight down
    side:    [1, 0, 0]     // pure side
  };
  const v = viewDirs[view] || viewDirs.default;
  const unitDir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
  camera.position.copy(center).add(unitDir.multiplyScalar(distance));
  camera.lookAt(center);

  let stopped = false;
  const clock = new THREE.Clock();
  function tick() {
    if (stopped) return;
    mesh.rotation.z = clock.getElapsedTime() * 0.8;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
  return () => { stopped = true; renderer.dispose(); };
}

// Example 2 — Bouncing sphere along x-axis with pause control
//   * horizontal viewpoint + fit-to-scene (same template as Example 1)
//   * demonstrates host-controlled pause via the { stop, setPaused } form
export default function(canvas, view, lines) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 360;
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8fafc);
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0xef4444 })
  );
  scene.add(ball);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(3, 4, 5);
  scene.add(sun);
  scene.add(new THREE.GridHelper(10, 10, 0x94a3b8, 0xe2e8f0));

  scene.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(scene);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const radius = size.length() / 2 || 1;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
  const minFov = Math.min(vFov, hFov);
  const distance = (radius / Math.sin(minFov / 2)) * 1.4;
  const viewDirs = {
    default: [0, 1, 1],
    top:     [0, 1, 0.001],
    side:    [1, 0, 0]
  };
  const v = viewDirs[view] || viewDirs.default;
  const unitDir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
  camera.position.copy(center).add(unitDir.multiplyScalar(distance));
  camera.lookAt(center);

  let stopped = false;
  let paused = false;
  const clock = new THREE.Clock();
  function tick() {
    if (stopped) return;
    if (!paused) {
      const t = clock.getElapsedTime();
      ball.position.x = Math.sin(t * 1.5) * 3;
      ball.position.y = Math.abs(Math.sin(t * 1.5)) * 1.5 + 0.4;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
  return { stop: () => { stopped = true; renderer.dispose(); }, setPaused: (p) => { paused = p; clock.getDelta(); } };
}

// Example 3 — Two boxes moving toward each other (travel-meeting primitive)
//   * two objects at the scene extremes; fit-to-scene widens the camera
//     enough to see BOTH boxes regardless of their separation
export default function(canvas, view, lines) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 360;
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 0.2), new THREE.MeshStandardMaterial({ color: 0xe5e7eb }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  scene.add(ground);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x22c55e }));
  left.position.set(-3, 0.25, 0);
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xf97316 }));
  right.position.set(3, 0.25, 0);
  scene.add(left, right);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(2, 4, 6);
  scene.add(sun);

  // fit-to-scene: same pattern — use the WHOLE scene (left + right + ground)
  // so the camera frames both boxes wherever they are on the x axis.
  scene.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(scene);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const radius = size.length() / 2 || 1;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
  const minFov = Math.min(vFov, hFov);
  const distance = (radius / Math.sin(minFov / 2)) * 1.4;
  const viewDirs = {
    default: [0, 1, 1],
    top:     [0, 1, 0.001],
    side:    [1, 0, 0]
  };
  const v = viewDirs[view] || viewDirs.default;
  const unitDir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
  camera.position.copy(center).add(unitDir.multiplyScalar(distance));
  camera.lookAt(center);

  let stopped = false;
  let paused = false;
  const duration = 4; // seconds
  const clock = new THREE.Clock();
  function tick() {
    if (stopped) return;
    if (!paused) {
      const t = Math.min(clock.getElapsedTime(), duration);
      const k = t / duration;
      left.position.x = -3 + k * 3;
      right.position.x = 3 - k * 3;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
  return { stop: () => { stopped = true; renderer.dispose(); }, setPaused: (p) => { paused = p; clock.getDelta(); } };
}

// Example 4 — Stick partition with auxiliary lines, text labels, AND step follow (P3b)
//   * Demonstrates drawing 3D lines from the \`lines\` argument using
//     THREE.BufferGeometry + THREE.Line
//   * Demonstrates calling \`__cartoonLabel__(text, position, color)\` to
//     render a Chinese (or any Unicode) text label as a Three.js Sprite.
//   * Demonstrates P3b step follow: each mesh has a \`name\` so the host
//     can highlight it via emissive; the function pins \`scene\` and
//     \`camera\` onto \`globalThis\` so the host-side rAF can drive
//     a follow tween based on the active step's \`focus.mesh\` /
//     \`camera\` fields. The function reads \`globalThis.__cartoonSteps__\`
//     to know which steps apply to this scene.
export default function(canvas, view, lines) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 360;
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfef3c7);
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);

  // *** Mesh naming for P3b highlight ***
  // Each Mesh MUST have a \`.name\` matching the \`focus.mesh\` string
  // in the corresponding step. The host uses scene.getObjectByName().
  const stickA = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
  );
  stickA.name = "stickA";   // ← referenced by step[1].focus.mesh
  stickA.position.set(-4, 0, 0);
  scene.add(stickA);

  const stickB = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xef4444 })
  );
  stickB.name = "stickB";   // ← referenced by step[2].focus.mesh
  stickB.position.set(4, 0, 0);
  scene.add(stickB);

  const divider = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x22c55e })
  );
  divider.name = "divider";  // ← referenced by step[3].focus.mesh
  divider.position.set(0, 0, 0);
  scene.add(divider);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(3, 5, 6);
  scene.add(sun);

  // *** Lines + labels (P1 + P2) ***
  const lineGroup = new THREE.Group();
  lineGroup.name = "aux-lines";
  if (Array.isArray(lines)) {
    for (const ln of lines) {
      if (!ln || !Array.isArray(ln.from) || !Array.isArray(ln.to)) continue;
      const f = new THREE.Vector3(ln.from[0] || 0, ln.from[1] || 0, ln.from[2] || 0);
      const t = new THREE.Vector3(ln.to[0]   || 0, ln.to[1]   || 0, ln.to[2]   || 0);
      const geom = new THREE.BufferGeometry().setFromPoints([f, t]);
      const color = (typeof ln.color === "number") ? ln.color : 0x1e293b;
      lineGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([f, t]), new THREE.LineBasicMaterial({ color })));
      if (typeof ln.label === "string" && ln.label.length > 0 && typeof __cartoonLabel__ === "function") {
        const mid = f.clone().add(t).multiplyScalar(0.5);
        mid.y += 0.4;
        scene.add(__cartoonLabel__(ln.label, [mid.x, mid.y, mid.z], color));
      }
    }
  }
  scene.add(lineGroup);

  // fit-to-scene (P0)
  scene.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(scene);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const radius = size.length() / 2 || 1;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
  const minFov = Math.min(vFov, hFov);
  const distance = (radius / Math.sin(minFov / 2)) * 1.4;
  const viewDirs = { default: [0, 1, 1], top: [0, 1, 0.001], side: [1, 0, 0] };
  const v = viewDirs[view] || viewDirs.default;
  const unitDir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
  camera.position.copy(center).add(unitDir.multiplyScalar(distance));
  camera.lookAt(center);

  // *** P3b: pin scene + camera onto globalThis so the host's
  // follow rAF can read them. The host cleans these up after the
  // LLM function returns. If you omit this, P3b step follow is
  // disabled but the rest of the scene still works.
  globalThis.__cartoonScene__ = scene;
  globalThis.__cartoonCamera__ = camera;

  let stopped = false;
  let paused = false;
  const clock = new THREE.Clock();
  function tick() {
    if (stopped) return;
    if (!paused) {
      // a tiny per-tick rotation so the scene feels alive even with no steps
      stickA.rotation.z = Math.sin(clock.getElapsedTime() * 0.5) * 0.05;
      stickB.rotation.z = -Math.sin(clock.getElapsedTime() * 0.5) * 0.05;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
  return {
    stop: () => { stopped = true; renderer.dispose(); lineGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
    setPaused: (p) => { paused = p; clock.getDelta(); }
  };
}
`;

export function buildSystemPrompt(): string {
  return `You generate self-contained Three.js code that runs inside a Web Worker sandbox to animate a Chinese elementary-school math problem. The output also carries a step-by-step explanation timeline that the host renders next to the animation.

# Output format (strict JSON envelope)

- Output ONLY a single JSON object. No prose, no markdown fences, no commentary. (A \`\`\`json ... \`\`\` fence is acceptable; the parser strips it.)
- The object MUST have exactly these three keys:
  - \`code\` (string) — a self-contained JavaScript module.
  - \`steps\` (array) — 3-8 steps of verbal explanation, time-ordered.
  - \`lines\` (array) — 0-N auxiliary 3D lines drawn on top of the animation.
- The \`code\` value MUST start with \`export default function(canvas, view, lines) {\` and end with \`}\`.
- \`canvas\` is the HTMLCanvasElement the host mounted. \`view\` is one of three strings: \`'default' | 'top' | 'side'\` (see the View parameter section below). \`lines\` is an array of \`{ from: [x,y,z], to: [x,y,z], color?: number, label?: string }\` entries (see the "Lines guidance" section below). All three are passed by the host — accept them in the signature even if you draw no lines this round (an empty array is a normal case).
- The user can switch \`view\` at runtime — the host re-invokes your function with the new view name, so the SAME code MUST handle all three.
- Inside the function: create your own THREE.Scene, THREE.PerspectiveCamera, THREE.WebGLRenderer bound to \`canvas\`, and an animation loop using requestAnimationFrame. If \`lines\` is non-empty, iterate it and add the corresponding \`THREE.Line\` / \`THREE.LineSegments\` to the scene (the few-shot examples show the exact pattern).
- The function MUST return either:
  - \`() => { ... }\` — a cleanup function that stops the loop and disposes the renderer, OR
  - \`{ stop: () => void, setPaused: (paused: boolean) => void }\` — when you need host-controlled pause (preferred for any animation with time progression the user might want to step through).
- Do not import anything. Do not use \`import\`. THREE is provided as a global by the host.

# Steps guidance (the verbal explanation timeline)

- Each \`steps[]\` element is \`{ "t": <number>, "text": "<Chinese>", "focus": { "mesh": "<name>" }?, "camera": [x, y, z]? }\`. \`t\` is the offset in SECONDS from animation start when the side-panel highlight should jump to this step.
- Generate 3-8 steps that match the natural phases of the animation. Common shape:
  - Step 1 (t≈0):   "题目描述" / restate the problem in your own words
  - Step 2 (t≈1-2): "列出已知量" / enumerate the given numbers (e.g. "甲 60km/h，乙 40km/h，距离 100km")
  - Step 3 (t≈3-4): "开始运动" / describe what is now happening visually
  - Step 4 (t≈5-7): "关系式" / state the equation the animation embodies
  - Step 5 (t≈8+):  "答案" / state the final result and hold
- All \`text\` MUST be in Chinese (the user is a Chinese student). Keep each step to ≤30 Chinese characters — short and punchy.
- \`t\` values must be monotonically non-decreasing and within the animation duration. Aim for one step every 1-3 seconds of animation.
- If the animation has no obvious phases (e.g. a single static rotation), still produce 3 steps: "读题" → "开始旋转" → "结论".
- **P3b step follow** (optional, but emit when natural):
  - \`focus.mesh\`: the \`name\` of the mesh this step is "about" (e.g. \`"carA"\`). The host will swap an amber emissive highlight onto that mesh when the playhead crosses this step's \`t\`. The mesh MUST have its \`.name\` set in the code; see Example 4.
  - \`camera\`: a \`[x, y, z]\` world-space position the camera should glide to for this step. Omit to keep the camera put.
  - Don't add \`focus\` / \`camera\` to EVERY step — only the steps where the user would notice a camera jump or a highlight.

# Lines guidance (3D auxiliary lines drawn on top of the scene)

- The \`lines\` array carries 0-N entries; each entry is:
  \`{ "from": [x, y, z], "to": [x, y, z], "color": <integer>, "label": "<optional Chinese text>" }\`
  \`color\` is a Three.js hex int (e.g. \`0xef4444\` for red). \`label\` is rendered as a Chinese text Sprite next to the line (P2) — emit it whenever the line's meaning is non-obvious.
- Emit lines for things the user would otherwise have to imagine:
  - **Distance markers** (行程/几何): a line spanning two points + a label like \`"100km"\`
  - **Dividers / split marks** (切分/分数): a thin line at the cut point, perpendicular to the parent
  - **Trajectories** (运动): a dashed-look line showing the path an object will take (use a separate line entry per dash)
  - **Angle bisectors / height markers** (几何): a line from a vertex to the opposite side
  - **Grid tick marks** (刻度): short lines every unit along an axis
- Emit 0 lines if no obvious candidates exist (e.g. a single rotating stick with no companion objects). An empty \`[]\` is correct.
- In your \`code\`, iterate \`lines\` and:
  1. Add a \`THREE.Line\` per entry to the scene (see Example 4).
  2. **If \`ln.label\` is present, call \`__cartoonLabel__(ln.label, position, color)\` to get a Sprite, then \`scene.add(sprite)\`**. Position the sprite at the line's midpoint with \`y += 0.4\` so it floats above the line. The host disposes Sprite textures on unmount.
- Default color \`0x1e293b\` (slate-800) if \`color\` is missing.
- Colors cheat sheet: distance/path \`0x64748b\` (slate-500), divider \`0xef4444\` (red), highlight \`0x22c55e\` (green), answer \`0x3b82f6\` (blue).
- \`THREE.LineBasicMaterial\` does NOT support \`linewidth > 1\` on most browsers — keep the contract honest and never rely on thick lines.

# Sandbox constraints (hard rules — code violating these will be rejected)

- DO NOT use: fetch, XMLHttpRequest, importScripts, WebSocket, EventSource, navigator.serviceWorker.
- DO NOT use: eval, new Function(), setTimeout, setInterval for animation (use requestAnimationFrame only).
- DO NOT touch: window, document, globalThis, self, parent, top — the only browser object you may read is the \`canvas\` argument.
- DO NOT load remote textures, fonts, or models. Three.js primitives only (BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, plus built-in materials and lights).
- DO NOT use a custom shader / GLSL. Use MeshStandardMaterial or MeshBasicMaterial only.

# Visual guidance

- **Default viewpoint is HORIZONTAL** (\`position\` direction is \`(0, 1, 1)\`-ish — almost eye-level, looking from +z toward the origin). The user explicitly asked for a horizontal, eye-level default. Do not use the 45° overhead \`(0, 2, 6)\` style from the original design — that is now the "top" view, not the default.
- The \`view\` argument switches the camera direction:
  - \`'default'\` → horizontal (\`(0, 1, 1)\` direction, eye-level from +z)
  - \`'top'\`     → straight overhead (\`(0, 1, 0.001)\`)
  - \`'side'\`    → pure +x side view (\`(1, 0, 0)\`)
- **ALWAYS fit the camera to the scene bbox** (see the "Fit-to-scene camera" section below). Without this, a problem with objects 6 units apart gets cropped at \`view='side'\` or \`view='default'\`, and the user can't see the action.
- Include at least one AmbientLight AND one DirectionalLight so colors render correctly.
- Choose a light, non-white background (e.g. 0xf8fafc or 0xfef3c7) — pure white looks unfinished in screenshots.
- Use 2-4 distinct colors per scene (one per object/role). Avoid monochrome.
- Add a GridHelper or PlaneGeometry ground unless the problem is purely abstract (rotations in space).
- **Object sizes** should reflect the problem's scale, not be hard-coded. As a guideline:
  - 一个"人" or "学生" ≈ 1.5 units tall
  - 一辆"车" ≈ 1.0 × 0.5 × 0.4 units (length × height × width)
  - 一个"正方体" / "木棒" / "绳子" segment: the size stated in the problem (e.g. a 12cm stick → BoxGeometry(12, 0.2, 0.2) or similar)
  - 一个"水箱" / "圆柱容器" with capacity: base radius and height from the problem numbers
  - For fractions: one whole bar = 4 units long, so \`1/3\` of it is shaded 4/3 units.
  Use the problem's actual numbers — that's the whole point of an animation.

# Fit-to-scene camera (REQUIRED)

\`\`\`js
// 1. After adding ALL meshes to the scene, refresh transforms:
scene.updateMatrixWorld(true);

// 2. Compute the bbox. Use \`scene\` (not a single mesh) so multi-object
//    problems (cars, pipes, fractions) all fit at once.
const bbox = new THREE.Box3().setFromObject(scene);

// 3. Find center + radius:
const center = new THREE.Vector3();
bbox.getCenter(center);
const size = new THREE.Vector3();
bbox.getSize(size);
const radius = size.length() / 2 || 1;   // || 1 guards against zero-size

// 4. Find the distance that makes the bbox fit the smaller of vFov/hFov
//    (so a wide canvas doesn't crop the sides):
const w = canvas.clientWidth || 640;
const h = canvas.clientHeight || 360;
const vFov = (camera.fov * Math.PI) / 180;
const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
const minFov = Math.min(vFov, hFov);
const distance = (radius / Math.sin(minFov / 2)) * 1.4;  // 1.4 = 40% headroom

// 5. Pick direction by view:
const viewDirs = {
  default: [0, 1, 1],     // horizontal
  top:     [0, 1, 0.001], // overhead
  side:    [1, 0, 0]      // side
};
const v = viewDirs[view] || viewDirs.default;
const unitDir = new THREE.Vector3(v[0], v[1], v[2]).normalize();

// 6. Place camera at center + unitDir * distance, then lookAt center.
camera.position.copy(center).add(unitDir.multiplyScalar(distance));
camera.lookAt(center);
\`\`\`

The few-shot examples below apply this template verbatim. If you forget the fit step, the user will see cropped or empty scenes and the eval harness will mark you down.

# Animation guidance

- The user will read a Chinese math problem. Extract the concrete numbers from the problem and USE THEM in the animation (don't substitute round numbers).
- For "行程问题" (travel / meeting): animate two objects moving toward each other with the right speeds and meeting at the right time.
- For "工程问题" (work-rate / filling-emptying): show a container filling and another pipe draining simultaneously.
- For "几何" (rotation / partition): show the rotation or cut visually.
- For "分数" (fractions): show a bar or circle partitioned, with shaded portions matching the fractions.
- End state should show the answer (meeting point, full container, final angle) and HOLD there for at least 1 second before looping. To loop, return to start.
- Total animation duration: 6-10 seconds. Time progression should be visible — do not animate so fast the kid can't follow.

# Pausable

- Always return the object form (with stop + setPaused) so the host can pause for explanation. Exception: trivial single-loop demos where pause is meaningless.

# Language

- The user's problem statement will be in Chinese. Read it carefully, preserve the exact numbers (速度、距离、时间、分数 etc.), do not translate to a different problem.

# Few-shot examples (do NOT modify; these are the canonical patterns)

The few-shot examples below show the inner \`code\` value of a response. The full response must wrap them in the JSON envelope:

\`\`\`json
{
  "code": "export default function(canvas, view, lines) { ...module body... }",
  "steps": [
    { "t": 0, "text": "..." },
    { "t": 2, "text": "..." }
  ],
  "lines": []
}
\`\`\`

CRITICAL — the \`code\` value MUST be a raw JavaScript module string starting with \`export default\`. Do NOT put a JSON object inside \`code\`. The wrong shape (which the model has been observed producing):

\`\`\`json
{
  "code": "{\\n  \\"code\\": \\"export default function...\\", ...\\n}",  // ❌ WRONG — JSON inside JSON
  "steps": [],
  "lines": []
}
\`\`\`

Always emit a real, fully populated \`steps\` array (3-8 items) and \`lines\` array (may be empty \`[]\`, but if you drew any lines, list them as \`{from, to, color, label}\` entries).

${FEW_SHOT_EXAMPLES}

# Now respond

Generate the JSON envelope for the user's problem. Output ONLY the JSON object (a single \`\`\`json\`\`\` fence is OK).`;
}

/**
 * Build the user-turn content. Kept separate so tests can assert the problem
 * is passed through verbatim (no translation, no truncation).
 */
export function buildUserPrompt(problem: string): string {
  return `题目：${problem}`;
}