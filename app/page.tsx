'use client';

import { useState, useCallback } from 'react';
import InputBox from '@/components/InputBox';
import AnimationCanvas from '@/components/AnimationCanvas';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import ViewPresets from '@/components/ViewPresets';
import TimeAxis from '@/components/TimeAxis';

type Status = 'idle' | 'loading' | 'success' | 'error';
type ViewName = 'default' | 'top' | 'side';

const DEFAULT_PROBLEM =
  '一根长为12cm的木棒，按1:2的比例切分,切分点为O,现将木棒绕点O旋转180度，木棒扫过的面积为多少平方cm?';

export default function HomePage() {
  const [problem, setProblem] = useState(DEFAULT_PROBLEM);
  const [inviteCode, setInviteCode] = useState('founder');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [view, setView] = useState<ViewName>('default');
  const [duration, setDuration] = useState(30);
  const [currentTime, setCurrentTime] = useState(0);

  const handleSubmit = useCallback(async () => {
    if (!problem.trim() || !inviteCode.trim()) return;
    setStatus('loading');
    setProgress(0);
    setErrorMsg('');
    setCode(null);
    const tick = setInterval(() => setProgress((p) => (p < 90 ? p + 5 : p)), 200);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem, inviteCode }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { code: string; duration?: number };
      setCode(data.code);
      if (data.duration) setDuration(data.duration);
      setStatus('success');
    } catch (e: unknown) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "请求超时，请检查网络后重试"
          : e instanceof Error
            ? e.message
            : "未知错误";
      setErrorMsg(msg);
      setStatus('error');
    } finally {
      clearInterval(tick);
    }
  }, [problem, inviteCode]);

  const handleRetry = useCallback(() => {
    setStatus('idle');
    setErrorMsg('');
    setProgress(0);
  }, []);

  const handleMountError = useCallback((msg: string) => {
    setErrorMsg(`渲染失败：${msg}`);
    setStatus('error');
  }, []);

  const showCanvas = status === 'success' && code !== null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-4 py-6 sm:py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          拍照出数学动画
        </h1>
        <p className="text-sm text-slate-500">把不会的题贴进来，AI 帮你画成动画</p>
      </header>
      <InputBox
        value={problem}
        onChange={setProblem}
        onSubmit={handleSubmit}
        disabled={status === 'loading'}
        inviteCode={inviteCode}
        onInviteCodeChange={setInviteCode}
      />
      <section className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        {status === 'idle' && <div className="flex h-full items-center justify-center text-slate-400">等待题目</div>}
        {status === 'loading' && <LoadingState progress={progress} />}
        {status === 'error' && <ErrorState error={errorMsg} onRetry={handleRetry} />}
        {showCanvas && <AnimationCanvas code={code} view={view} onError={handleMountError} />}
      </section>
      {showCanvas && (
        <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-slate-700">
            查看生成的代码（{code.length} 字符）
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3 text-xs text-slate-800">
            {code}
          </pre>
        </details>
      )}
      {showCanvas && (
        <div className="flex flex-col gap-3">
          <ViewPresets value={view} onChange={setView} />
          <TimeAxis duration={duration} currentTime={currentTime} onSeek={setCurrentTime} />
        </div>
      )}
    </main>
  );
}
