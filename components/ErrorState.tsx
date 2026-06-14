'use client';

interface ErrorStateProps {
  error: string;
  onRetry: () => void;
}

const FRIENDLY: Record<string, string> = {
  'AI 生成失败': 'AI 没画出合适的动画，请再试一次',
  '题目太复杂': '这道题有点难，AI 暂时画不出来，换个简单的试试',
  '网络错误': '网络好像断了，检查一下再试',
};

export default function ErrorState({ error, onRetry }: ErrorStateProps) {
  const msg = FRIENDLY[error] ?? (error || '出了点问题，请再试一次');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {msg}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        再试一次
      </button>
    </div>
  );
}
