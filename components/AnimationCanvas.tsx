'use client';

import { useEffect, useRef } from 'react';
import { mountAnimation } from '@/lib/worker-bridge';
import type { RenderLine } from '@/lib/types';

type ViewName = 'default' | 'top' | 'side';

interface AnimationCanvasProps {
  code: string;
  view: ViewName;
  lines?: ReadonlyArray<RenderLine>;
  onError?: (message: string) => void;
}

export default function AnimationCanvas({ code, view, lines, onError }: AnimationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !code) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    mountAnimation(el, code, view, lines ?? [])
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
  }, [code, view, lines, onError]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
