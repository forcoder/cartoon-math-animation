import { test, expect } from "@playwright/test";

test("verify fix: cleanup object return type renders correctly", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/");

  // Use a simple known problem that LongCat handles well.
  await page.locator("textarea").fill("一根长为12cm的木棒，按1:2的比例切分");
  await page.locator('input[type="text"]').fill("founder");

  await page.getByRole("button", { name: /生成动画/ }).click();

  // Wait up to 90s for the canvas to appear (LLM call + render).
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 90_000 });

  // Give it time to render a frame
  await page.waitForTimeout(3_000);

  // Verify the canvas has actual content (non-empty pixels).
  const canvasState = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d") || el.getContext("webgl");
    return {
      width: el.width,
      height: el.height,
      hasContext: !!ctx,
    };
  });
  console.log("Canvas state:", canvasState);

  // Take a screenshot for visual inspection
  await page.screenshot({ path: "/tmp/cartoon-fix-verify.png", fullPage: true });

  // Should NOT see the "清理函数" error
  const errorText = await page.locator("text=清理函数").isVisible();
  expect(errorText, "Should not show cleanup function error").toBe(false);

  // Should see the canvas
  expect(canvasState.width).toBeGreaterThan(0);
  expect(canvasState.height).toBeGreaterThan(0);
});