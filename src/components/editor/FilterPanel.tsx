'use client'

export interface FilterValues {
  brightness: number  // 0–200, default 100
  contrast: number    // 0–200, default 100
  saturation: number  // 0–200, default 100
}

interface Props {
  values: FilterValues
  onChange: (v: FilterValues) => void
}

const SLIDERS: { key: keyof FilterValues; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
]

export function FilterPanel({ values, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Filters
      </p>

      {SLIDERS.map(({ key, label }) => (
        <div key={key} className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-white">
            <span>{label}</span>
            <span style={{ color: 'var(--text-muted)' }}>{values[key]}</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            value={values[key]}
            onChange={e => onChange({ ...values, [key]: Number(e.target.value) })}
            className="accent-purple-500"
          />
        </div>
      ))}

      <button
        onClick={() => onChange({ brightness: 100, contrast: 100, saturation: 100 })}
        className="text-xs py-1.5 rounded-lg"
        style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
      >
        Reset to defaults
      </button>
    </div>
  )
}
