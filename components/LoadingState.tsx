'use client';

interface LoadingStateProps {
  progress: number;
}

export default function LoadingState({ progress }: LoadingStateProps) {
  const pct = Math.min(100, Math.max(0, progress));
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
      <p className="text-sm text-slate-600">AI 正在画动中...</p>
      <div className="h-2 w-48 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
