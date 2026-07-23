'use client'

import type { Transition, TransitionType, SegmentLocal } from '@chai-cut/shared'

interface Props {
  segments: SegmentLocal[]
  transitions: Transition[]
  onUpdate: (afterSegmentId: string, type: TransitionType, durationMs: number) => void
}

const TRANSITION_TYPES: TransitionType[] = ['cut', 'fade', 'wipe']

export function TransitionPicker({ segments, transitions, onUpdate }: Props) {
  if (segments.length < 2) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        Add more segments to configure transitions.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Transitions
      </p>

      {segments.slice(0, -1).map((seg, i) => {
        const nextSeg = segments[i + 1]
        const existing = transitions.find(t => t.after_segment_id === seg.id)
        const currentType = existing?.type ?? 'cut'
        const currentDuration = existing?.duration_ms ?? 300

        return (
          <div key={seg.id} className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: 'var(--surface-2)' }}>
            <p className="text-xs text-white">
              After <span className="font-medium">{seg.layout}</span> → <span className="font-medium">{nextSeg.layout}</span>
            </p>

            <div className="flex gap-1">
              {TRANSITION_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => onUpdate(seg.id, t, currentDuration)}
                  className="flex-1 py-1 text-xs rounded capitalize"
                  style={{
                    background: currentType === t ? 'var(--accent)' : 'var(--surface)',
                    color: currentType === t ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {currentType !== 'cut' && (
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>Duration</span><span>{currentDuration}ms</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={1000}
                  step={50}
                  value={currentDuration}
                  onChange={e => onUpdate(seg.id, currentType, Number(e.target.value))}
                  className="accent-purple-500"
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
