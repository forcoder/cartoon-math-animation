'use client';

import type { RenderStep } from '@/lib/types';

interface StepsPanelProps {
  steps: RenderStep[];
}

/**
 * Side panel that lists the verbal explanation steps alongside the animation.
 *
 * P0 (this version): render the steps as a static ordered list. The host page
 * will pass an empty / sample array when the LLM hasn't returned any.
 *
 * P3 (camera follow + step highlight) will subscribe to `currentTime` from
 * the time-axis and highlight the active step. For now, the list just
 * establishes the visual layout.
 */
export default function StepsPanel({ steps }: StepsPanelProps) {
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

  return (
    <section
      aria-label="讲解步骤"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-slate-700">讲解步骤</h2>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li
            key={step.id}
            data-step-id={step.id}
            className="flex gap-3 rounded-md border border-transparent px-2 py-1.5 text-sm text-slate-700 transition data-[active=true]:border-blue-200 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-900"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-500">
              {step.id}
            </span>
            <span className="flex-1 leading-relaxed">{step.text}</span>
            <span className="shrink-0 self-center text-xs tabular-nums text-slate-400">
              {step.t.toFixed(1)}s
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
