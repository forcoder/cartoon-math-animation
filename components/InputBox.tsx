'use client';

interface InputBoxProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  inviteCode: string;
  onInviteCodeChange: (v: string) => void;
}

export default function InputBox({
  value,
  onChange,
  onSubmit,
  disabled,
  inviteCode,
  onInviteCodeChange,
}: InputBoxProps) {
  const empty = !value.trim() || !inviteCode.trim();

  return (
    <div className="flex flex-col gap-2">
      <textarea
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="把题目贴在这里…例如：一根木棒旋转 180°，需要多长时间？"
        disabled={disabled}
        className="w-full resize-none rounded-lg border border-slate-300 bg-white p-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
      />
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inviteCode}
          onChange={(e) => onInviteCodeChange(e.target.value)}
          placeholder="邀请码（试用：founder）"
          disabled={disabled}
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={empty || disabled}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          生成动画
        </button>
      </div>
    </div>
  );
}
