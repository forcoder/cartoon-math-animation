import { test } from "@playwright/test";

test("debug: full state after submit", async ({ page }) => {
  test.setTimeout(120_000);

  const logs: string[] = [];
  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

  await page.goto("/");

  await page.locator("textarea").fill("一根长为12cm的木棒");
  await page.locator('input[type="text"]').fill("founder");

  console.log("Before submit");
  await page.getByRole("button", { name: /生成动画/ }).click();
  console.log("After submit click");

  // Wait 60s then capture
  await page.waitForTimeout(60_000);

  const body = await page.locator("body").innerText();
  console.log("=== Page body after 60s ===");
  console.log(body.slice(0, 800));
  console.log("=== Console logs ===");
  console.log(logs.join("\n"));

  await page.screenshot({ path: "/tmp/cartoon-debug-2.png", fullPage: true });
});