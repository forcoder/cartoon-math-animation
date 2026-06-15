'use client';

import { useEffect, useRef } from 'react';
import { mountAnimation } from '@/lib/worker-bridge';
import type { RenderLine, RenderStep } from '@/lib/types';

type ViewName = 'default' | 'top' | 'side';

interface AnimationCanvasProps {
  code: string;
  view: ViewName;
  lines?: ReadonlyArray<RenderLine>;
  /**
   * Optional step timeline. When provided, mountAnimation starts a
   * follow rAF that tweens the camera and swaps mesh emissive
   * highlights in sync with the elapsed time. The LLM function is
   * responsible for setting `mesh.name` on the geometries it wants
   * to be highlightable, and for pinning `globalThis.__cartoonScene__`
   * and `globalThis.__cartoonCamera__` so the host can read them.
   */
  steps?: ReadonlyArray<RenderStep>;
  onError?: (message: string) => void;
}

export default function AnimationCanvas({ code, view, lines, steps, onError }: AnimationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !code) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    mountAnimation(el, code, view, lines ?? [], steps ?? [])
      .then((result) => {
        if (cancelled) {
          result.cleanup();
          return;
        }
        cleanup = result.cleanup;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '未知渲染错误';
        onError?.(msg);
      });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [code, view, lines, steps, onError]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
