'use client';

import { useState } from 'react';

interface TimeAxisProps {
  duration: number;
  currentTime: number;
  onSeek: (t: number) => void;
}

export default function TimeAxis({ duration, currentTime, onSeek }: TimeAxisProps) {
  const [playing, setPlaying] = useState(false);
  const safeDuration = duration > 0 ? duration : 30;
  const ratio = Math.min(1, Math.max(0, currentTime / safeDuration));

  const handleReset = () => {
    setPlaying(false);
    onSeek(0);
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? '暂停' : '播放'}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700"
      >
        {playing ? (
          <span className="block h-3 w-3 border-l-4 border-r-4 border-l-transparent border-r-transparent" />
        ) : (
          <span className="ml-0.5 block h-0 w-0 border-y-4 border-l-6 border-y-transparent border-l-white" />
        )}
      </button>
      <input
        type="range"
        min={0}
        max={safeDuration}
        step={0.1}
        value={currentTime}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        className="h-1 flex-1 cursor-pointer accent-blue-600"
        aria-label="时间轴"
      />
      <button
        type="button"
        onClick={handleReset}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
      >
        重置
      </button>
      <span className="min-w-[3.5rem] text-right text-xs tabular-nums text-slate-500">
        {currentTime.toFixed(1)}s / {safeDuration}s
      </span>
    </div>
  );
}
