'use client'

import type { LayoutType } from '@chai-cut/shared'
import { LAYOUT_SLOT_COUNT } from '@chai-cut/shared'

const LAYOUTS: { type: LayoutType; label: string; icon: string }[] = [
  { type: 'vertical', label: 'Vertical', icon: '▮' },
  { type: 'split', label: 'Split', icon: '⬛⬛' },
  { type: 'trio', label: 'Trio', icon: '⬛⬛⬛' },
  { type: 'spotlight', label: 'Spotlight', icon: '◉' },
  { type: 'centered', label: 'Centered', icon: '⊡' },
  { type: 'horizontal', label: 'Horizontal', icon: '▬' },
]

interface Props {
  current: LayoutType
  onChange: (layout: LayoutType) => void
}

export function LayoutPicker({ current, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Layout
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {LAYOUTS.map(l => (
          <button
            key={l.type}
            onClick={() => onChange(l.type)}
            title={`${l.label} (${LAYOUT_SLOT_COUNT[l.type]} box${LAYOUT_SLOT_COUNT[l.type] > 1 ? 'es' : ''})`}
            className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-xs transition-colors"
            style={{
              background: current === l.type ? 'var(--accent)' : 'var(--surface-2)',
              color: current === l.type ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${current === l.type ? 'transparent' : 'var(--border)'}`,
            }}
          >
            <span className="text-base leading-none">{l.icon}</span>
            <span>{l.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
