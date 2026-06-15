'use client';

type ViewName = 'default' | 'top' | 'side';

interface ViewPresetsProps {
  value: ViewName;
  onChange: (v: ViewName) => void;
}

const VIEWS: { key: ViewName; label: string }[] = [
  { key: 'default', label: '水平' },
  { key: 'top', label: '俯视' },
  { key: 'side', label: '侧面' },
];

export default function ViewPresets({ value, onChange }: ViewPresetsProps) {
  return (
    <div className="flex gap-2" role="group" aria-label="视角预设">
      {VIEWS.map((v) => {
        const active = v.key === value;
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => onChange(v.key)}
            aria-pressed={active}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              active
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
