/**
 * Tests for the StepsPanel component. P0 only renders a static list —
 * the camera-follow / step-highlight behavior lands in P3.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StepsPanel from "@/components/StepsPanel";
import type { RenderStep } from "@/lib/types";

describe("StepsPanel", () => {
  it("shows the empty-state placeholder when no steps are provided", () => {
    render(<StepsPanel steps={[]} />);
    expect(screen.getByText("暂无讲解步骤")).toBeTruthy();
  });

  it("renders each step with its number, text, and timestamp", () => {
    const steps: RenderStep[] = [
      { id: 1, t: 0, text: "读题：木棒 12cm" },
      { id: 2, t: 2.5, text: "切分 1:2" },
      { id: 3, t: 5, text: "绕 O 旋转 180°" },
    ];
    render(<StepsPanel steps={steps} />);
    expect(screen.getByText("读题：木棒 12cm")).toBeTruthy();
    expect(screen.getByText("切分 1:2")).toBeTruthy();
    expect(screen.getByText("绕 O 旋转 180°")).toBeTruthy();
    // Each step shows its time stamp on the right
    expect(screen.getByText("0.0s")).toBeTruthy();
    expect(screen.getByText("2.5s")).toBeTruthy();
    expect(screen.getByText("5.0s")).toBeTruthy();
  });

  it("uses data-step-id so P3 can target steps for highlight", () => {
    const steps: RenderStep[] = [
      { id: 7, t: 0, text: "step 7" },
    ];
    const { container } = render(<StepsPanel steps={steps} />);
    const li = container.querySelector("[data-step-id='7']");
    expect(li).toBeTruthy();
    expect(li?.textContent).toContain("step 7");
  });

  it("renders the section with an accessible aria-label", () => {
    const { container } = render(
      <StepsPanel steps={[{ id: 1, t: 0, text: "x" }]} />,
    );
    const section = container.querySelector('section[aria-label="讲解步骤"]');
    expect(section).toBeTruthy();
  });
});
