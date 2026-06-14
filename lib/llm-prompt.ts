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
export default function(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 0, 5);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.4, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
  );
  scene.add(mesh);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(2, 3, 4);
  scene.add(dir);
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
export default function(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8fafc);
  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 1.5, 6);
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
export default function(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 2, 8);
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
`;

export function buildSystemPrompt(): string {
  return `You generate self-contained Three.js code that runs inside a Web Worker sandbox to animate a Chinese elementary-school math problem.

# Output format (strict)

- Output ONLY a single JavaScript module string. No prose, no markdown fences, no commentary.
- The module MUST start with: \`export default function(canvas) {\`
- The module MUST end with: \`}\`
- Inside the function: create your own THREE.Scene, THREE.PerspectiveCamera, THREE.WebGLRenderer bound to \`canvas\`, and an animation loop using requestAnimationFrame.
- The function MUST return either:
  - \`() => { ... }\` — a cleanup function that stops the loop and disposes the renderer, OR
  - \`{ stop: () => void, setPaused: (paused: boolean) => void }\` — when you need host-controlled pause (preferred for any animation with time progression the user might want to step through).
- Do not import anything. Do not use \`import\`. THREE is provided as a global by the host.

# Sandbox constraints (hard rules — code violating these will be rejected)

- DO NOT use: fetch, XMLHttpRequest, importScripts, WebSocket, EventSource, navigator.serviceWorker.
- DO NOT use: eval, new Function(), setTimeout, setInterval for animation (use requestAnimationFrame only).
- DO NOT touch: window, document, globalThis, self, parent, top — the only browser object you may read is the \`canvas\` argument.
- DO NOT load remote textures, fonts, or models. Three.js primitives only (BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, plus built-in materials and lights).
- DO NOT use a custom shader / GLSL. Use MeshStandardMaterial or MeshBasicMaterial only.

# Visual guidance

- Use a perspective camera offset (e.g. position.set(0, 2, 6)) so the scene reads as the "2.5D look" parents and kids expect.
- Include at least one AmbientLight AND one DirectionalLight so colors render correctly.
- Choose a light, non-white background (e.g. 0xf8fafc or 0xfef3c7) — pure white looks unfinished in screenshots.
- Use 2-4 distinct colors per scene (one per object/role). Avoid monochrome.
- Add a GridHelper or PlaneGeometry ground unless the problem is purely abstract (rotations in space).
- Sizes: keep most objects in the 0.3-1.5 unit range; camera distance 5-8 units.

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

${FEW_SHOT_EXAMPLES}

# Now respond

Generate the module for the user's problem. Output the module code only.`;
}

/**
 * Build the user-turn content. Kept separate so tests can assert the problem
 * is passed through verbatim (no translation, no truncation).
 */
export function buildUserPrompt(problem: string): string {
  return `题目：${problem}`;
}