import { test, expect } from "@playwright/test";

// Smoke test for the AI math animation MVP.
// Because we may not have real LLM API keys in CI, this test covers
// what we CAN verify without a live LLM call:
//   1. Homepage renders with the pre-filled problem + invite code
//   2. Clicking "生成动画" triggers a request and shows loading → result
//   3. On success: canvas + "查看生成的代码" panel appear
//   4. On failure: ErrorState shows a friendly message (not a blank page)
//
// To test the full end-to-end flow with a real LLM, set LLM_BASE_URL,
// LLM_API_KEY, LLM_MODEL in .env.local before running.

test.describe("AI 数学动画 MVP", () => {
  test("homepage renders with pre-filled defaults", async ({ page }) => {
    await page.goto("/");

    // Title and description
    await expect(page.locator("h1")).toHaveText("拍照出数学动画");

    // Problem textarea — should be pre-filled with the default problem
    const problem = page.locator("textarea");
    await expect(problem).toBeVisible();
    const problemValue = await problem.inputValue();
    expect(problemValue).toContain("12cm");
    expect(problemValue).toContain("旋转180度");

    // Invite code input — should be pre-filled with "founder"
    const inviteInput = page.locator('input[type="text"]');
    await expect(inviteInput).toBeVisible();
    await expect(inviteInput).toHaveValue("founder");
  });

  test("submit shows loading then result or friendly error", async ({
    page,
  }) => {
    await page.goto("/");

    // Click submit
    const submitBtn = page.getByRole("button", { name: /生成动画/ });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Loading state should appear briefly
    const loading = page.locator("text=AI 正在画动中");
    // It may flash too fast to catch — that's OK. Just wait for the
    // terminal state (success canvas or error message) within the timeout.

    // Terminal state: either canvas mounts OR ErrorState shows a message.
    // Both are acceptable — we're verifying the flow doesn't silently fail.
    const canvas = page.locator("canvas");
    const errorState = page.locator("text=渲染失败");
    const timeoutError = page.locator("text=请求超时");

    // Wait up to 25s for LLM + render (budget is ≤15s fetch timeout). If
    // neither appears, the test fails — which is the right signal that
    // something is broken.
    const either = canvas.or(errorState).or(timeoutError);
    await expect(either.first()).toBeVisible({ timeout: 25_000 });

    // If canvas mounted, the "查看生成的代码" details should also exist.
    if (await canvas.isVisible()) {
      const details = page.locator("details", {
        hasText: "查看生成的代码",
      });
      await expect(details).toBeVisible();
    }

    // If error state, it should show a meaningful message (not "undefined").
    if (await errorState.isVisible()) {
      const errorText = await errorState.textContent();
      expect(errorText).not.toContain("undefined");
    }

    // If timeout error, the message should be user-friendly.
    if (await timeoutError.isVisible()) {
      const errorText = await timeoutError.textContent();
      expect(errorText).not.toContain("undefined");
      expect(errorText).not.toContain("signal is aborted");
    }
  });

  test("empty invite code disables submit", async ({ page }) => {
    await page.goto("/");

    const inviteInput = page.locator('input[type="text"]');
    await inviteInput.fill("");

    const submitBtn = page.getByRole("button", { name: /生成动画/ });
    await expect(submitBtn).toBeDisabled();
  });

  test("empty problem disables submit", async ({ page }) => {
    await page.goto("/");

    const problem = page.locator("textarea");
    await problem.fill("");

    const submitBtn = page.getByRole("button", { name: /生成动画/ });
    await expect(submitBtn).toBeDisabled();
  });
});