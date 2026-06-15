#!/usr/bin/env -S npx tsx
/**
 * P2 Eval Runner
 *
 * For each problem × each run, this script:
 *   1. Calls POST /api/render with the problem text.
 *   2. Saves the returned Three.js code to a .code.txt file.
 *   3. Opens the page in headless Chromium (Playwright).
 *   4. Submits the same problem so the live app renders the code.
 *   5. Captures a screenshot of the rendered canvas.
 *
 * Output:
 *   docs/eval/results/{date}/{problem}/{run}.code.txt   — generated code
 *   docs/eval/results/{date}/{problem}/{run}.png       — screenshot
 *   docs/eval/results/{date}/scoresheet.md             — empty template to fill in
 *
 * Usage:
 *   1. Make sure the dev server is running: npm run dev
 *   2. Make sure .env.local is set with your LongCat key
 *   3. Run: npx tsx scripts/eval.ts
 *
 * Optional env:
 *   EVAL_BASE_URL=http://localhost:3000   (default)
 *   EVAL_INVITE_CODE=founder              (default)
 *   EVAL_RUNS=3                           (default, per problem)
 */

import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const INVITE_CODE = process.env.EVAL_INVITE_CODE ?? "founder";
const RUNS = Number(process.env.EVAL_RUNS ?? "3");

interface Problem {
  id: string;
  topic: string;
  prompt: string;
}

interface Result {
  problemId: string;
  run: number;
  ok: boolean;
  latencyMs: number;
  error?: string;
  codeFile: string;
  screenshotFile: string;
}

async function loadProblems(): Promise<Problem[]> {
  const md = await readFile("docs/eval/problems.md", "utf8");
  const problems: Problem[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\| (\d+) \| ([^|]+) \| (.+) \|$/);
    if (m && m[1] !== "#") {
      problems.push({
        id: m[1],
        topic: m[2].trim(),
        prompt: m[3].trim(),
      });
    }
  }
  return problems;
}

async function callRender(problem: string): Promise<{ code: string; latencyMs: number } | { error: string }> {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problem, inviteCode: INVITE_CODE }),
  });
  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const text = await res.text();
    return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }

  const data = (await res.json()) as { code?: string; error?: string };
  if (data.error) {
    return { error: data.error };
  }
  if (!data.code) {
    return { error: "no code returned" };
  }
  return { code: data.code, latencyMs };
}

async function captureScreenshot(problem: string, outPath: string): Promise<boolean> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  try {
    await page.goto(BASE_URL);
    // Replace the default problem with the test problem.
    await page.locator("textarea").fill(problem);
    await page.locator('input[type="text"]').fill(INVITE_CODE);
    await page.getByRole("button", { name: /生成动画/ }).click();

    // Wait for either canvas or error message — long timeout (90s)
    // because we want to see if the LLM call completes at all.
    try {
      await Promise.race([
        page.locator("canvas").waitFor({ state: "visible", timeout: 90_000 }),
        page.locator("text=渲染失败").waitFor({ state: "visible", timeout: 90_000 }),
        page.locator("text=请求超时").waitFor({ state: "visible", timeout: 90_000 }),
      ]);
    } catch {
      // timeout — capture whatever state we're in
    }

    // Give the canvas an extra moment to render its first frame.
    await page.waitForTimeout(2_000);

    await page.screenshot({ path: outPath, fullPage: false });
    return true;
  } catch (err) {
    console.error(`  screenshot failed for ${problem.slice(0, 20)}:`, err);
    return false;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("=== P2 Eval Runner ===");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Invite code: ${INVITE_CODE}`);
  console.log(`Runs per problem: ${RUNS}`);
  console.log();

  const problems = await loadProblems();
  if (problems.length === 0) {
    console.error("No problems found in docs/eval/problems.md");
    process.exit(1);
  }
  console.log(`Loaded ${problems.length} problems\n`);

  const date = new Date().toISOString().slice(0, 10);
  const results: Result[] = [];

  for (const problem of problems) {
    console.log(`--- Problem ${problem.id}: ${problem.topic} ---`);
    for (let run = 1; run <= RUNS; run++) {
      const dir = join("docs/eval/results", date, `problem-${problem.id}-${problem.topic}`);
      await mkdir(dir, { recursive: true });

      const codeFile = join(dir, `run-${run}.code.txt`);
      const screenshotFile = join(dir, `run-${run}.png`);

      process.stdout.write(`  Run ${run}: calling LLM... `);
      const result = await callRender(problem.prompt);

      if ("error" in result) {
        console.log(`✗ ${result.error}`);
        results.push({
          problemId: problem.id,
          run,
          ok: false,
          latencyMs: 0,
          error: result.error,
          codeFile,
          screenshotFile,
        });
        await writeFile(codeFile, `// ERROR: ${result.error}\n`);
        continue;
      }

      console.log(`✓ (${(result.latencyMs / 1000).toFixed(1)}s)`);
      await writeFile(codeFile, result.code);

      process.stdout.write(`  Run ${run}: capturing screenshot... `);
      const shotOk = await captureScreenshot(problem.prompt, screenshotFile);
      console.log(shotOk ? "✓" : "✗");

      results.push({
        problemId: problem.id,
        run,
        ok: true,
        latencyMs: result.latencyMs,
        codeFile,
        screenshotFile,
      });
    }
    console.log();
  }

  // Write scoresheet template.
  const scoresheetPath = join("docs/eval/results", date, "scoresheet.md");
  const scoresheet = generateScoresheet(problems, results, RUNS);
  await writeFile(scoresheetPath, scoresheet);

  // Write raw results.json.
  const jsonPath = join("docs/eval/results", date, "results.json");
  await writeFile(jsonPath, JSON.stringify({ date, results }, null, 2));

  // Summary.
  const okCount = results.filter((r) => r.ok).length;
  console.log(`=== Summary ===`);
  console.log(`OK: ${okCount}/${results.length}`);
  console.log(`Output: docs/eval/results/${date}/`);
  console.log(`Next: open scoresheet.md and rate each run on the 10-point rubric`);
}

function generateScoresheet(problems: Problem[], results: Result[], runs: number): string {
  const lines: string[] = [];
  lines.push(`# Eval Scoresheet — ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push("Per-problem scores (rate each run 0-10 using the rubric):");
  lines.push("");
  lines.push("| # | Topic | Run 1 | Run 2 | Run 3 | Mean |");
  lines.push("|---|---|---|---|---|---|");
  for (const problem of problems) {
    lines.push(
      `| ${problem.id} | ${problem.topic} | /${runs} | /${runs} | /${runs} | |`,
    );
  }
  lines.push("");
  lines.push(`OK calls: ${results.filter((r) => r.ok).length}/${results.length}`);
  lines.push("");
  lines.push("## Per-run detail");
  lines.push("");
  for (const r of results) {
    const status = r.ok ? `✓ ${(r.latencyMs / 1000).toFixed(1)}s` : `✗ ${r.error}`;
    lines.push(`- Problem ${r.problemId} Run ${r.run}: ${status}`);
    lines.push(`  - code: \`${r.codeFile}\``);
    lines.push(`  - screenshot: \`${r.screenshotFile}\``);
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});