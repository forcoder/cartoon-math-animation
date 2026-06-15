'use client';

import type { RenderStep } from '@/lib/types';

interface StepsPanelProps {
  steps: RenderStep[];
  /**
   * Current playhead position in seconds. The step whose `t` is the
   * largest value `<= currentTime` is highlighted.
   */
  currentTime?: number;
}

/**
 * Side panel that lists the verbal explanation steps alongside the animation.
 *
 * When `currentTime` is provided, the active step (last one with `t <=
 * currentTime`) is highlighted so the user can see "this is what the
 * animation is doing right now" in sync with the time axis.
 */
export default function StepsPanel({ steps, currentTime = 0 }: StepsPanelProps) {
  if (!steps || steps.length === 0) {
    return (
      <section
        aria-label="讲解步骤"
        className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-400"
      >
        暂无讲解步骤
      </section>
    );
  }

  // The "active" step is the last one whose t is <= currentTime.
  // Empty array / t all > currentTime → no active step.
  let activeId: number | null = null;
  for (const s of steps) {
    if (s.t <= currentTime + 0.001) {
      activeId = s.id;
    } else {
      break;
    }
  }

  return (
    <section
      aria-label="讲解步骤"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-slate-700">讲解步骤</h2>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => {
          const isActive = step.id === activeId;
          return (
            <li
              key={step.id}
              data-step-id={step.id}
              data-active={isActive ? "true" : undefined}
              className={`flex gap-3 rounded-md border px-2 py-1.5 text-sm transition ${
                isActive
                  ? "border-blue-300 bg-blue-50 text-blue-900 shadow-sm"
                  : "border-transparent text-slate-700"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {step.id}
              </span>
              <span className="flex-1 leading-relaxed">{step.text}</span>
              <span
                className={`shrink-0 self-center text-xs tabular-nums ${
                  isActive ? "text-blue-700" : "text-slate-400"
                }`}
              >
                {step.t.toFixed(1)}s
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
