/**
 * Tests for the StepsPanel component. The component does two things:
 *   1. Render the step list (P0).
 *   2. Highlight the active step based on `currentTime` (P3).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StepsPanel from "@/components/StepsPanel";
import type { RenderStep } from "@/lib/types";

const baseSteps: RenderStep[] = [
  { id: 1, t: 0, text: "读题" },
  { id: 2, t: 2, text: "列已知" },
  { id: 3, t: 5, text: "答案" },
];

describe("StepsPanel — list rendering", () => {
  it("shows the empty-state placeholder when no steps are provided", () => {
    render(<StepsPanel steps={[]} />);
    expect(screen.getByText("暂无讲解步骤")).toBeTruthy();
  });

  it("renders each step with its number, text, and timestamp", () => {
    render(<StepsPanel steps={baseSteps} />);
    expect(screen.getByText("读题")).toBeTruthy();
    expect(screen.getByText("列已知")).toBeTruthy();
    expect(screen.getByText("答案")).toBeTruthy();
    expect(screen.getByText("0.0s")).toBeTruthy();
    expect(screen.getByText("2.0s")).toBeTruthy();
    expect(screen.getByText("5.0s")).toBeTruthy();
  });

  it("uses data-step-id so callers (or P3.5) can target steps for highlight", () => {
    const { container } = render(
      <StepsPanel steps={[{ id: 7, t: 0, text: "step 7" }]} />,
    );
    const li = container.querySelector("[data-step-id='7']");
    expect(li).toBeTruthy();
    expect(li?.textContent).toContain("step 7");
  });

  it("renders the section with an accessible aria-label", () => {
    const { container } = render(<StepsPanel steps={baseSteps} />);
    const section = container.querySelector('section[aria-label="讲解步骤"]');
    expect(section).toBeTruthy();
  });
});

describe("StepsPanel — active step highlight", () => {
  it("highlights the step whose t is the largest value <= currentTime", () => {
    const { container } = render(
      <StepsPanel steps={baseSteps} currentTime={3} />,
    );
    // step 1 (t=0): 0 <= 3, active
    // step 2 (t=2): 2 <= 3, active
    // step 3 (t=5): 5 > 3, NOT active
    const li1 = container.querySelector("[data-step-id='1']");
    const li2 = container.querySelector("[data-step-id='2']");
    const li3 = container.querySelector("[data-step-id='3']");
    expect(li1?.getAttribute("data-active")).toBe("true");
    expect(li2?.getAttribute("data-active")).toBe("true");
    expect(li3?.getAttribute("data-active")).toBeNull();
  });

  it("highlights the LAST step when currentTime is past the final t", () => {
    const { container } = render(
      <StepsPanel steps={baseSteps} currentTime={999} />,
    );
    const li3 = container.querySelector("[data-step-id='3']");
    expect(li3?.getAttribute("data-active")).toBe("true");
  });

  it("highlights no step when currentTime is before the first t", () => {
    // The first step's t is 0, so currentTime=0 should still highlight
    // step 1. But a negative currentTime should highlight nothing.
    const { container } = render(
      <StepsPanel steps={baseSteps} currentTime={-1} />,
    );
    const li1 = container.querySelector("[data-step-id='1']");
    expect(li1?.getAttribute("data-active")).toBeNull();
  });

  it("treats currentTime=0 as the start of step 1 (active)", () => {
    const { container } = render(
      <StepsPanel steps={baseSteps} currentTime={0} />,
    );
    const li1 = container.querySelector("[data-step-id='1']");
    expect(li1?.getAttribute("data-active")).toBe("true");
  });
});
